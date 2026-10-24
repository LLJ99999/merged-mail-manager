import { AccountModel } from '../models/Account';
import { MailCacheModel, CachedMailInput } from '../models/MailCache';
import { OAuthService } from './OAuthService';
import { GraphApiService } from './GraphApiService';
import { ImapService, ImapConnectOptions } from './ImapService';
import { ProxyService } from './ProxyService';
import { Account, FetchMailsResult, MailChannel, MailMessage, Proxy } from '../types';
import { IMAP_SERVER_NEW, IMAP_SERVER_OLD, toLogicalFolder } from '../providers/presets';
import { NetChannel, getOutlookChannelOrder, runChannelChain, summarizeErrors } from './FetchChain';
import { isTransportError } from '../utils/http';
import { FETCH_TIMEOUT_MS, isDeadlineError, withDeadline } from '../utils/deadline';
import logger from '../utils/logger';

export interface MailServiceDeps {
  accountModel: AccountModel;
  cacheModel: MailCacheModel;
  oauth: OAuthService;
  graph: GraphApiService;
  imap: ImapService;
  proxyService: ProxyService;
}

export const IMAP_SERVER_BY_CHANNEL: Record<'imap_new' | 'imap_old', string> = {
  imap_new: IMAP_SERVER_NEW,
  imap_old: IMAP_SERVER_OLD,
};

/** 单次请求内的 token 上下文：保证轮换后的 refresh_token 立即写回 DB 且后续通道使用最新值 */
class TokenSession {
  refreshToken: string;
  refreshed = false;

  constructor(private account: Account, private deps: MailServiceDeps, private proxy?: Proxy | null) {
    this.refreshToken = account.refresh_token;
  }

  private persist(rt?: string) {
    const token = String(rt || '').trim();
    this.refreshed = true;
    if (token && token !== this.refreshToken) {
      this.deps.accountModel.persistRotatedRefreshToken(this.account.id, token);
      this.refreshToken = token;
    }
  }

  // 记忆化 Promise（成功或失败）：同一次请求内 IMAP(新)/IMAP(旧) 共用一次 token 刷新，
  // refresh_token 无效 / OAuth 端点不通时不会对每个 IMAP 服务器各重复一次（每次最多 HTTP_REQUEST_TIMEOUT 秒）
  private graphP?: Promise<string>;
  private imapP?: Promise<string>;

  graphToken(): Promise<string> {
    if (!this.graphP) {
      this.graphP = this.deps.oauth.refreshGraphToken(this.account.client_id, this.refreshToken, this.proxy).then(tok => {
        this.persist(tok.refresh_token);
        return tok.access_token;
      });
    }
    return this.graphP;
  }

  imapToken(): Promise<string> {
    if (!this.imapP) {
      this.imapP = this.deps.oauth.refreshImapToken(this.account.client_id, this.refreshToken, this.proxy).then(tok => {
        this.persist(tok.refresh_token);
        return tok.access_token;
      });
    }
    return this.imapP;
  }
}

export class MailService {
  private deps: MailServiceDeps;

  constructor(deps: Partial<MailServiceDeps> = {}) {
    this.deps = {
      accountModel: deps.accountModel || new AccountModel(),
      cacheModel: deps.cacheModel || new MailCacheModel(),
      oauth: deps.oauth || new OAuthService(),
      graph: deps.graph || new GraphApiService(),
      imap: deps.imap || new ImapService(),
      proxyService: deps.proxyService || new ProxyService(),
    };
  }

  private getAccount(accountId: number): Account {
    const account = this.deps.accountModel.getById(Number(accountId));
    if (!account) throw new Error('Account not found');
    return account;
  }

  private genericImapOptions(account: Account, proxy?: Proxy | null): ImapConnectOptions {
    return {
      host: account.imap_host,
      port: account.imap_port || 993,
      user: account.email,
      password: account.imap_password || account.password,
      proxyUrl: this.deps.proxyService.imapProxyUrl(proxy),
      provider: account.provider,
    };
  }

  private outlookImapOptions(account: Account, channel: 'imap_new' | 'imap_old', accessToken: string, proxy?: Proxy | null): ImapConnectOptions {
    return {
      host: IMAP_SERVER_BY_CHANNEL[channel],
      port: 993,
      user: account.email,
      accessToken,
      proxyUrl: this.deps.proxyService.imapProxyUrl(proxy),
      provider: 'outlook',
    };
  }

