/**
 * IMAP 取信 —— 移植自 assast/outlookEmail
 * (get_emails_imap_with_server / _get_email_detail_imap_result_once / get_emails_imap_generic /
 *  resolve_imap_folder / fetch_imap_message / send_imap_id / download_email_attachment_imap_result)
 *
 * 基于 imapflow：原生支持 SOCKS5 / HTTP CONNECT 代理（proxy URL），所以 IMAP 通道同样走代理。
 *  - Outlook OAuth：XOAUTH2（auth.accessToken），服务器 outlook.live.com（新）/ outlook.office365.com（旧）
 *  - 普通 IMAP：LOGIN 授权码/密码，连接后发送 ID（网易 163/126 需要）
 *  - 列表使用 UID SEARCH，返回 id_mode='uid'；详情优先按 UID 获取，非严格模式下回退序列号
 */
import { ImapFlow, ListResponse, FetchMessageObject } from 'imapflow';
import { simpleParser, ParsedMail } from 'mailparser';
import {
  IMAP_FOLDER_MATCH_ALIASES,
  IMAP_IDENTITY_FIELDS,
  getImapFolderCandidates,
} from '../providers/presets';
import { MailAttachmentMeta } from '../types';
import { CachedMailInput } from '../models/MailCache';
import { sanitizeAttachmentFilename } from './GraphApiService';
import logger from '../utils/logger';
import { currentDeadlineSignal } from '../utils/deadline';

export const IMAP_TIMEOUT_MS = (parseInt(process.env.IMAP_TIMEOUT || '20', 10) || 20) * 1000;

export interface ImapConnectOptions {
  host: string;
  port?: number;
  user: string;
  /** XOAUTH2 access token（Outlook） */
  accessToken?: string;
  /** 密码 / 授权码（普通 IMAP） */
  password?: string;
  /** socks5://… 或 http://… */
  proxyUrl?: string;
  /** 服务商 key，用于文件夹候选与错误提示 */
  provider?: string;
}

export class ImapError extends Error {
  constructor(message: string, readonly code: string, readonly details?: any) {
    super(message);
    this.name = 'ImapError';
  }
}

/** 对应 normalize_imap_auth_error */
export function normalizeImapAuthError(provider: string, host: string, raw: string): string {
  const message = String(raw || '').trim() || 'IMAP 认证失败';
  const lower = message.toLowerCase();
  if (lower.includes('unsafe login') && ['126', '163'].includes(String(provider))) {
    return '网易邮箱拦截了当前 IMAP 登录（Unsafe Login），请在网页端开启 IMAP 并使用客户端授权码；若仍失败，说明当前网络或服务器 IP 被风控';
  }
  if ((provider === 'outlook' || host === 'outlook.live.com' || host === 'outlook.office365.com') && lower.includes('basicauthblocked')) {
    return 'Outlook 已禁用基本认证，请使用 OAuth（client_id + refresh_token）方式导入';
  }
  return message;
}

function normalizeFolderName(name: string): string {
  return String(name || '').trim().toLowerCase();
}

/** 对应 rank_imap_listed_mailboxes：按别名 / special-use 排序服务器实际文件夹 */
export function rankListedMailboxes(folder: string, candidates: string[], listed: ListResponse[]): string[] {
  const aliases = IMAP_FOLDER_MATCH_ALIASES[folder] || new Set<string>();
  const specialUse = folder === 'junkemail' ? '\\Junk' : folder === 'deleteditems' ? '\\Trash' : folder === 'inbox' ? '\\Inbox' : '';
  const scored: { path: string; score: number }[] = [];
  const candSet = new Set(candidates.map(normalizeFolderName));
  for (const box of listed) {
    if (box.flags?.has('\\Noselect')) continue;
    let score = 0;
    if (specialUse && box.specialUse === specialUse) score += 100;
    const name = normalizeFolderName(box.name);
    const path = normalizeFolderName(box.path);
    if (candSet.has(path) || candSet.has(name)) score += 50;
    if (aliases.has(name) || aliases.has(path)) score += 40;
    else if ([...aliases].some(a => name.includes(a))) score += 10;
    if (score > 0) scored.push({ path: box.path, score });
  }
  return scored.sort((a, b) => b.score - a.score).map(s => s.path);
}

export function toAttachmentMeta(parsed: ParsedMail): MailAttachmentMeta[] {
  return (parsed.attachments || []).map((att, idx) => ({
    id: `idx-${idx}`,
    name: sanitizeAttachmentFilename(att.filename || '', `attachment-${idx + 1}`),
    content_type: att.contentType || 'application/octet-stream',
    size: att.size || att.content?.length || 0,
    is_inline: att.contentDisposition === 'inline' || !!att.related,
  }));
}

