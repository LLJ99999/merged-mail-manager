/**
 * 单次收取的总时限（deadline）。
 *
 * 真实网络下，一次 Outlook 收取可能依次经过：Graph OAuth（多个 scope 候选）→ Graph 列表 →
 * IMAP OAuth → IMAP(新) 连接/登录/FETCH → IMAP(旧) …，每一步各自有超时，但叠加起来可能是几分钟；
 * IMAP 服务器 / 代理若持续"滴答"返回数据（keepalive / 极慢的 FETCH），imapflow 的空闲超时永远不会触发，
 * 请求会无限挂起 —— 前端表现为「批量收取一直转圈、永远不结束」。
 *
 * 这里用 AsyncLocalStorage 携带一个 AbortSignal：
 *  - httpFetch（OAuth / Graph）把它与单请求超时合并；
 *  - ImapService.connect 在 abort 时强制 close() 连接，正在进行的 IMAP 命令立即失败；
 *  - withDeadline 另外用 Promise.race 兜底，保证无论底层是否响应 abort，调用方都会按时拿到超时错误。
 */
import { AsyncLocalStorage } from 'async_hooks';

export const FETCH_TIMEOUT_MS = Math.max(5, parseInt(process.env.FETCH_TIMEOUT || '45', 10) || 45) * 1000;

interface DeadlineCtx { signal: AbortSignal; ms: number }
const storage = new AsyncLocalStorage<DeadlineCtx>();

export class DeadlineError extends Error {
  readonly deadline = true;
  /** 视为传输层错误：不再继续回退到其他网络通道 */
  readonly transport = true;
  constructor(readonly ms: number) {
    super(`收取超时：${Math.round(ms / 1000)} 秒内未完成（网络或代理过慢 / 不通；可在 .env 中调整 FETCH_TIMEOUT）`);
    this.name = 'DeadlineError';
  }
}

export function isDeadlineError(err: unknown): boolean {
  return !!(err && typeof err === 'object' && (err as any).deadline === true);
}

/** 当前异步上下文中的 deadline signal（不在 withDeadline 内时为 undefined） */
export function currentDeadlineSignal(): AbortSignal | undefined {
  return storage.getStore()?.signal;
}

export function currentDeadlineMs(): number | undefined {
  return storage.getStore()?.ms;
}

/** 在 ms 毫秒内运行 fn；超时则 abort 上下文 signal 并以 DeadlineError 拒绝 */
export async function withDeadline<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new DeadlineError(ms);
      ctrl.abort(err);
      reject(err);
    }, ms);
  });
  try {
    const work = storage.run({ signal: ctrl.signal, ms }, fn);
    // 超时后 work 可能稍后才以 "connection closed" 之类的错误结束：吞掉，避免 unhandledRejection
    work.catch(() => {});
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
