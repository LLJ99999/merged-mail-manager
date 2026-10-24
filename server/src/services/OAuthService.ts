/**
 * Microsoft OAuth token 刷新 —— 移植自 assast/outlookEmail (03_mail_helpers.py / 05_routes_refresh_mail.py)
 *
 * 关键语义：
 *  - Graph 与 IMAP 使用不同端点与 scope，且**绝不**在同一次请求里混用两个资源的 scope
 *    （混用会触发 AADSTS70011 "The provided value for the input parameter 'scope' is not valid"）。
 *      Graph : https://login.microsoftonline.com/common/oauth2/v2.0/token
 *              按候选 scope 逐级降级：configured → read_write → read → .default（→ 不带 scope）
 *              仅当返回 invalid_scope / consent_required / AADSTS70011 等"可重试"错误时才降级
 *      IMAP  : https://login.microsoftonline.com/consumers/oauth2/v2.0/token
 *              scope = https://outlook.office.com/IMAP.AccessAsUser.All offline_access
 *  - 微软可能在响应里返回新的 refresh_token（轮换），调用方必须写回数据库。
 */
import { Proxy } from '../types';
import { httpFetch, HttpResponse, TransportError } from '../utils/http';
import logger from '../utils/logger';

export const TOKEN_URL_GRAPH = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
export const TOKEN_URL_IMAP = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';

export const OAUTH_GRAPH_SCOPES = [
  'https://graph.microsoft.com/Mail.Read',
  'https://graph.microsoft.com/Mail.ReadWrite',
  'https://graph.microsoft.com/Mail.Send',
  'https://graph.microsoft.com/User.Read',
];
export const OAUTH_SCOPES = ['offline_access', ...OAUTH_GRAPH_SCOPES];
export const GRAPH_DEFAULT_TOKEN_SCOPE = 'https://graph.microsoft.com/.default';
export const IMAP_TOKEN_SCOPE = 'https://outlook.office.com/IMAP.AccessAsUser.All offline_access';

export interface TokenResult {
  access_token: string;
  /** 微软返回的新 refresh_token（可能与原值相同或为空） */
  refresh_token?: string;
  scope?: string;
  expires_in?: number;
  /** 实际成功的 scope 候选标签（仅 Graph） */
  scope_label?: string;
}

export class TokenError extends Error {
  constructor(message: string, readonly status: number, readonly details: any, readonly channel: 'graph' | 'imap') {
    super(message);
    this.name = 'TokenError';
  }
}

export function buildGraphRefreshScope(graphScopes: string[]): string {
  const scopes = graphScopes.filter(Boolean);
  if (OAUTH_SCOPES.includes('offline_access')) scopes.push('offline_access');
  return scopes.join(' ');
}

export function getGraphTokenScopeCandidates(includeOriginalScopeFallback = false): [string, string][] {
  const configured = OAUTH_GRAPH_SCOPES.filter(s => s.startsWith('https://graph.microsoft.com/'));
  const readWrite = configured.filter(s => s !== 'https://graph.microsoft.com/Mail.Send');
  const read = readWrite.filter(s => s !== 'https://graph.microsoft.com/Mail.ReadWrite');
  const raw: [string, string][] = [
    ['configured', buildGraphRefreshScope(configured)],
    ['read_write', buildGraphRefreshScope(readWrite)],
    ['read', buildGraphRefreshScope(read)],
    ['default', GRAPH_DEFAULT_TOKEN_SCOPE],
  ];
  if (includeOriginalScopeFallback) raw.push(['original', '']);
  const seen = new Set<string>();
  return raw.filter(([, scope]) => (seen.has(scope) ? false : (seen.add(scope), true)));
}

export function isGraphTokenScopeRetryable(status: number, details: any): boolean {
  if (![400, 401, 403].includes(status)) return false;
  let errorCode = '';
  let text = '';
  if (details && typeof details === 'object') {
    errorCode = String(details.error || '').trim().toLowerCase();
    text = JSON.stringify(details).toLowerCase();
  } else {
    text = String(details || '').toLowerCase();
  }
  if (['invalid_scope', 'consent_required', 'interaction_required'].includes(errorCode)) return true;
  return ['aadsts90023', 'aadsts70000', 'aadsts70011', 'no applicable permissions', 'requested are unauthorized or expired', 'consent', 'invalid scope']
    .some(m => text.includes(m));
}