function parsedToMail(parsed: ParsedMail, msg: FetchMessageObject, idMode: 'uid' | 'sequence'): CachedMailInput {
  const from = parsed.from?.value?.[0];
  const toText = Array.isArray(parsed.to) ? parsed.to.map(t => t.text).join(', ') : parsed.to?.text || '';
  const internal = msg.internalDate ? new Date(msg.internalDate as any) : null;
  const date = parsed.date || internal;
  const attachments = toAttachmentMeta(parsed);
  return {
    mail_id: String(idMode === 'uid' ? msg.uid : msg.seq),
    sender: from?.address || parsed.from?.text || '',
    sender_name: from?.name || '',
    subject: parsed.subject || '',
    text_content: parsed.text || '',
    html_content: typeof parsed.html === 'string' ? parsed.html : '',
    mail_date: date && !Number.isNaN(date.getTime()) ? date.toISOString() : '',
    is_read: !!msg.flags?.has('\\Seen'),
    to_addr: toText,
    id_mode: idMode,
    has_attachments: attachments.length > 0,
    attachments,
  };
}

export class ImapService {
  /** 建立连接并认证；失败抛 ImapError（认证错误）或原始错误（网络错误） */
  async connect(opts: ImapConnectOptions): Promise<ImapFlow> {
    const clientInfo: Record<string, string> = {};
    for (const [k, v] of Object.entries(IMAP_IDENTITY_FIELDS)) if (v) clientInfo[k] = v;
    const client = new ImapFlow({
      host: opts.host,
      port: opts.port || 993,
      secure: (opts.port || 993) === 993,
      auth: opts.accessToken ? { user: opts.user, accessToken: opts.accessToken } : { user: opts.user, pass: opts.password || '' },
      clientInfo: clientInfo as any, // 对应 send_imap_id
      proxy: opts.proxyUrl,
      logger: false,
      disableAutoIdle: true,
      connectionTimeout: IMAP_TIMEOUT_MS,
      greetingTimeout: Math.min(IMAP_TIMEOUT_MS, 15000),
      socketTimeout: Math.max(IMAP_TIMEOUT_MS * 2, 30000),
      tls: { rejectUnauthorized: false },
    });
    client.on('error', (err: Error) => logger.warn(`IMAP ${opts.host} error: ${err.message}`));
    // 收取总时限到期（utils/deadline）时强制断开：正在进行的 LOGIN / SELECT / FETCH 立即失败，不会无限挂起
    const deadline = currentDeadlineSignal();
    if (deadline) {
      if (deadline.aborted) throw deadline.reason;
      const onAbort = () => { try { client.close(); } catch { /* ignore */ } };
      deadline.addEventListener('abort', onAbort, { once: true });
      client.once('close', () => deadline.removeEventListener('abort', onAbort));
    }
    try {
      await client.connect();
    } catch (err: any) {
      if (deadline?.aborted) throw deadline.reason;
      if (err?.authenticationFailed || /auth|login|credentials|unsafe/i.test(String(err?.responseText || err?.message || ''))) {
        throw new ImapError(normalizeImapAuthError(opts.provider || '', opts.host, err?.responseText || err?.message), 'IMAP_AUTH_FAILED');
      }
      const raw = String(err?.message || err);
      if (/timeout|timed out|greeting/i.test(raw) || err?.code === 'ETIMEOUT' || err?.code === 'ETIMEDOUT') {
        err.message = `IMAP 连接超时（${opts.host}:${opts.port || 993}${opts.proxyUrl ? '，经代理' : ''}）：${raw}`;
      }
      throw err;
    }
    return client;
  }

  /** 对应 resolve_imap_folder：候选名 → LIST 后按别名/special-use 匹配 */
  async resolveFolder(client: ImapFlow, provider: string, folder: string): Promise<string> {
    const candidates = [...new Set(getImapFolderCandidates(provider, folder))];
    let listed: ListResponse[] = [];
    try { listed = await client.list(); } catch { listed = []; }
    const listedPaths = new Set(listed.map(b => b.path));
    // 1) 候选名中服务器真实存在的
    for (const c of candidates) {
      if (listedPaths.has(c)) return c;
    }
    // 2) 按 special-use / 别名排序后的服务器文件夹
    const ranked = rankListedMailboxes(folder, candidates, listed);
    if (ranked.length) return ranked[0];
    // 3) LIST 失败时直接尝试候选名
    if (!listed.length && candidates.length) return candidates[0];
    throw new ImapError('IMAP 文件夹不存在或无权访问', 'IMAP_FOLDER_NOT_FOUND', {
      tried_folders: candidates,
      available_folders: listed.slice(0, 20).map(b => b.path),
    });
  }

