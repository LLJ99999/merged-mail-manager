// ============ 账户 ============
export interface Account {
  id: number;
  email: string;
  password: string;
  client_id: string;
  refresh_token: string;
  remark: string;
  status: 'active' | 'inactive' | 'error';
  last_synced_at: string | null;
  token_refreshed_at: string | null;
  created_at: string;
  updated_at: string;
  /** 服务商：outlook / gmail / qq / 163 / 126 / yahoo / aliyun / 2925 / custom */
  provider: string;
  /** 账户类型：outlook = OAuth(Graph+IMAP)；imap = 授权码/密码 IMAP */
  account_type: 'outlook' | 'imap';
  imap_host: string;
  imap_port: number;
  imap_password: string;
  /** 首选/最近成功的网络通道（graph / imap_new / imap_old / imap），下次优先尝试 */
  preferred_channel: string;
  /** 最近一次取信实际使用的通道（含 cache） */
  last_channel: string;
  last_channel_at: string | null;
  last_error: string;
}

export type MailChannel = 'graph' | 'imap_new' | 'imap_old' | 'imap' | 'cache';

export interface MailAttachmentMeta {
  id: string;
  name: string;
  content_type: string;
  size: number;
  is_inline?: boolean;
}

// ============ 邮件 ============
export interface MailMessage {
  id: number;
  account_id: number;
  mailbox: 'INBOX' | 'Junk';
  mail_id: string;
  sender: string;
  sender_name: string;
  subject: string;
  text_content: string;
  html_content: string;
  mail_date: string;
  is_read: boolean;
  cached_at: string;
  to_addr?: string;
  /** graph / uid / sequence —— 详情获取时使用的 ID 模式 */
  id_mode?: string;
  /** 抓取该邮件的通道 */
  channel?: string;
  has_attachments?: boolean | number;
  attachments?: string | MailAttachmentMeta[];
}

// ============ 代理 ============
export interface Proxy {
  id: number;
  name: string;
  type: 'socks5' | 'http';
  host: string;
  port: number;
  username: string;
  password: string;
  is_default: boolean;
  last_tested_at: string | null;
  last_test_ip: string;
  status: 'untested' | 'active' | 'failed';
  created_at: string;
}

// ============ API 响应 ============
export interface ApiResponse<T> {
  code: number;
  data: T;
  message?: string;
}

export interface PaginatedResponse<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ImportRequest {
  content: string;
  separator: string;
  format: string[];
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export interface ExportRequest {
  ids?: number[];
  separator?: string;
  format?: string[];
}

export interface DashboardStats {
  totalAccounts: number;
  activeAccounts: number;
  totalInboxMails: number;
  totalJunkMails: number;
  totalProxies: number;
  activeProxies: number;
  recentMails: MailMessage[];
  accountStats: {
    account_id: number;
    email: string;
    provider?: string;
    last_channel?: string;
    inbox_count: number;
    junk_count: number;
  }[];
  expiringTokens: number;
  errorAccounts: number;
  unusedAccounts: number;
  providerStats: { provider: string; count: number }[];
  channelStats: { channel: string; count: number }[];
}

export interface ProxyTestResult {
  ip: string;
  latency: number;
  status: 'active' | 'failed';
}

export interface FetchMailsResult {
  mails: MailMessage[];
  total: number;
  /** 兼容旧前端：graph / imap */
  protocol: 'graph' | 'imap' | 'cache';
  /** 实际服务本次请求的通道 */
  channel: MailChannel;
  cached: boolean;
  /** 每个失败通道的错误摘要 */
  errors?: Record<string, string>;
}

// ============ 标签 ============
export interface Tag {
  id: number;
  name: string;
  color: string;
  created_at: string;
}

export interface AccountWithTags extends Account {
  tags: Tag[];
}