  /**
   * 取信主入口。
   *  Outlook：Graph → IMAP(新) → IMAP(旧) → 本地缓存（首选通道优先）
   *  普通 IMAP：IMAP → 本地缓存
   */
  async fetchMails(accountId: number, mailbox: string, proxyId?: number, top = 50, fetchTimeoutMs = FETCH_TIMEOUT_MS): Promise<FetchMailsResult> {
    const { accountModel, cacheModel } = this.deps;
    const account = this.getAccount(accountId);
    const proxy = this.deps.proxyService.resolve(proxyId);
    const folder = toLogicalFolder(mailbox);
    const box = folder === 'junkemail' ? 'Junk' : 'INBOX';

    type NetResult = { ok: true; channel: MailChannel; mails: CachedMailInput[] } | { ok: false; errors: Record<string, string | undefined>; stopped: boolean };
    const chainErrors: Partial<Record<NetChannel, string>> = {};
    let session: TokenSession | undefined;

    const runNetwork = async (): Promise<NetResult> => {
      if (account.account_type === 'imap') {
        try {
          const mails = await this.deps.imap.fetchMails(this.genericImapOptions(account, proxy), folder, top);
          return { ok: true, channel: 'imap', mails };
        } catch (err: any) {
          return { ok: false, errors: { imap: err.message }, stopped: isTransportError(err) };
        }
      }
      session = new TokenSession(account, this.deps, proxy);
      const s = session;
      const order = getOutlookChannelOrder(account.preferred_channel);
      const chain = await runChannelChain<CachedMailInput[]>(order, async (channel) => {
        if (channel === 'graph') {
          const token = await s.graphToken();
          return this.deps.graph.fetchMails(token, folder, top, 0, proxy);
        }
        const token = await s.imapToken();
        return this.deps.imap.fetchMails(this.outlookImapOptions(account, channel, token, proxy), folder, top);
      }, { errors: chainErrors, stopOn: (channel, err) => isDeadlineError(err) || (channel === 'graph' && isTransportError(err)) });

      if (chain.ok) {
        accountModel.recordPreferredChannel(account.id, chain.channel);
        if (Object.keys(chain.errors).length) {
          logger.warn(`[${account.email}] served by ${chain.channel} after fallback: ${summarizeErrors(chain.errors)}`);
        }
        return { ok: true, channel: chain.channel, mails: chain.value };
      }
      return { ok: false, errors: chain.errors, stopped: chain.stopped };
    };

    let result: NetResult;
    const t0 = Date.now();
    try {
      result = await withDeadline(fetchTimeoutMs, runNetwork);
    } catch (err: any) {
      if (!isDeadlineError(err)) throw err;
      logger.warn(`[${account.email}] fetch ${box} timed out after ${Math.round((Date.now() - t0) / 1000)}s`);
      const errors: Record<string, string | undefined> = { ...chainErrors, timeout: err.message };
      // 超时的那个通道在 chainErrors 里可能被记为 "Connection closed" 之类，去掉以免误导
      for (const [k, v] of Object.entries(errors)) if (k !== 'timeout' && v && /收取超时|connection not available|connection closed|socket closed/i.test(v)) delete errors[k];
      result = { ok: false, errors, stopped: true };
    }
    if (session?.refreshed) accountModel.updateTokenRefreshTime(account.id);

    if (result.ok) {
      const saved = cacheModel.upsert(account.id, box, result.mails.map(m => ({ ...m, channel: result.ok ? result.channel : '' })), { replaceOtherIdModes: true });
      accountModel.updateSyncTime(account.id);
      accountModel.recordLastChannel(account.id, result.channel);
      if (account.account_type === 'imap') accountModel.markActive(account.id);
      return {
        mails: saved,
        total: saved.length,
        protocol: result.channel === 'graph' ? 'graph' : 'imap',
        channel: result.channel,
        cached: false,
      };
    }

    // ---- 全部网络通道失败 → 本地缓存 ----
    const summary = summarizeErrors(result.errors);
    logger.error(`[${account.email}] all channels failed${result.stopped ? ' (transport error, fallback stopped)' : ''}: ${summary}`);
    if (!result.stopped) accountModel.markError(account.id, summary);
    accountModel.recordLastChannel(account.id, 'cache', summary);
    const cached = cacheModel.getByAccount(account.id, box, 1, top);
    if (cached.list.length > 0) {
      return {
        mails: cached.list,
        total: cached.total,
        protocol: 'cache',
        channel: 'cache',
        cached: true,
        errors: result.errors as Record<string, string>,
      };
    }
    const keys = Object.keys(result.errors).filter(k => result.errors[k]);
    if (keys.length === 1 && keys[0] === 'timeout') throw new Error(String(result.errors.timeout));
    throw new Error(`所有通道均失败 — ${summary}`);
  }

