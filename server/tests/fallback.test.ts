/**
 * 回退链 / token 轮换 / 导入解析 单元测试（全部使用 mock，不发起任何真实网络请求）
 * 运行：npm test
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';

const tmpDb = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mmm-test-')), 'test.db');
process.env.DB_PATH = tmpDb;
process.env.LOG_LEVEL = 'error';

// 动态导入，保证 DB_PATH 先生效
let runMigrations: typeof import('../src/database/migrations').runMigrations;
let AccountModel: typeof import('../src/models/Account').AccountModel;
let MailCacheModel: typeof import('../src/models/MailCache').MailCacheModel;
let MailService: typeof import('../src/services/MailService').MailService;
let FetchChain: typeof import('../src/services/FetchChain');
let Import: typeof import('../src/services/ImportParser');
let OAuth: typeof import('../src/services/OAuthService');
let TransportError: typeof import('../src/utils/http').TransportError;

before(async () => {
  ({ runMigrations } = await import('../src/database/migrations'));
  ({ AccountModel } = await import('../src/models/Account'));
  ({ MailCacheModel } = await import('../src/models/MailCache'));
  ({ MailService } = await import('../src/services/MailService'));
  FetchChain = await import('../src/services/FetchChain');
  Import = await import('../src/services/ImportParser');
  OAuth = await import('../src/services/OAuthService');
  ({ TransportError } = await import('../src/utils/http'));
  runMigrations();
});

const CLIENT_ID = '9e5f94bc-e8a4-4e73-b8be-63364c29d753';
const RT = 'M.C5' + 'x'.repeat(200);

type Behaviour = 'ok' | 'fail' | 'transport';

/** 构造 mock 依赖：记录调用顺序，按配置成功/失败 */
function makeDeps(cfg: { graphToken?: Behaviour; graphFetch?: Behaviour; imapToken?: Behaviour; imapNew?: Behaviour; imapOld?: Behaviour; rotate?: boolean; generic?: Behaviour }) {
  const calls: string[] = [];
  const tokensSeen: string[] = [];
  let rotation = 0;
  const fail = (b: Behaviour | undefined, label: string) => {
    if (b === 'transport') throw new TransportError(`${label}: ECONNREFUSED (mock proxy down)`);
    if (b === 'fail') throw new Error(`${label}: mock failure`);
  };
  const mail = (id: string, idMode: string) => ({
    mail_id: id, sender: 'a@b.com', sender_name: 'A', subject: `subject ${id}`, text_content: 'hi', html_content: '<p>hi</p>',
    mail_date: new Date().toISOString(), id_mode: idMode,
  });
  const oauth = {
    async refreshGraphToken(_c: string, rt: string) {
      calls.push('token:graph'); tokensSeen.push(rt);
      fail(cfg.graphToken, 'graph-token');
      return { access_token: 'g-access', refresh_token: cfg.rotate ? `${RT}-rot${++rotation}` : rt };
    },
    async refreshImapToken(_c: string, rt: string) {
      calls.push('token:imap'); tokensSeen.push(rt);
      fail(cfg.imapToken, 'imap-token');
      return { access_token: 'i-access', refresh_token: cfg.rotate ? `${RT}-rot${++rotation}` : rt };
    },
    async testRefreshToken() {
      calls.push('test-refresh');
      return { success: true, refresh_token: `${RT}-refreshed`, channel: 'graph' as const };
    },
  };
  const graph = {
    async fetchMails() { calls.push('graph'); fail(cfg.graphFetch, 'graph-fetch'); return [mail('AAMk-1', 'graph')]; },
  };
  const imap = {
    async fetchMails(opts: any) {
      if (opts.accessToken) {
        const ch = opts.host === 'outlook.live.com' ? 'imap_new' : 'imap_old';
        calls.push(ch);
        fail(ch === 'imap_new' ? cfg.imapNew : cfg.imapOld, ch);
      } else {
        calls.push('imap_generic');
        fail(cfg.generic, 'imap_generic');
      }
      return [mail('101', 'uid')];
    },
    async verifyLogin() { calls.push('verify'); },
  };
  const proxyService = { resolve: () => undefined, imapProxyUrl: () => undefined };
  return { deps: { oauth, graph, imap, proxyService } as any, calls, tokensSeen };
}

