import { Proxy, ProxyTestResult } from '../types';
import { ProxyModel } from '../models/Proxy';
import { getDispatcher, httpFetch, proxyToUrl } from '../utils/http';
import logger from '../utils/logger';

const proxyModel = new ProxyModel();

/**
 * 代理解析：显式 proxyId → 默认代理 → 直连。
 * 返回的 Proxy 同时用于 Graph/OAuth（undici dispatcher）与 IMAP（imapflow proxy URL）。
 */
export class ProxyService {
  resolve(proxyId?: number | null): Proxy | undefined {
    if (proxyId) return proxyModel.getById(Number(proxyId));
    return proxyModel.getDefault();
  }

  /** imapflow 使用的代理 URL（socks5:// 或 http://） */
  imapProxyUrl(proxy?: Proxy | null): string | undefined {
    return proxy ? proxyToUrl(proxy) : undefined;
  }

  /** @deprecated 兼容旧代码：返回 undici dispatcher */
  getAgent(proxyId?: number) {
    const proxy = this.resolve(proxyId);
    return { dispatcher: getDispatcher(proxy), type: proxy?.type };
  }

  async testProxy(proxy: Proxy): Promise<ProxyTestResult> {
    const start = Date.now();
    try {
      const res = await httpFetch('https://httpbin.org/ip', { timeoutMs: 15000 }, proxy);
      const data = await res.json();
      const latency = Date.now() - start;
      logger.info(`Proxy test success: ${proxy.host}:${proxy.port} -> ${data.origin} (${latency}ms)`);
      return { ip: data.origin, latency, status: 'active' };
    } catch (err: any) {
      logger.error(`Proxy test failed: ${proxy.host}:${proxy.port} - ${err.message}`);
      return { ip: '', latency: Date.now() - start, status: 'failed' };
    }
  }
}