  /** 列表：对应 get_emails_imap_with_server / get_emails_imap_generic（最新在前，按 UID 分页） */
  async fetchMails(opts: ImapConnectOptions, folder: string, top = 50, skip = 0): Promise<CachedMailInput[]> {
    const client = await this.connect(opts);
    try {
      const path = await this.resolveFolder(client, opts.provider || '_default', folder);
      const lock = await client.getMailboxLock(path, { readOnly: true });
      try {
        let ids: number[] = [];
        let idMode: 'uid' | 'sequence' = 'uid';
        const uids = await client.search({ all: true }, { uid: true }).catch(() => false as const);
        if (uids && uids.length >= 0) {
          ids = uids as number[];
        } else {
          // 服务器拒绝 UID SEARCH（如阿里云返回 BAD）时按 EXISTS 枚举序列号
          const exists = (client.mailbox && typeof client.mailbox === 'object') ? client.mailbox.exists : 0;
          ids = Array.from({ length: exists }, (_, i) => i + 1);
          idMode = 'sequence';
        }
        if (!ids.length) return [];
        ids.sort((a, b) => a - b);
        const total = ids.length;
        const start = Math.max(0, total - skip - top);
        const end = Math.max(0, total - skip);
        const page = ids.slice(start, end).reverse();
        if (!page.length) return [];

        const mails: CachedMailInput[] = [];
        for await (const msg of client.fetch(page, { uid: true, flags: true, internalDate: true, source: true }, { uid: idMode === 'uid' })) {
          try {
            if (!msg.source) continue;
            const parsed = await simpleParser(msg.source);
            mails.push(parsedToMail(parsed, msg, idMode));
          } catch (err: any) {
            logger.warn(`IMAP parse error: ${err.message}`);
          }
        }
        mails.sort((a, b) => String(b.mail_date).localeCompare(String(a.mail_date)));
        logger.info(`IMAP ${opts.host} fetched ${mails.length} mails from ${path}`);
        return mails;
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => client.close());
    }
  }

  /**
   * 原始邮件获取：对应 fetch_imap_message（preferred_mode + allow_id_mode_fallback）
   * strict=true 时只用首选 ID 模式。
   */
  private async fetchRaw(client: ImapFlow, messageId: string, preferredMode: string, strict: boolean): Promise<{ msg: FetchMessageObject; mode: 'uid' | 'sequence' }> {
    const pref: 'uid' | 'sequence' = preferredMode === 'sequence' ? 'sequence' : 'uid';
    const modes: ('uid' | 'sequence')[] = [pref];
    if (!strict) modes.push(pref === 'uid' ? 'sequence' : 'uid');
    const attempts: any[] = [];
    for (const mode of modes) {
      try {
        const msg = await client.fetchOne(String(messageId), { uid: true, flags: true, internalDate: true, source: true }, { uid: mode === 'uid' });
        attempts.push({ mode, payload_present: !!(msg && msg.source) });
        if (msg && msg.source) return { msg, mode };
      } catch (err: any) {
        attempts.push({ mode, error: err.message });
      }
    }
    throw new ImapError('获取邮件详情失败', 'EMAIL_DETAIL_FETCH_FAILED', { message_id: messageId, preferred_id_mode: pref, fetch_attempts: attempts });
  }

  async withMessage<T>(opts: ImapConnectOptions, folder: string, messageId: string, idMode: string, fn: (parsed: ParsedMail, msg: FetchMessageObject, mode: 'uid' | 'sequence') => Promise<T> | T, strict = false): Promise<T> {
    const client = await this.connect(opts);
    try {
      const path = await this.resolveFolder(client, opts.provider || '_default', folder);
      const lock = await client.getMailboxLock(path, { readOnly: true });
      try {
        const { msg, mode } = await this.fetchRaw(client, messageId, idMode || 'uid', strict);
        const parsed = await simpleParser(msg.source!);
        return await fn(parsed, msg, mode);
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => client.close());
    }
  }

  /** 详情：对应 _get_email_detail_imap_result_once（Honor UID 模式） */
  async getDetail(opts: ImapConnectOptions, folder: string, messageId: string, idMode = 'uid', strict = false): Promise<CachedMailInput> {
    return this.withMessage(opts, folder, messageId, idMode, (parsed, msg, mode) => parsedToMail(parsed, msg, mode), strict);
  }

  /** 附件下载：对应 download_email_attachment_imap_result（attachment id = idx-N） */
  async downloadAttachment(opts: ImapConnectOptions, folder: string, messageId: string, idMode: string, attachmentId: string) {
    return this.withMessage(opts, folder, messageId, idMode, (parsed) => {
      const idx = parseInt(String(attachmentId).replace(/^idx-/, ''), 10);
      const att = parsed.attachments?.[idx];
      if (!att) throw new ImapError('附件不存在', 'ATTACHMENT_NOT_FOUND');
      return {
        filename: sanitizeAttachmentFilename(att.filename || '', `attachment-${idx + 1}`),
        content_type: att.contentType || 'application/octet-stream',
        content: att.content as Buffer,
      };
    });
  }

  /** 清空文件夹：\Deleted + EXPUNGE */
  async clearMailbox(opts: ImapConnectOptions, folder: string): Promise<number> {
    const client = await this.connect(opts);
    try {
      const path = await this.resolveFolder(client, opts.provider || '_default', folder);
      const lock = await client.getMailboxLock(path);
      try {
        const uids = (await client.search({ all: true }, { uid: true })) || [];
        if (!uids.length) return 0;
        await client.messageDelete(uids, { uid: true });
        logger.info(`IMAP cleared ${uids.length} mails from ${path}`);
        return uids.length;
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => client.close());
    }
  }

  /** 仅验证登录（批量"刷新"普通 IMAP 账户时使用） */
  async verifyLogin(opts: ImapConnectOptions): Promise<void> {
    const client = await this.connect(opts);
    await client.logout().catch(() => client.close());
  }
}
