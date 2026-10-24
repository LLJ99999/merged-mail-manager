/**
 * 账户导入解析 —— 移植自 assast/outlookEmail
 * (02_groups_accounts.py: is_probable_client_id / resolve_outlook_token_order /
 *  parse_outlook_account_string / parse_imap_account_string / parse_account_import)
 *
 * 支持格式（分隔符默认 ----）：
 *   Outlook : email----password----client_id----refresh_token   （client_id 与 refresh_token 顺序可自动识别）
 *   预设IMAP: email----授权码                                      （gmail/qq/163/126/yahoo/aliyun/2925）
 *   自定义  : email----密码----imap_host----imap_port
 */
import {
  IMAP_PORT,
  IMAP_SERVER_NEW,
  MAIL_PROVIDERS,
  getProviderMeta,
  inferProviderFromEmail,
  normalizeProvider,
} from '../providers/presets';

export interface ParsedAccount {
  email: string;
  password: string;
  client_id: string;
  refresh_token: string;
  provider: string;
  account_type: 'outlook' | 'imap';
  imap_host: string;
  imap_port: number;
  imap_password: string;
}

export type OutlookTokenOrder = 'client_id_refresh_token' | 'refresh_token_client_id';

export interface ParseOptions {
  /** auto | outlook | gmail | qq | 163 | 126 | yahoo | aliyun | 2925 | custom */
  provider?: string;
  separator?: string;
  /** Outlook 第3/4字段的默认顺序（无法自动识别时使用） */
  accountFormat?: OutlookTokenOrder;
  /** 自定义 IMAP 的默认 host/port（行内未提供时使用） */
  imapHost?: string;
  imapPort?: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isProbableClientId(value: string): boolean {
  const v = String(value || '').trim();
  // Python uuid.UUID 也接受去掉横杠/带花括号的写法
  const compact = v.replace(/^\{|\}$/g, '');
  return UUID_RE.test(compact) || /^[0-9a-f]{32}$/i.test(compact);
}

export function resolveOutlookTokenOrder(third: string, fourth: string, accountFormat: OutlookTokenOrder = 'client_id_refresh_token'): [string, string] {
  third = String(third || '').trim();
  fourth = String(fourth || '').trim();
  const thirdIs = isProbableClientId(third);
  const fourthIs = isProbableClientId(fourth);
  if (thirdIs && !fourthIs) return [third, fourth];
  if (fourthIs && !thirdIs) return [fourth, third];
  if (accountFormat === 'refresh_token_client_id') return [fourth, third];
  return [third, fourth];
}

function splitLine(line: string, separator: string): string[] {
  return line.trim().split(separator).map(p => p.trim());
}

export function parseOutlookLine(line: string, opts: ParseOptions = {}): ParsedAccount | null {
  const parts = splitLine(line, opts.separator || '----');
  if (parts.length < 4 || !parts[0]) return null;
  const [email, password, third, fourth] = parts;
  const [client_id, refresh_token] = resolveOutlookTokenOrder(third, fourth, opts.accountFormat);
  if (!client_id || !refresh_token) return null;
  return {
    email,
    password,
    client_id,
    refresh_token,
    provider: 'outlook',
    account_type: 'outlook',
    imap_host: IMAP_SERVER_NEW,
    imap_port: IMAP_PORT,
    imap_password: '',
  };
}

export function parseImapLine(line: string, provider = 'custom', opts: ParseOptions = {}): ParsedAccount | null {
  const parts = splitLine(line, opts.separator || '----');
  if (parts.length < 2 || !parts[0]) return null;
  const email = parts[0];
  const password = parts[1];
  const meta = getProviderMeta(provider, email);
  let imapHost = opts.imapHost || '';
  let imapPort = opts.imapPort || 993;

  if (meta.key === 'custom') {
    if (parts.length >= 4) {
      imapHost = parts[2] || imapHost;
      const port = parseInt(parts[3] || String(imapPort || 993), 10);
      if (Number.isNaN(port)) return null;
      imapPort = port;
    }
    if (!imapHost) return null;
  } else if (meta.key === 'outlook') {
    return null; // Outlook 必须走 OAuth 格式
  } else {
    imapHost = meta.imap_host;
    imapPort = meta.imap_port || 993;
  }
  if (!password || !imapHost) return null;
  return {
    email,
    password: '',
    client_id: '',
    refresh_token: '',
    provider: meta.key,
    account_type: 'imap',
    imap_host: imapHost,
    imap_port: imapPort || 993,
    imap_password: password,
  };
}

/**
 * 自动识别一行属于哪种格式：
 *  - ≥4 段且第3/4段中有一个像 client_id（UUID）或有一段很长（refresh_token）→ Outlook
 *  - 4 段且第4段为纯数字端口 → 自定义 IMAP
 *  - 2 段 → 按邮箱域名推断预设服务商
 */
export function detectLineProvider(line: string, separator = '----'): string {
  const parts = splitLine(line, separator);
  const email = parts[0] || '';
  if (parts.length >= 4) {
    const [, , third, fourth] = parts;
    if (/^\d{1,5}$/.test(fourth) && !isProbableClientId(third) && third.length < 128) return 'custom';
    if (isProbableClientId(third) || isProbableClientId(fourth) || third.length > 100 || fourth.length > 100) return 'outlook';
  }
  if (parts.length === 3 && /^\d{1,5}$/.test(parts[2])) return 'custom';
  const inferred = inferProviderFromEmail(email);
  return inferred;
}

export function parseAccountLine(line: string, opts: ParseOptions = {}): { account: ParsedAccount | null; provider: string; error?: string } {
  const separator = opts.separator || '----';
  const email = splitLine(line, separator)[0] || '';
  let provider = String(opts.provider || 'auto').toLowerCase();
  if (provider === 'auto') provider = detectLineProvider(line, separator);
  provider = provider === 'outlook' ? 'outlook' : normalizeProvider(provider, email);

  if (provider === 'outlook') {
    const account = parseOutlookLine(line, opts);
    return account
      ? { account, provider }
      : { account: null, provider, error: 'Outlook 格式应为 email----password----client_id----refresh_token' };
  }
  const account = parseImapLine(line, provider, opts);
  if (account) return { account, provider: account.provider };
  if (provider === 'custom') {
    return { account: null, provider, error: '自定义 IMAP 格式应为 email----password----host----port' };
  }
  return { account: null, provider, error: `${MAIL_PROVIDERS[provider]?.label || provider} 格式应为 email----授权码` };
}

/** 导出：按账户类型输出各自的原生导入格式，便于再次导入 */
export function formatAccountForExport(acc: Partial<ParsedAccount>, separator = '----'): string {
  if ((acc.account_type || 'outlook') === 'outlook') {
    return [acc.email, acc.password, acc.client_id, acc.refresh_token].map(v => v || '').join(separator);
  }
  if (acc.provider === 'custom') {
    return [acc.email, acc.imap_password, acc.imap_host, String(acc.imap_port || 993)].map(v => v || '').join(separator);
  }
  return [acc.email, acc.imap_password].map(v => v || '').join(separator);
}
