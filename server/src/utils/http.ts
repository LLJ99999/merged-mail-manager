/**
 * 统一的出站 HTTP 层：所有 Graph / OAuth 请求都经过这里，保证代理对所有通道生效。
 *  - HTTP 代理  → undici ProxyAgent (CONNECT)
 *  - SOCKS5 代理 → undici Agent + 自定义 connector（socks 库建立隧道后再做 TLS）
 */
import { Agent, ProxyAgent, buildConnector, fetch as undiciFetch, Dispatcher } from 'undici';
import { SocksClient } from 'socks';
import { Proxy } from '../types';
import { currentDeadlineSignal, DeadlineError, isDeadlineError } from './deadline';

export const HTTP_REQUEST_TIMEOUT_MS = (parseInt(process.env.HTTP_REQUEST_TIMEOUT || '20', 10) || 20) * 1000;

export function proxyToUrl(proxy: Proxy): string {
  const scheme = proxy.type === 'socks5' ? 'socks5' : 'http';
  const auth = proxy.username
    ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password || '')}@`
    : '';
  const host = proxy.host.includes(':') && !proxy.host.startsWith('[') ? `[${proxy.host}]` : proxy.host;
  return `${scheme}://${auth}${host}:${proxy.port}`;
}

export function createSocksDispatcher(proxy: Proxy): Dispatcher {
  const tlsConnect = buildConnector({ timeout: HTTP_REQUEST_TIMEOUT_MS });
  return new Agent({
    connect: (opts: any, callback: any) => {
      const port = Number(opts.port) || (opts.protocol === 'https:' ? 443 : 80);
      SocksClient.createConnection({
        proxy: {
          host: proxy.host,
          port: Number(proxy.port),
          type: 5,
          userId: proxy.username || undefined,
          password: proxy.password || undefined,
        },
        command: 'connect',
        destination: { host: opts.hostname, port },
        timeout: HTTP_REQUEST_TIMEOUT_MS,
      })
        .then(({ socket }) => {
          if (opts.protocol === 'https:') {
            tlsConnect({ ...opts, httpSocket: socket }, callback);
          } else {
            callback(null, socket);
          }
        })
        .catch((err: Error) => callback(err, null));
    },
  });
}

const dispatcherCache = new Map<string, Dispatcher>();

export function getDispatcher(proxy?: Proxy | null): Dispatcher | undefined {
  if (!proxy) return undefined;
  const key = proxyToUrl(proxy);
  let d = dispatcherCache.get(key);
  if (!d) {
    d = proxy.type === 'socks5' ? createSocksDispatcher(proxy) : new ProxyAgent(key);
    dispatcherCache.set(key, d);
  }
  return d;
}

export interface HttpResponse {
  status: number;
  ok: boolean;
  headers: Headers;
  text(): Promise<string>;
  json(): Promise<any>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** 传输层错误（代理/连接/超时），对应源项目 is_transport_error_payload */
export class TransportError extends Error {
  readonly transport = true;
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'TransportError';
  }
}

export async function httpFetch(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number } = {},
  proxy?: Proxy | null,
): Promise<HttpResponse> {
  const dispatcher = getDispatcher(proxy);
  const timeoutMs = init.timeoutMs || HTTP_REQUEST_TIMEOUT_MS;
  const deadline = currentDeadlineSignal();
  if (deadline?.aborted) throw deadline.reason instanceof Error ? deadline.reason : new TransportError('请求已超时');
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = deadline ? AbortSignal.any([timeoutSignal, deadline]) : timeoutSignal;
  try {
    const res = await undiciFetch(url, {
      method: init.method || 'GET',
      headers: init.headers,
      body: init.body,
      dispatcher,
      signal,
    } as any);
    return res as unknown as HttpResponse;
  } catch (err: any) {
    if (deadline?.aborted && isDeadlineError(deadline.reason)) throw deadline.reason as DeadlineError;
    let reason = err?.cause?.message || err?.message || String(err);
    if (timeoutSignal.aborted || /aborted due to timeout/i.test(reason)) reason = `连接超时（${Math.round(timeoutMs / 1000)} 秒无响应）`;
    throw new TransportError(`网络请求失败${proxy ? `（代理 ${proxy.host}:${proxy.port}）` : ''}: ${reason}`, err);
  }
}

export function isTransportError(err: unknown): boolean {
  return !!(err && typeof err === 'object' && (err as any).transport === true);
}
