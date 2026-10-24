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
  tags: Tag[];
  provider: string;
  account_type: 'outlook' | 'imap';
  imap_host: string;
  imap_port: number;
  imap_password: string;
  preferred_channel: string;
  last_channel: string;
  last_channel_at: string | null;
  last_error: string;
}

export type MailChannel = 'graph' | 'imap_new' | 'imap_old' | 'imap' | 'cache';

export interface ProviderInfo {
  key: string;
  label: string;
  imap_host: string;
  imap_port: number;
  account_type: 'outlook' | 'imap';
}

export interface MailAttachmentMeta {
  id: string;
  name: string;
  content_type: string;
  size: number;
  is_inline?: boolean;
}

// ============ 标签 ============
export interface Tag {
  id: number;
  name: string;
  color: string;
  created_at: string;
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
  id_mode?: string;
  channel?: string;
  has_attachments?: boolean;
  attachments?: MailAttachmentMeta[];
  account_email?: string;
  account_provider?: string;
  detail_channel?: string;
  detail_error?: string;
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

// ============ API ============
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
  separator?: string;
  format?: string[];
  /** auto | outlook | gmail | qq | 163 | 126 | yahoo | aliyun | 2925 | custom */
  provider?: string;
  account_format?: 'client_id_refresh_token' | 'refresh_token_client_id';
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export interface ImportPreviewItem { line: number; email: string; provider: string; account_type: string; imap_host?: string }
export interface ImportPreviewResult {
  newItems: ImportPreviewItem[];
  duplicates: ImportPreviewItem[];
  errors: string[];
}

export interface RefreshResult { id: number; email: string; success: boolean; channel?: string; error?: string; rotated?: boolean }
export interface BatchRefreshResult { total: number; success: number; failed: number; results: RefreshResult[] }

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
  protocol: 'graph' | 'imap' | 'cache';
  channel: MailChannel;
  cached: boolean;
  errors?: Record<string, string>;
}
