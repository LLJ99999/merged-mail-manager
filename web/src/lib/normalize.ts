import type { Account, DashboardStats, FetchMailsResult, MailAttachmentMeta, MailMessage, PaginatedResponse, Proxy } from '../types';

/**
 * 服务器 / 远端邮箱返回的数据形态并不总是可靠（真实 Graph / IMAP 邮件可能缺字段、为 null、
 * 或是对象/数组；代理或旧版本服务端也可能返回意料之外的结构）。所有 API 数据在进入 store / 组件前
 * 都经过这里归一化，保证组件拿到的字段类型与 types/index.ts 一致，不会因为 `null.length`
 * 之类的异常让整棵 React 树卸载成空白页。
 */

export const str = (v: unknown, fallback = ''): string => {
  if (v == null) return fallback;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(x => str(x)).filter(Boolean).join(', ');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    // 常见的地址对象 { address, name } / { emailAddress: { address } } / { text }
    if (o.emailAddress) return str(o.emailAddress, fallback);
    return str(o.address ?? o.text ?? o.value ?? o.name, fallback);
  }
  return fallback;
};
export const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const bool = (v: unknown) => v === true || v === 1 || v === '1' || v === 'true';
const nullableStr = (v: unknown): string | null => (v == null || v === '' ? null : str(v) || null);
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
export const arr = <T>(v: unknown, map: (x: any) => T | null): T[] => {
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return []; } }
  return Array.isArray(v) ? v.map(x => (x == null ? null : map(x))).filter((x): x is T => x != null) : [];
};

export function normalizeAttachment(a: any, i = 0): MailAttachmentMeta | null {
  if (!isObj(a)) return null;
  return { id: str(a.id, `idx-${i}`), name: str(a.name ?? a.filename, `附件 ${i + 1}`), content_type: str(a.content_type ?? a.contentType, 'application/octet-stream'), size: num(a.size), is_inline: bool(a.is_inline ?? a.isInline) };
}

export function normalizeMail(m: any): MailMessage | null {
  if (!isObj(m)) return null;
  const id = num(m.id, NaN);
  if (!Number.isFinite(id)) return null;
  const attachments = arr(m.attachments, (a: any) => normalizeAttachment(a)).map((a, i) => ({ ...a, id: a.id || `idx-${i}` }));
  const box = str(m.mailbox, 'INBOX');
  return {
    ...m,
    id,
    account_id: num(m.account_id),
    mailbox: box === 'Junk' ? 'Junk' : 'INBOX',
    mail_id: str(m.mail_id),
    sender: str(m.sender),
    sender_name: str(m.sender_name),
    subject: str(m.subject),
    text_content: str(m.text_content),
    html_content: str(m.html_content),
    mail_date: str(m.mail_date),
    is_read: bool(m.is_read),
    cached_at: str(m.cached_at),
    to_addr: str(m.to_addr),
    id_mode: str(m.id_mode),
    channel: str(m.channel),
    has_attachments: bool(m.has_attachments) || attachments.length > 0,
    attachments,
    account_email: str(m.account_email),
    account_provider: str(m.account_provider),
    detail_channel: m.detail_channel == null ? undefined : str(m.detail_channel),
    detail_error: m.detail_error ? str(m.detail_error) : undefined,
  };
}

export const normalizeMails = (v: unknown) => arr(v, normalizeMail);

export function normalizePage<T>(v: any, map: (x: any) => T | null): PaginatedResponse<T> {
  const o = isObj(v) ? v : {};
  const list = arr(o.list, map);
  return { list, total: num(o.total, list.length), page: Math.max(1, num(o.page, 1)), pageSize: Math.max(1, num(o.pageSize, list.length || 20)) };
}

export function normalizeFetchResult(v: any): FetchMailsResult {
  if (!isObj(v)) throw new Error('服务器返回的收取结果无效');
  const mails = normalizeMails(v.mails);
  const channel = str(v.channel, v.cached ? 'cache' : '') as FetchMailsResult['channel'];
  const errors = isObj(v.errors) ? Object.fromEntries(Object.entries(v.errors).map(([k, e]) => [k, str(e)])) : undefined;
  return { mails, total: num(v.total, mails.length), protocol: str(v.protocol, channel === 'graph' ? 'graph' : 'imap') as FetchMailsResult['protocol'], channel, cached: bool(v.cached), errors };
}

export function normalizeAccount(a: any): Account | null {
  if (!isObj(a)) return null;
  const id = num(a.id, NaN);
  if (!Number.isFinite(id)) return null;
  const status = str(a.status, 'active');
  return {
    ...a,
    id,
    email: str(a.email, '(未知邮箱)'),
    password: str(a.password),
    client_id: str(a.client_id),
    refresh_token: str(a.refresh_token),
    remark: str(a.remark),
    status: (['active', 'inactive', 'error'].includes(status) ? status : 'active') as Account['status'],
    last_synced_at: nullableStr(a.last_synced_at),
    token_refreshed_at: nullableStr(a.token_refreshed_at),
    created_at: str(a.created_at),
    updated_at: str(a.updated_at),
    tags: arr(a.tags, (t: any) => (isObj(t) ? { id: num(t.id), name: str(t.name), color: str(t.color, '#888'), created_at: str(t.created_at) } : null)),
    provider: str(a.provider, 'outlook'),
    account_type: str(a.account_type) === 'imap' ? 'imap' : 'outlook',
    imap_host: str(a.imap_host),
    imap_port: num(a.imap_port, 993),
    imap_password: str(a.imap_password),
    preferred_channel: str(a.preferred_channel),
    last_channel: str(a.last_channel),
    last_channel_at: nullableStr(a.last_channel_at),
    last_error: str(a.last_error),
  };
}

export function normalizeStats(v: any): DashboardStats {
  if (!isObj(v)) throw new Error('服务器返回的概览数据无效');
  return {
    totalAccounts: num(v.totalAccounts), activeAccounts: num(v.activeAccounts), totalInboxMails: num(v.totalInboxMails), totalJunkMails: num(v.totalJunkMails),
    totalProxies: num(v.totalProxies), activeProxies: num(v.activeProxies), expiringTokens: num(v.expiringTokens), errorAccounts: num(v.errorAccounts), unusedAccounts: num(v.unusedAccounts),
    recentMails: normalizeMails(v.recentMails),
    accountStats: arr(v.accountStats, (a: any) => (isObj(a) ? { account_id: num(a.account_id), email: str(a.email), provider: str(a.provider), last_channel: str(a.last_channel), inbox_count: num(a.inbox_count), junk_count: num(a.junk_count) } : null)),
    providerStats: arr(v.providerStats, (p: any) => (isObj(p) ? { provider: str(p.provider, 'custom'), count: num(p.count) } : null)),
    channelStats: arr(v.channelStats, (c: any) => (isObj(c) ? { channel: str(c.channel), count: num(c.count) } : null)),
  };
}

export function normalizeProxy(p: any): Proxy | null {
  if (!isObj(p)) return null;
  const id = num(p.id, NaN);
  if (!Number.isFinite(id)) return null;
  const status = str(p.status, 'untested');
  return {
    ...p, id, name: str(p.name), type: str(p.type) === 'http' ? 'http' : 'socks5', host: str(p.host), port: num(p.port), username: str(p.username), password: str(p.password),
    is_default: bool(p.is_default), last_tested_at: nullableStr(p.last_tested_at), last_test_ip: str(p.last_test_ip),
    status: (['untested', 'active', 'failed'].includes(status) ? status : 'untested') as Proxy['status'], created_at: str(p.created_at),
  };
}
