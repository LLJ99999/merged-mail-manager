/**
 * 邮箱服务商预设表 —— 移植自 assast/outlookEmail (outlook_web/segments/01_bootstrap.py)
 * MAIL_PROVIDERS / DOMAIN_PROVIDER_MAP / PROVIDER_FOLDER_MAP / IMAP_FOLDER_MATCH_ALIASES
 */

export const IMAP_SERVER_NEW = 'outlook.live.com';
export const IMAP_SERVER_OLD = 'outlook.office365.com';
export const IMAP_PORT = 993;

export type AccountType = 'outlook' | 'imap';

export interface ProviderMeta {
  key: string;
  label: string;
  imap_host: string;
  imap_port: number;
  account_type: AccountType;
}

export const MAIL_PROVIDERS: Record<string, Omit<ProviderMeta, 'key'>> = {
  outlook: { label: 'Outlook', imap_host: IMAP_SERVER_NEW, imap_port: 993, account_type: 'outlook' },
  gmail: { label: 'Gmail', imap_host: 'imap.gmail.com', imap_port: 993, account_type: 'imap' },
  qq: { label: 'QQ邮箱', imap_host: 'imap.qq.com', imap_port: 993, account_type: 'imap' },
  '163': { label: '163邮箱', imap_host: 'imap.163.com', imap_port: 993, account_type: 'imap' },
  '126': { label: '126邮箱', imap_host: 'imap.126.com', imap_port: 993, account_type: 'imap' },
  yahoo: { label: 'Yahoo', imap_host: 'imap.mail.yahoo.com', imap_port: 993, account_type: 'imap' },
  aliyun: { label: '阿里邮箱', imap_host: 'imap.aliyun.com', imap_port: 993, account_type: 'imap' },
  '2925': { label: '2925邮箱', imap_host: 'imap.2925.com', imap_port: 993, account_type: 'imap' },
  custom: { label: '自定义 IMAP', imap_host: '', imap_port: 993, account_type: 'imap' },
};

/** 展示顺序（JS 对象中数字键会被提前，故单独维护） */
export const PROVIDER_ORDER = ['outlook', 'gmail', 'qq', '163', '126', 'yahoo', 'aliyun', '2925', 'custom'];

export const DOMAIN_PROVIDER_MAP: Record<string, string> = {
  'outlook.com': 'outlook',
  'hotmail.com': 'outlook',
  'live.com': 'outlook',
  'live.cn': 'outlook',
  'gmail.com': 'gmail',
  'googlemail.com': 'gmail',
  'qq.com': 'qq',
  'foxmail.com': 'qq',
  '163.com': '163',
  '126.com': '126',
  'yahoo.com': 'yahoo',
  'yahoo.co.jp': 'yahoo',
  'yahoo.co.uk': 'yahoo',
  'aliyun.com': 'aliyun',
  'alimail.com': 'aliyun',
  '2925.com': '2925',
};

/** 逻辑文件夹 → 各服务商候选 IMAP 文件夹名 */
export const PROVIDER_FOLDER_MAP: Record<string, Record<string, string[]>> = {
  gmail: {
    inbox: ['INBOX', 'Inbox'],
    junkemail: ['[Gmail]/Spam', '[Gmail]/垃圾邮件'],
    deleteditems: ['[Gmail]/Trash', '[Gmail]/已删除邮件'],
  },
  qq: {
    inbox: ['INBOX', 'Inbox'],
    junkemail: ['Junk', '&V4NXPpCuTvY-'],
    deleteditems: ['Deleted Messages', '&XfJT0ZABkK5O9g-'],
  },
  '163': {
    inbox: ['INBOX', 'Inbox'],
    junkemail: ['Junk', '&V4NXPpCuTvY-'],
    deleteditems: ['Deleted Messages', '&XfJT0ZABkK5O9g-'],
  },
  '126': {
    inbox: ['INBOX', 'Inbox'],
    junkemail: ['Junk', '&V4NXPpCuTvY-'],
    deleteditems: ['Deleted Messages', '&XfJT0ZABkK5O9g-'],
  },
  yahoo: {
    inbox: ['INBOX', 'Inbox'],
    junkemail: ['Bulk Mail', 'Spam'],
    deleteditems: ['Trash'],
  },
  '2925': {
    inbox: ['INBOX', 'Inbox'],
    junkemail: ['&V4NXPnux-', 'Junk', 'Junk Email', 'Spam', 'SPAM'],
    deleteditems: ['&XfJT0ZAB-', 'Trash', 'Deleted', 'Deleted Items', 'Deleted Messages'],
  },
  _default: {
    inbox: ['INBOX', 'Inbox'],
    junkemail: ['Junk', 'Junk Email', 'Spam', 'SPAM', 'Bulk Mail'],
    deleteditems: ['Trash', 'Deleted', 'Deleted Items', 'Deleted Messages'],
  },
};

export const IMAP_FOLDER_MATCH_ALIASES: Record<string, Set<string>> = {
  inbox: new Set(['inbox', '收件箱']),
  junkemail: new Set(['junk', 'junk email', 'spam', 'bulk mail', '垃圾邮件', '垃圾箱']),
  deleteditems: new Set(['trash', 'deleted', 'deleted items', 'deleted messages', '已删除邮件', '垃圾箱']),
};

/** IMAP ID 字段（163/126 等网易邮箱要求客户端先发送 ID，否则 SELECT 报 Unsafe Login） */
export const IMAP_IDENTITY_FIELDS = {
  name: process.env.IMAP_ID_NAME || 'outlookEmail',
  version: process.env.IMAP_ID_VERSION || '2.0.0',
  vendor: process.env.IMAP_ID_VENDOR || 'outlookEmail',
  'support-email': process.env.IMAP_ID_SUPPORT_EMAIL || '',
};

export function inferProviderFromEmail(email: string): string {
  if (!email || !email.includes('@')) return 'custom';
  const domain = email.split('@').pop()!.trim().toLowerCase();
  return DOMAIN_PROVIDER_MAP[domain] || 'custom';
}

export function normalizeProvider(provider: string | undefined | null, email = ''): string {
  let p = String(provider || '').trim().toLowerCase();
  if (p === 'custom') {
    const inferred = email ? inferProviderFromEmail(email) : 'custom';
    if (inferred === '2925') p = inferred;
  }
  if (p === 'auto') p = inferProviderFromEmail(email);
  if (!MAIL_PROVIDERS[p]) p = email ? inferProviderFromEmail(email) : 'outlook';
  if (!MAIL_PROVIDERS[p]) p = 'custom';
  return p;
}

export function getProviderMeta(provider: string, email = ''): ProviderMeta {
  const key = normalizeProvider(provider, email);
  return { key, ...(MAIL_PROVIDERS[key] || MAIL_PROVIDERS.custom) };
}

/** 应用层邮箱名（INBOX/Junk）→ 源项目逻辑文件夹名 */
export function toLogicalFolder(mailbox: string): 'inbox' | 'junkemail' {
  const m = String(mailbox || '').toLowerCase();
  return m === 'junk' || m === 'junkemail' || m === 'spam' ? 'junkemail' : 'inbox';
}

export function getImapFolderCandidates(provider: string, folder: string): string[] {
  const providerKey = String(provider || '').trim().toLowerCase() || '_default';
  const folderKey = String(folder || 'inbox').trim().toLowerCase();
  const map = PROVIDER_FOLDER_MAP[providerKey] || PROVIDER_FOLDER_MAP._default;
  return map[folderKey] || PROVIDER_FOLDER_MAP._default[folderKey] || ['INBOX'];
}