let seq = 0;
function newOutlookAccount(extra: Record<string, any> = {}) {
  const m = new AccountModel();
  return m.create({ email: `user${++seq}@outlook.com`, client_id: CLIENT_ID, refresh_token: RT, ...extra } as any);
}

describe('FetchChain order', () => {
  test('default order is Graph → IMAP new → IMAP old', () => {
    assert.deepEqual(FetchChain.getOutlookChannelOrder(''), ['graph', 'imap_new', 'imap_old']);
  });
  test('preferred channel goes first, IMAP servers stay adjacent, Graph last when IMAP preferred', () => {
    assert.deepEqual(FetchChain.getOutlookChannelOrder('graph'), ['graph', 'imap_new', 'imap_old']);
    assert.deepEqual(FetchChain.getOutlookChannelOrder('imap_old'), ['imap_old', 'imap_new', 'graph']);
    assert.deepEqual(FetchChain.getOutlookChannelOrder('imap_new'), ['imap_new', 'imap_old', 'graph']);
    assert.deepEqual(FetchChain.getOutlookChannelOrder('imap'), ['imap_new', 'imap_old', 'graph']); // 源项目 authorization_type=imap
    assert.deepEqual(FetchChain.getOutlookChannelOrder('cache'), ['graph', 'imap_new', 'imap_old']);
  });
});

