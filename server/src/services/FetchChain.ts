/**
 * Outlook 取信回退链 —— 移植自 assast/outlookEmail
 * (05_routes_refresh_mail.py: get_outlook_mail_channel_order / record_outlook_mail_channel / fetch_account_folder_emails)
 *
 * 默认顺序：Graph API → IMAP(新, outlook.live.com) → IMAP(旧, outlook.office365.com) → 本地缓存
 * 每个账户记录"首选/最近成功"的通道（accounts.preferred_channel），下次先试它，失败仍按默认顺序回退。
 * 与源项目一致：Graph 阶段若是传输层错误（代理/网络不通），直接停止网络回退，转入本地缓存。
 */

export type NetChannel = 'graph' | 'imap_new' | 'imap_old';

export const OUTLOOK_DEFAULT_ORDER: NetChannel[] = ['graph', 'imap_new', 'imap_old'];

export const CHANNEL_LABELS: Record<string, string> = {
  graph: 'Graph API',
  imap_new: 'IMAP (New)',
  imap_old: 'IMAP (Old)',
  imap: 'IMAP',
  cache: 'Local cache',
  timeout: '超时',
};

export function isNetChannel(v: unknown): v is NetChannel {
  return v === 'graph' || v === 'imap_new' || v === 'imap_old';
}

/**
 * 计算通道顺序（对应源项目 get_outlook_mail_channel_order，粒度细化到具体 IMAP 服务器）：
 *  - 无记录 / graph        → graph, imap_new, imap_old
 *  - imap / imap_new       → imap_new, imap_old, graph   （与源项目 authorization_type=imap 一致）
 *  - imap_old              → imap_old, imap_new, graph   （上次成功的服务器先试，IMAP 族内仍互为回退）
 */
export function getOutlookChannelOrder(preferred?: string | null): NetChannel[] {
  const p = String(preferred || '').trim().toLowerCase();
  if (p === 'imap' || p === 'imap_new') return ['imap_new', 'imap_old', 'graph'];
  if (p === 'imap_old') return ['imap_old', 'imap_new', 'graph'];
  return [...OUTLOOK_DEFAULT_ORDER];
}

export interface ChainSuccess<T> {
  ok: true;
  channel: NetChannel;
  value: T;
  attempted: NetChannel[];
  errors: Partial<Record<NetChannel, string>>;
}

export interface ChainFailure {
  ok: false;
  attempted: NetChannel[];
  errors: Partial<Record<NetChannel, string>>;
  /** 因传输层错误提前终止 */
  stopped: boolean;
  lastError?: unknown;
}

export async function runChannelChain<T>(
  order: NetChannel[],
  run: (channel: NetChannel) => Promise<T>,
  opts: { stopOn?: (channel: NetChannel, err: unknown) => boolean; errors?: Partial<Record<NetChannel, string>> } = {},
): Promise<ChainSuccess<T> | ChainFailure> {
  // 允许调用方传入 errors 对象：即使整条链被外部 deadline 打断，已失败通道的错误也不会丢失
  const errors: Partial<Record<NetChannel, string>> = opts.errors || {};
  const attempted: NetChannel[] = [];
  let lastError: unknown;
  for (const channel of order) {
    attempted.push(channel);
    try {
      const value = await run(channel);
      return { ok: true, channel, value, attempted, errors };
    } catch (err: any) {
      lastError = err;
      errors[channel] = String(err?.message || err).slice(0, 500);
      if (opts.stopOn?.(channel, err)) {
        return { ok: false, attempted, errors, stopped: true, lastError };
      }
    }
  }
  return { ok: false, attempted, errors, stopped: false, lastError };
}

export function summarizeErrors(errors: Record<string, string | undefined>): string {
  // 相同的错误（例如 IMAP 新/旧共用同一次失败的 token 刷新）合并为一条，避免重复刷屏
  const groups = new Map<string, string[]>();
  for (const [k, v] of Object.entries(errors)) {
    if (!v) continue;
    const labels = groups.get(v) || [];
    labels.push(CHANNEL_LABELS[k] || k);
    groups.set(v, labels);
  }
  return [...groups.entries()].map(([v, labels]) => `${labels.join(' / ')}: ${v}`).join(' | ');
}
