import type { ApiResponse, PaginatedResponse, Account, MailMessage, Proxy, ImportRequest, ImportResult, ExportRequest, DashboardStats, ProxyTestResult, FetchMailsResult, Tag, ImportPreviewResult, ProviderInfo, RefreshResult, BatchRefreshResult } from '../types';
import { arr, normalizeAccount, normalizeFetchResult, normalizeMail, normalizePage, normalizeProxy, normalizeStats, num, str } from './normalize';

const API_BASE = '/api';

function qs(params?: Record<string, any>): string {
  if (!params) return '';
  return Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}

/** 请求被 AbortController 取消（页面切换 / 用户取消批量收取）——调用方应静默忽略 */
export function isAbortError(e: unknown): boolean {
  return !!e && typeof e === 'object' && ((e as any).name === 'AbortError' || (e as any).code === 20);
}

/** 需要访问密码（401）：登录框会弹出，调用方不必再 toast「Unauthorized」 */
export class AuthError extends Error {
  constructor() { super('需要访问密码，请先登录'); this.name = 'AuthError'; }
}
export function isAuthError(e: unknown): boolean {
  return e instanceof AuthError || (!!e && typeof e === 'object' && (e as any).name === 'AuthError');
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem('auth_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${url}`, { ...options, headers });
  } catch (e) {
    if (isAbortError(e)) throw e;
    throw new Error('无法连接到服务器，请确认服务仍在运行');
  }

  if (res.status === 401) {
    localStorage.removeItem('auth_token');
    window.dispatchEvent(new Event('auth-required'));
    throw new AuthError();
  }

  // 反向代理 / 崩溃时可能返回 HTML 或空响应：给出可读的错误而不是 "Unexpected token <"
  let json: ApiResponse<T> | null = null;
  try {
    json = await res.json();
  } catch (e) {
    if (isAbortError(e)) throw e;
    throw new Error(`服务器返回了无效的响应（HTTP ${res.status}）`);
  }
  if (!json || typeof json !== 'object') throw new Error(`服务器返回了无效的响应（HTTP ${res.status}）`);
  if (json.code !== 200) throw new Error(json.message || `请求失败（${json.code ?? res.status}）`);
  return json.data;
}

const signalOpt = (signal?: AbortSignal): RequestInit => (signal ? { signal } : {});

/**
 * 客户端兜底超时：服务端每次收取有 FETCH_TIMEOUT（默认 45 秒）总时限，正常不会触发；
 * 这里防止旧版本服务端 / 反向代理 / 网络异常时请求永远挂起（批量收取进度永远不结束）。
 * 外部 signal（用户取消）中止时抛 AbortError，超时则抛可读的错误。
 */