  /** 邮件详情（含附件列表），按抓取该邮件的通道与 ID 模式获取；失败时回退缓存内容 */
  async getMailDetail(cacheId: number, proxyId?: number): Promise<MailMessage & { detail_channel: string; detail_error?: string }> {
    const { cacheModel } = this.deps;
    const row = cacheModel.getById(Number(cacheId));
    if (!row) throw new Error('Mail not found');
    // 打开即视为已读（本地缓存；测试替身可能没有 markRead）
    (cacheModel as any).markRead?.(row.id);
    row.is_read = true;
    const account = this.getAccount(row.account_id);
    const proxy = this.deps.proxyService.resolve(proxyId);
    const folder = toLogicalFolder(row.mailbox);
    if (!row.mail_id) return { ...row, detail_channel: 'cache' };

    try {
      let detail: CachedMailInput;
      let channel = row.channel || '';
      if (account.account_type === 'imap') {
        detail = await this.deps.imap.getDetail(this.genericImapOptions(account, proxy), folder, row.mail_id, row.id_mode || 'uid');
        channel = 'imap';
      } else if (row.id_mode === 'graph') {
        const session = new TokenSession(account, this.deps, proxy);
        const token = await session.graphToken();
        detail = await this.deps.graph.getDetail(token, row.mail_id, proxy);
        detail.attachments = detail.has_attachments ? await this.deps.graph.listAttachments(token, row.mail_id, proxy) : [];
        channel = 'graph';
      } else {
        // UID 在 outlook.live.com 与 outlook.office365.com 上一致：先试抓取时的服务器，再试另一个
        const session = new TokenSession(account, this.deps, proxy);
        const first: 'imap_new' | 'imap_old' = row.channel === 'imap_old' ? 'imap_old' : 'imap_new';
        const order: NetChannel[] = [first, first === 'imap_new' ? 'imap_old' : 'imap_new'];
        const chain = await runChannelChain(order, async (ch) => {
          const token = await session.imapToken();
          return this.deps.imap.getDetail(this.outlookImapOptions(account, ch as 'imap_new' | 'imap_old', token, proxy), folder, row.mail_id, row.id_mode || 'uid');
        });
        if (!chain.ok) throw new Error(summarizeErrors(chain.errors));
        detail = chain.value;
        channel = chain.channel;
      }
      cacheModel.updateDetail(row.id, {
        html_content: detail.html_content || row.html_content,
        text_content: detail.text_content || row.text_content,
        attachments: detail.attachments || [],
        has_attachments: !!detail.has_attachments,
        to_addr: detail.to_addr,
      });
      return { ...cacheModel.getById(row.id)!, detail_channel: channel };
    } catch (err: any) {
      logger.warn(`Detail fetch failed for cache#${row.id}: ${err.message}`);
      return { ...row, detail_channel: 'cache', detail_error: err.message };
    }
  }

  async downloadAttachment(cacheId: number, attachmentId: string, proxyId?: number) {
    const row = this.deps.cacheModel.getById(Number(cacheId));
    if (!row) throw new Error('Mail not found');
    const account = this.getAccount(row.account_id);
    const proxy = this.deps.proxyService.resolve(proxyId);
    const folder = toLogicalFolder(row.mailbox);
    if (account.account_type === 'imap') {
      return this.deps.imap.downloadAttachment(this.genericImapOptions(account, proxy), folder, row.mail_id, row.id_mode || 'uid', attachmentId);
    }
    const session = new TokenSession(account, this.deps, proxy);
    if (row.id_mode === 'graph') {
      return this.deps.graph.downloadAttachment(await session.graphToken(), row.mail_id, attachmentId, proxy);
    }
    const first: 'imap_new' | 'imap_old' = row.channel === 'imap_old' ? 'imap_old' : 'imap_new';
    const chain = await runChannelChain([first, first === 'imap_new' ? 'imap_old' : 'imap_new'], async (ch) => {
      const token = await session.imapToken();
      return this.deps.imap.downloadAttachment(this.outlookImapOptions(account, ch as 'imap_new' | 'imap_old', token, proxy), folder, row.mail_id, row.id_mode || 'uid', attachmentId);
    });
    if (!chain.ok) throw new Error(summarizeErrors(chain.errors));
    return chain.value;
  }