describe('MailService Outlook fallback chain (mocked providers)', () => {
  test('falls through Graph and IMAP-new to IMAP-old, records preferred channel', async () => {
    const acc = newOutlookAccount();
    const { deps, calls } = makeDeps({ graphFetch: 'fail', imapNew: 'fail', imapOld: 'ok' });
    const svc = new MailService(deps);
    const res = await svc.fetchMails(acc.id, 'INBOX');
    assert.equal(res.channel, 'imap_old');
    assert.equal(res.cached, false);
    assert.deepEqual(calls, ['token:graph', 'graph', 'token:imap', 'imap_new', 'imap_old']);
    const after = new AccountModel().getById(acc.id)!;
    assert.equal(after.preferred_channel, 'imap_old');
    assert.equal(after.last_channel, 'imap_old');
    assert.equal(res.mails[0].channel, 'imap_old');
    assert.equal(res.mails[0].id_mode, 'uid');
  });

  test('next fetch tries preferred channel first', async () => {
    const acc = newOutlookAccount();
    new AccountModel().recordPreferredChannel(acc.id, 'imap_old');
    const { deps, calls } = makeDeps({});
    const res = await new MailService(deps).fetchMails(acc.id, 'Junk');
    assert.equal(res.channel, 'imap_old');
    assert.deepEqual(calls, ['token:imap', 'imap_old']);
  });

  test('preferred channel failing still falls back in default order', async () => {
    const acc = newOutlookAccount();
    new AccountModel().recordPreferredChannel(acc.id, 'imap_old');
    const { deps, calls } = makeDeps({ imapOld: 'fail', imapNew: 'fail' });
    const res = await new MailService(deps).fetchMails(acc.id, 'INBOX');
    assert.equal(res.channel, 'graph');
    assert.deepEqual(calls, ['token:imap', 'imap_old', 'imap_new', 'token:graph', 'graph']);
    assert.equal(new AccountModel().getById(acc.id)!.preferred_channel, 'graph');
  });

  test('Graph token failure (e.g. AADSTS70011) falls back to IMAP with separate IMAP scope token', async () => {
    const acc = newOutlookAccount();
    const { deps, calls } = makeDeps({ graphToken: 'fail' });
    const res = await new MailService(deps).fetchMails(acc.id, 'INBOX');
    assert.equal(res.channel, 'imap_new');
    assert.deepEqual(calls, ['token:graph', 'token:imap', 'imap_new']);
  });

  test('all channels fail → local cache served, account marked error', async () => {
    const acc = newOutlookAccount();
    new MailCacheModel().upsert(acc.id, 'INBOX', [{ mail_id: 'old-1', subject: 'cached', id_mode: 'graph', channel: 'graph' }]);
    const { deps, calls } = makeDeps({ graphFetch: 'fail', imapNew: 'fail', imapOld: 'fail' });
    const res = await new MailService(deps).fetchMails(acc.id, 'INBOX');
    assert.equal(res.channel, 'cache');
    assert.equal(res.cached, true);
    assert.equal(res.mails[0].subject, 'cached');
    assert.ok(res.errors?.graph && res.errors?.imap_new && res.errors?.imap_old);
    assert.deepEqual(calls, ['token:graph', 'graph', 'token:imap', 'imap_new', 'imap_old']);
    const after = new AccountModel().getById(acc.id)!;
    assert.equal(after.status, 'error');
    assert.equal(after.last_channel, 'cache');
  });

  test('Graph transport error stops network fallback (source semantics) and serves cache', async () => {
    const acc = newOutlookAccount();
    new MailCacheModel().upsert(acc.id, 'INBOX', [{ mail_id: 'old-2', subject: 'cached2', id_mode: 'graph' }]);
    const { deps, calls } = makeDeps({ graphToken: 'transport' });
    const res = await new MailService(deps).fetchMails(acc.id, 'INBOX');
    assert.equal(res.channel, 'cache');
    assert.deepEqual(calls, ['token:graph']);
    assert.notEqual(new AccountModel().getById(acc.id)!.status, 'error');
  });

  test('all channels fail and no cache → throws', async () => {
    const acc = newOutlookAccount();
    const { deps } = makeDeps({ graphFetch: 'fail', imapNew: 'fail', imapOld: 'fail' });
    await assert.rejects(() => new MailService(deps).fetchMails(acc.id, 'INBOX'), /所有通道均失败/);
  });

  test('rotated refresh_token is written back to DB and used by the next channel', async () => {
    const acc = newOutlookAccount();
    const { deps, tokensSeen } = makeDeps({ graphFetch: 'fail', rotate: true });
    const res = await new MailService(deps).fetchMails(acc.id, 'INBOX');
    assert.equal(res.channel, 'imap_new');
    assert.equal(tokensSeen[0], RT);
    assert.equal(tokensSeen[1], `${RT}-rot1`); // IMAP 刷新使用 Graph 阶段轮换后的新 token
    assert.equal(new AccountModel().getById(acc.id)!.refresh_token, `${RT}-rot2`);
  });

  test('IMAP token is refreshed once and reused across IMAP-new and IMAP-old', async () => {
    const acc = newOutlookAccount();
    new AccountModel().recordPreferredChannel(acc.id, 'imap_new');
    const { deps, calls } = makeDeps({ imapNew: 'fail' });
    await new MailService(deps).fetchMails(acc.id, 'INBOX');
    assert.equal(calls.filter(c => c === 'token:imap').length, 1);
    assert.deepEqual(calls.slice(0, 3), ['token:imap', 'imap_new', 'imap_old']);
  });

  test('cache upsert de-duplicates and replaces other id-mode rows', async () => {
    const acc = newOutlookAccount();
    const cache = new MailCacheModel();
    cache.upsert(acc.id, 'INBOX', [{ mail_id: 'AAMk-1', id_mode: 'graph', subject: 'x' }]);
    const { deps } = makeDeps({});
    await new MailService(deps).fetchMails(acc.id, 'INBOX');
    await new MailService(deps).fetchMails(acc.id, 'INBOX');
    assert.equal(cache.countByAccount(acc.id, 'INBOX'), 1);
    const { deps: d2 } = makeDeps({ graphFetch: 'fail' });
    await new MailService(d2).fetchMails(acc.id, 'INBOX'); // IMAP uid 模式 → 清掉 graph 行
    const rows = cache.getByAccount(acc.id, 'INBOX').list;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id_mode, 'uid');
  });
});

describe('Generic IMAP accounts', () => {
  test('use IMAP only, channel "imap"', async () => {
    const m = new AccountModel();
    const acc = m.create({ email: 'someone@qq.com', provider: 'qq', imap_password: 'authcode' } as any);
    assert.equal(acc.account_type, 'imap');
    assert.equal(acc.imap_host, 'imap.qq.com');
    const { deps, calls } = makeDeps({});
    const res = await new MailService(deps).fetchMails(acc.id, 'INBOX');
    assert.equal(res.channel, 'imap');
    assert.deepEqual(calls, ['imap_generic']);
  });
});