export const CLIENT_FETCH_TIMEOUT_MS = 120_000;
async function withClientTimeout<T>(ms: number, signal: AbortSignal | undefined, run: (s: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = window.setTimeout(() => { timedOut = true; ctrl.abort(); }, ms);
  const onAbort = () => ctrl.abort();
  if (signal) { if (signal.aborted) ctrl.abort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  try {
    return await run(ctrl.signal);
  } catch (e) {
    if (timedOut && isAbortError(e)) throw new Error(`请求超时：服务器 ${Math.round(ms / 1000)} 秒内没有返回结果（网络 / 代理过慢，或服务端版本过旧）`);
    throw e;
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export interface VersionInfo { version: string | null; webBuildVersion: string | null; match: boolean; node?: string; startedAt?: string }
export const versionApi = {
  get: async (): Promise<VersionInfo> => {
    const r: any = await request<VersionInfo>('/version', { cache: 'no-store' });
    return { version: r?.version ? str(r.version) : null, webBuildVersion: r?.webBuildVersion ? str(r.webBuildVersion) : null, match: !!r?.match, node: str(r?.node), startedAt: str(r?.startedAt) };
  },
};

export const accountApi = {
  list: async (params?: { page?: number; pageSize?: number; search?: string; provider?: string; status?: string }, signal?: AbortSignal) =>
    normalizePage(await request<PaginatedResponse<Account>>(`/accounts?${qs(params)}`, signalOpt(signal)), normalizeAccount),
  providers: () => request<ProviderInfo[]>('/accounts/providers'),
  refreshToken: (id: number) =>
    request<RefreshResult>(`/accounts/${id}/refresh-token`, { method: 'POST', body: '{}' }),
  refreshTokens: async (ids?: number[]): Promise<BatchRefreshResult> => {
    const r: any = await request<BatchRefreshResult>('/accounts/refresh-tokens', { method: 'POST', body: JSON.stringify({ ids }) });
    return { total: num(r?.total), success: num(r?.success), failed: num(r?.failed), results: Array.isArray(r?.results) ? r.results : [] };
  },
  create: (data: Partial<Account>) =>
    request<Account>('/accounts', { method: 'POST', body: JSON.stringify(data) }),
  update: async (id: number, data: Partial<Account>) => {
    const a = normalizeAccount(await request<Account>(`/accounts/${id}`, { method: 'PUT', body: JSON.stringify(data) }));
    if (!a) throw new Error('服务器返回的账户数据无效');
    return a;
  },
  delete: (id: number) =>
    request<{ deleted: boolean }>(`/accounts/${id}`, { method: 'DELETE' }),
  batchDelete: (ids: number[]) =>
    request<{ deleted: number }>('/accounts/batch-delete', { method: 'POST', body: JSON.stringify({ ids }) }),
  import: (data: ImportRequest) =>
    request<ImportResult>('/accounts/import', { method: 'POST', body: JSON.stringify(data) }),
  importPreview: async (data: ImportRequest): Promise<ImportPreviewResult> => {
    const r: any = await request<ImportPreviewResult>('/accounts/import-preview', { method: 'POST', body: JSON.stringify(data) });
    const item = (d: any) => (d && typeof d === 'object' ? { line: num(d.line), email: str(d.email), provider: str(d.provider, 'custom'), account_type: str(d.account_type), imap_host: str(d.imap_host) } : null);
    return { newItems: arr(r?.newItems, item), duplicates: arr(r?.duplicates, item), errors: arr(r?.errors, (e: any) => str(e)) };
  },
  importConfirm: async (data: ImportRequest & { mode: 'skip' | 'overwrite' }): Promise<ImportResult> => {
    const r: any = await request<ImportResult>('/accounts/import-confirm', { method: 'POST', body: JSON.stringify(data) });
    return { imported: num(r?.imported), skipped: num(r?.skipped), errors: arr(r?.errors, (e: any) => str(e)) };
  },
  export: (data: ExportRequest) =>
    request<{ content: string; count: number }>('/accounts/export', { method: 'POST', body: JSON.stringify(data) }),
};

export const mailApi = {
  fetch: async (data: { account_id: number; mailbox: string; proxy_id?: number; top?: number }, signal?: AbortSignal) =>
    normalizeFetchResult(await withClientTimeout(CLIENT_FETCH_TIMEOUT_MS, signal, s => request<FetchMailsResult>('/mails/fetch', { method: 'POST', body: JSON.stringify(data), signal: s }))),
  cached: async (params: { account_id: number; mailbox: string; page?: number; pageSize?: number }, signal?: AbortSignal) =>
    normalizePage(await request<PaginatedResponse<MailMessage>>(`/mails/cached?${qs(params)}`, signalOpt(signal)), normalizeMail),
  detail: async (id: number, signal?: AbortSignal) => {
    const m = normalizeMail(await request<MailMessage>(`/mails/${id}/detail`, signalOpt(signal)));
    if (!m) throw new Error('邮件详情无效');
    return m;
  },
  attachmentUrl: (mailId: number, attachmentId: string) => `${API_BASE}/mails/${mailId}/attachments/${encodeURIComponent(attachmentId)}`,
  clear: (data: { account_id: number; mailbox: string; proxy_id?: number }) =>
    request<{ message: string }>('/mails/clear', { method: 'DELETE', body: JSON.stringify(data) }),
};

export const proxyApi = {
  list: async () => arr(await request<Proxy[]>('/proxies'), normalizeProxy),
  create: (data: Partial<Proxy>) =>
    request<Proxy>('/proxies', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: Partial<Proxy>) =>
    request<Proxy>(`/proxies/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: number) =>
    request<{ deleted: boolean }>(`/proxies/${id}`, { method: 'DELETE' }),
  test: (id: number) =>
    request<ProxyTestResult>(`/proxies/${id}/test`, { method: 'POST' }),
  setDefault: (id: number) =>
    request<Proxy>(`/proxies/${id}/default`, { method: 'PUT' }),
};

export const dashboardApi = {
  stats: async (signal?: AbortSignal) => normalizeStats(await request<DashboardStats>('/dashboard/stats', signalOpt(signal))),
};

export const authApi = {
  check: () => request<{ required: boolean }>('/auth/check'),
  login: (password: string) =>
    request<{ token: string; required: boolean }>('/auth/login', { method: 'POST', body: JSON.stringify({ password }) }),
};

export const tagApi = {
  list: async () => arr(await request<unknown>('/tags'), (t: any) => (t && typeof t === 'object' && t.id != null ? { ...t, id: num(t.id), name: str(t.name), color: str(t.color, '#6750A4') } as Tag : null)),
  create: (data: { name: string; color?: string }) =>
    request<Tag>('/tags', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: { name?: string; color?: string }) =>
    request<Tag>(`/tags/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: number) =>
    request<{ deleted: boolean }>(`/tags/${id}`, { method: 'DELETE' }),
  setAccountTags: (accountId: number, tagIds: number[]) =>
    request<{ account_id: number; tag_ids: number[] }>(
      `/accounts/${accountId}/tags`,
      { method: 'POST', body: JSON.stringify({ tag_ids: tagIds }) }
    ),
};
