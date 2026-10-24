/**
 * 收取总时限（FETCH_TIMEOUT）测试：网络通道挂起时必须按时返回可读的超时错误，而不是无限等待。
 * 另外用一个本地"滴答"IMAP 服务器（持续发送 keepalive，使空闲超时永远不触发）验证真实 imapflow 连接会被强制断开。
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';
import net from 'net';

const tmpDb = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mmm-deadline-')), 'test.db');
process.env.DB_PATH = tmpDb;
process.env.LOG_LEVEL = 'error';

let runMigrations: typeof import('../src/database/migrations').runMigrations;
let AccountModel: typeof import('../src/models/Account').AccountModel;
let MailCacheModel: typeof import('../src/models/MailCache').MailCacheModel;
let MailService: typeof import('../src/services/MailService').MailService;
let ImapService: typeof import('../src/services/ImapService').ImapService;
let deadline: typeof import('../src/utils/deadline');
let http: typeof import('../src/utils/http');

let dripServer: net.Server;
let dripPort = 0;
const sockets = new Set<net.Socket>();

before(async () => {
  ({ runMigrations } = await import('../src/database/migrations'));
  ({ AccountModel } = await import('../src/models/Account'));
  ({ MailCacheModel } = await import('../src/models/MailCache'));
  ({ MailService } = await import('../src/services/MailService'));
  ({ ImapService } = await import('../src/services/ImapService'));
  deadline = await import('../src/utils/deadline');
  http = await import('../src/utils/http');
  runMigrations();
  // 发送问候后每 200ms 发一条 untagged 响应，但从不回应任何命令
  dripServer = net.createServer(sock => {
    sockets.add(sock);
    sock.on('error', () => {});
    sock.write('* OK IMAP4rev1 ready\r\n');
    const t = setInterval(() => { if (!sock.destroyed) sock.write('* OK keepalive\r\n'); }, 200);
    sock.on('close', () => { clearInterval(t); sockets.delete(sock); });
  });
  await new Promise<void>(r => dripServer.listen(0, '127.0.0.1', () => r()));
  dripPort = (dripServer.address() as net.AddressInfo).port;
});

after(async () => {
  sockets.forEach(s => s.destroy());
  await new Promise<void>(r => dripServer.close(() => r()));
});

const never = () => new Promise<never>(() => {});
let seq = 0;

function hangingDeps(kind: 'imap' | 'graphToken') {
  return {
    oauth: {
      refreshGraphToken: kind === 'graphToken' ? never : async () => ({ access_token: 'g' }),
      refreshImapToken: async () => ({ access_token: 'i' }),
    },
    graph: { fetchMails: never },
    imap: { fetchMails: never },
    proxyService: { resolve: () => undefined, imapProxyUrl: () => undefined },
  } as any;
}

describe('fetch deadline', () => {
  test('withDeadline rejects with DeadlineError and aborts the context signal', async () => {
    let seen: AbortSignal | undefined;
    const t0 = Date.now();
    await assert.rejects(deadline.withDeadline(150, async () => { seen = deadline.currentDeadlineSignal(); return never(); }), (e: any) => deadline.isDeadlineError(e));
    assert.ok(Date.now() - t0 < 1000);
    assert.equal(seen?.aborted, true);
  });

  test('httpFetch fails immediately when the deadline already expired', async () => {
    await assert.rejects(deadline.withDeadline(50, async () => {
      await new Promise(r => setTimeout(r, 120));
      return http.httpFetch('http://127.0.0.1:9/never');
    }), (e: any) => deadline.isDeadlineError(e));
  });

  test('hanging generic IMAP → readable timeout error, no hang', async () => {
    const acc = new AccountModel().create({ email: `dl${++seq}@qq.com`, account_type: 'imap', provider: 'qq', imap_host: 'imap.qq.com', imap_password: 'x' } as any);
    const t0 = Date.now();
    await assert.rejects(new MailService(hangingDeps('imap')).fetchMails(acc.id, 'INBOX', undefined, 50, 300), (e: any) => /收取超时/.test(e.message));
    assert.ok(Date.now() - t0 < 2000, 'returned promptly');
  });

  test('hanging Outlook OAuth → timeout, account not marked as error, cache served when present', async () => {
    const acc = new AccountModel().create({ email: `dl${++seq}@outlook.com`, client_id: 'cid', refresh_token: 'M.C5' + 'x'.repeat(100) } as any);
    new MailCacheModel().upsert(acc.id, 'INBOX', [{ mail_id: 'm1', sender: 'a@b.c', sender_name: 'A', subject: 's', text_content: '', html_content: '', mail_date: new Date().toISOString(), id_mode: 'graph', channel: 'graph' } as any]);
    const res = await new MailService(hangingDeps('graphToken')).fetchMails(acc.id, 'INBOX', undefined, 50, 300);
    assert.equal(res.cached, true);
    assert.match(String(res.errors?.timeout), /收取超时/);
    assert.notEqual(new AccountModel().getById(acc.id)!.status, 'error');
  });

  test('real imapflow against a keepalive-dripping server is force-closed at the deadline', async () => {
    const svc = new ImapService();
    const t0 = Date.now();
    await assert.rejects(
      deadline.withDeadline(800, () => svc.fetchMails({ host: '127.0.0.1', port: dripPort, user: 'u', password: 'p', provider: 'custom' }, 'inbox', 10)),
      (e: any) => deadline.isDeadlineError(e),
    );
    assert.ok(Date.now() - t0 < 3000);
    await new Promise(r => setTimeout(r, 300));
    assert.equal(sockets.size, 0, 'IMAP socket closed after deadline');
  });
});