describe('Token refresh action', () => {
  test('saves rotated refresh token and updates preferred channel', async () => {
    const acc = newOutlookAccount();
    const { deps } = makeDeps({});
    const r = await new MailService(deps).refreshToken(acc.id);
    assert.equal(r.success, true);
    assert.equal(r.rotated, true);
    const after = new AccountModel().getById(acc.id)!;
    assert.equal(after.refresh_token, `${RT}-refreshed`);
    assert.equal(after.preferred_channel, 'graph');
    assert.ok(after.token_refreshed_at);
  });
  test('batch refresh covers every selected account', async () => {
    const a = newOutlookAccount();
    const b = newOutlookAccount();
    const { deps } = makeDeps({});
    const r = await new MailService(deps).refreshTokens([a.id, b.id]);
    assert.equal(r.total, 2);
    assert.equal(r.success, 2);
  });
});

describe('Graph token scope candidates (AADSTS70011 avoidance)', () => {
  test('Graph candidates never contain IMAP scopes and degrade configured → read_write → read → .default', () => {
    const c = OAuth.getGraphTokenScopeCandidates(true);
    assert.deepEqual(c.map(x => x[0]), ['configured', 'read_write', 'read', 'default', 'original']);
    for (const [, scope] of c) assert.ok(!scope.includes('outlook.office.com'));
    assert.ok(!OAuth.IMAP_TOKEN_SCOPE.includes('graph.microsoft.com'));
    assert.ok(c[0][1].includes('offline_access'));
  });
  test('retryable detection', () => {
    assert.equal(OAuth.isGraphTokenScopeRetryable(400, { error: 'invalid_scope' }), true);
    assert.equal(OAuth.isGraphTokenScopeRetryable(400, { error: 'invalid_request', error_description: 'AADSTS70011: scope invalid' }), true);
    assert.equal(OAuth.isGraphTokenScopeRetryable(400, { error: 'invalid_grant' }), false);
    assert.equal(OAuth.isGraphTokenScopeRetryable(500, { error: 'invalid_scope' }), false);
  });
});

describe('Import parsing', () => {
  test('Outlook standard order', () => {
    const r = Import.parseAccountLine(`a@outlook.com----pw----${CLIENT_ID}----${RT}`);
    assert.equal(r.account?.client_id, CLIENT_ID);
    assert.equal(r.account?.refresh_token, RT);
    assert.equal(r.account?.account_type, 'outlook');
  });
  test('Outlook reversed order is auto-detected', () => {
    const r = Import.parseAccountLine(`a@hotmail.com----pw----${RT}----${CLIENT_ID}`);
    assert.equal(r.account?.client_id, CLIENT_ID);
    assert.equal(r.account?.refresh_token, RT);
  });
  test('Preset IMAP email----authcode', () => {
    for (const [email, host] of [['x@gmail.com', 'imap.gmail.com'], ['x@qq.com', 'imap.qq.com'], ['x@163.com', 'imap.163.com'], ['x@126.com', 'imap.126.com'], ['x@yahoo.com', 'imap.mail.yahoo.com'], ['x@aliyun.com', 'imap.aliyun.com']]) {
      const r = Import.parseAccountLine(`${email}----code123`);
      assert.equal(r.account?.imap_host, host, email);
      assert.equal(r.account?.imap_password, 'code123');
      assert.equal(r.account?.account_type, 'imap');
    }
  });
  test('Custom IMAP email----pwd----host----port', () => {
    const r = Import.parseAccountLine('me@corp.example----secret----mail.corp.example----143');
    assert.equal(r.account?.provider, 'custom');
    assert.equal(r.account?.imap_host, 'mail.corp.example');
    assert.equal(r.account?.imap_port, 143);
  });
  test('Explicit provider overrides domain inference', () => {
    const r = Import.parseAccountLine('me@mydomain.com----code', { provider: 'gmail' });
    assert.equal(r.account?.imap_host, 'imap.gmail.com');
  });
  test('Invalid lines report a format hint', () => {
    assert.match(Import.parseAccountLine('nobody@unknown.tld----pw').error || '', /自定义 IMAP/);
    assert.match(Import.parseAccountLine('a@outlook.com----pw').error || '', /client_id/);
  });
  test('Export round-trips each account type', () => {
    assert.equal(Import.formatAccountForExport({ account_type: 'imap', provider: 'custom', email: 'a@b', imap_password: 'p', imap_host: 'h', imap_port: 993 }), 'a@b----p----h----993');
    assert.equal(Import.formatAccountForExport({ account_type: 'imap', provider: 'qq', email: 'a@qq.com', imap_password: 'p' }), 'a@qq.com----p');
  });
});