async function readDetails(res: HttpResponse): Promise<any> {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

/** 常见 AADSTS 错误码的中文提示 */
const AADSTS_HINTS: Record<string, string> = {
  AADSTS70000: 'refresh_token 无效或已失效，请重新获取',
  AADSTS70008: 'refresh_token 已过期，请重新获取',
  AADSTS700082: 'refresh_token 因长期未使用已过期，请重新获取',
  AADSTS50173: '账户密码已修改，refresh_token 已失效',
  AADSTS9002313: '请求格式无效（refresh_token 或 client_id 格式不对）',
  AADSTS700016: 'client_id 不存在或不属于该租户',
  AADSTS70011: 'scope 无效',
  AADSTS50076: '需要多重验证（MFA）',
  AADSTS50079: '需要多重验证（MFA）',
  AADSTS53003: '被条件访问策略阻止',
  AADSTS50034: '账户不存在',
  AADSTS50057: '账户已被禁用',
  AADSTS50053: '账户被锁定（登录尝试过多）',
};

/** 精简微软错误描述：去掉 Trace ID / Correlation ID / Timestamp，并附中文提示 */
export function cleanTokenErrorText(text: string): string {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  const short = raw.replace(/\s*Trace ID:.*$/i, '').trim() || raw;
  const code = short.match(/AADSTS\d+/)?.[0];
  const hint = code && AADSTS_HINTS[code];
  return hint ? `${hint}（${short}）` : short;
}

export function extractTokenError(details: any, fallback = '未知错误'): string {
  if (details && typeof details === 'object') return cleanTokenErrorText(String(details.error_description || details.error || fallback));
  return cleanTokenErrorText(String(details || fallback)).slice(0, 300);
}

export class OAuthService {
  private postForm(url: string, data: Record<string, string>, proxy?: Proxy | null) {
    return httpFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(data).toString(),
    }, proxy);
  }

  /** 对应 request_graph_token_response + get_access_token_graph_result */
  async refreshGraphToken(clientId: string, refreshToken: string, proxy?: Proxy | null, includeOriginalScopeFallback = false): Promise<TokenResult> {
    const candidates = getGraphTokenScopeCandidates(includeOriginalScopeFallback);
    let lastStatus = 0;
    let lastDetails: any = null;
    for (let i = 0; i < candidates.length; i++) {
      const [label, scope] = candidates[i];
      const data: Record<string, string> = { client_id: clientId, grant_type: 'refresh_token', refresh_token: refreshToken };
      if (scope) data.scope = scope;
      const res = await this.postForm(TOKEN_URL_GRAPH, data, proxy);
      if (res.status === 200) {
        const payload = await res.json();
        if (!payload.access_token) throw new TokenError('获取访问令牌失败 (GRAPH_TOKEN_MISSING)', 200, payload, 'graph');
        logger.info(`Graph token refreshed (scope=${label}), rt_rotated=${!!payload.refresh_token && payload.refresh_token !== refreshToken}`);
        return { access_token: payload.access_token, refresh_token: payload.refresh_token, scope: payload.scope, expires_in: payload.expires_in, scope_label: label };
      }
      lastStatus = res.status;
      lastDetails = await readDetails(res);
      if (i === candidates.length - 1 || !isGraphTokenScopeRetryable(res.status, lastDetails)) break;
      logger.warn(`Graph token scope "${label}" rejected, trying next candidate: ${extractTokenError(lastDetails)}`);
    }
    throw new TokenError(`Graph 获取访问令牌失败: ${extractTokenError(lastDetails)}`, lastStatus, lastDetails, 'graph');
  }

  /** 对应 request_imap_token_response + get_access_token_imap_result */
  async refreshImapToken(clientId: string, refreshToken: string, proxy?: Proxy | null): Promise<TokenResult> {
    const res = await this.postForm(TOKEN_URL_IMAP, {
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: IMAP_TOKEN_SCOPE,
    }, proxy);
    if (res.status !== 200) {
      const details = await readDetails(res);
      throw new TokenError(`IMAP 获取访问令牌失败: ${extractTokenError(details)}`, res.status, details, 'imap');
    }
    const payload = await res.json();
    if (!payload.access_token) throw new TokenError('获取访问令牌失败 (IMAP_TOKEN_MISSING)', 200, payload, 'imap');
    logger.info(`IMAP token refreshed, rt_rotated=${!!payload.refresh_token && payload.refresh_token !== refreshToken}`);
    return { access_token: payload.access_token, refresh_token: payload.refresh_token, scope: payload.scope, expires_in: payload.expires_in };
  }

  /**
   * 对应 test_refresh_token：按首选授权类型决定先 Graph 还是先 IMAP，
   * 任一成功即返回（含轮换后的 refresh_token 与实际通道）。
   */
  async testRefreshToken(clientId: string, refreshToken: string, proxy?: Proxy | null, preferred = ''):
    Promise<{ success: boolean; error?: string; refresh_token?: string; channel?: 'graph' | 'imap' }> {
    const order: ('graph' | 'imap')[] = preferred.startsWith('imap') ? ['imap', 'graph'] : ['graph', 'imap'];
    const errors: string[] = [];
    for (const channel of order) {
      try {
        const tok = channel === 'graph'
          ? await this.refreshGraphToken(clientId, refreshToken, proxy, true)
          : await this.refreshImapToken(clientId, refreshToken, proxy);
        return { success: true, refresh_token: String(tok.refresh_token || '').trim(), channel };
      } catch (err: any) {
        const label = channel === 'graph' ? 'Graph' : 'IMAP';
        errors.push(err instanceof TransportError ? `${label} 刷新请求异常: ${err.message}` : `${label} 刷新失败: ${err.message}`);
      }
    }
    return { success: false, error: errors.join('; ') || 'Graph/IMAP 刷新失败' };
  }
}