  async clearMailbox(accountId: number, mailbox: string, proxyId?: number): Promise<{ channel: string; deleted: number }> {
    const account = this.getAccount(accountId);
    const proxy = this.deps.proxyService.resolve(proxyId);
    const folder = toLogicalFolder(mailbox);
    if (account.account_type === 'imap') {
      const deleted = await this.deps.imap.clearMailbox(this.genericImapOptions(account, proxy), folder);
      return { channel: 'imap', deleted };
    }
    const session = new TokenSession(account, this.deps, proxy);
    const chain = await runChannelChain<number>(getOutlookChannelOrder(account.preferred_channel), async (channel) => {
      if (channel === 'graph') return this.deps.graph.deleteAllMails(await session.graphToken(), folder, proxy);
      return this.deps.imap.clearMailbox(this.outlookImapOptions(account, channel, await session.imapToken(), proxy), folder);
    }, { stopOn: (channel, err) => channel === 'graph' && isTransportError(err) });
    if (!chain.ok) throw new Error(summarizeErrors(chain.errors));
    return { channel: chain.channel, deleted: chain.value };
  }

  /**
   * 刷新单个账户 token（对应源项目 refresh_outlook_account_token）。
   * Outlook：按首选通道先 Graph 或先 IMAP 刷新，成功后写回轮换 refresh_token 并更新首选通道。
   * 普通 IMAP：没有 token，执行一次登录校验。
   */
  async refreshToken(accountId: number, proxyId?: number): Promise<{ id: number; email: string; success: boolean; channel?: string; error?: string; rotated?: boolean }> {
    const { accountModel } = this.deps;
    const account = this.getAccount(accountId);
    const proxy = this.deps.proxyService.resolve(proxyId);
    if (account.account_type === 'imap') {
      try {
        await this.deps.imap.verifyLogin(this.genericImapOptions(account, proxy));
        accountModel.updateTokenRefreshTime(account.id);
        return { id: account.id, email: account.email, success: true, channel: 'imap' };
      } catch (err: any) {
        accountModel.markError(account.id, err.message);
        return { id: account.id, email: account.email, success: false, error: err.message };
      }
    }
    const res = await this.deps.oauth.testRefreshToken(account.client_id, account.refresh_token, proxy, account.preferred_channel);
    if (!res.success) {
      accountModel.markError(account.id, res.error || '');
      return { id: account.id, email: account.email, success: false, error: res.error };
    }
    const rotated = !!res.refresh_token && res.refresh_token !== account.refresh_token;
    accountModel.updateTokenRefreshTime(account.id, rotated ? res.refresh_token : undefined);
    if (res.channel === 'graph') accountModel.recordPreferredChannel(account.id, 'graph');
    else if (!String(account.preferred_channel || '').startsWith('imap')) accountModel.recordPreferredChannel(account.id, 'imap_new');
    return { id: account.id, email: account.email, success: true, channel: res.channel, rotated };
  }

  /** 批量刷新（并发 3），ids 为空时刷新全部账户 */
  async refreshTokens(ids?: number[], proxyId?: number, concurrency = 3) {
    const accounts = ids && ids.length ? this.deps.accountModel.getByIds(ids) : this.deps.accountModel.getAll();
    const results: Awaited<ReturnType<MailService['refreshToken']>>[] = [];
    let cursor = 0;
    const worker = async () => {
      while (cursor < accounts.length) {
        const acc = accounts[cursor++];
        try {
          results.push(await this.refreshToken(acc.id, proxyId));
        } catch (err: any) {
          results.push({ id: acc.id, email: acc.email, success: false, error: err.message });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, accounts.length) }, worker));
    return {
      total: accounts.length,
      success: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results,
    };
  }
}
