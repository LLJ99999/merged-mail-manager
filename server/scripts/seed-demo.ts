/**
 * 演示数据（仅用于本地预览 / 截图，全部为虚构账户，无法真实收信）
 * 用法：DB_PATH=./data/demo.db npx tsx scripts/seed-demo.ts
 */
import { runMigrations } from '../src/database/migrations';
import db from '../src/database';
import { AccountModel } from '../src/models/Account';
import { MailCacheModel } from '../src/models/MailCache';

runMigrations();
const accounts = new AccountModel();
const cache = new MailCacheModel();
const CID = '9e5f94bc-e8a4-4e73-b8be-63364c29d753';
const rt = (n: number) => `M.C5_BAY.0.U.-Demo${n}` + 'x'.repeat(80);

const seed: any[] = [
  { email: 'alice.chen@outlook.com', provider: 'outlook', client_id: CID, refresh_token: rt(1), password: 'Al1ce!2024', remark: '主力账号', last: 'graph', pref: 'graph', daysAgo: 2 },
  { email: 'ops-alerts@hotmail.com', provider: 'outlook', client_id: CID, refresh_token: rt(2), password: 'hotmail#88', remark: '告警通知', last: 'imap_new', pref: 'imap_new', daysAgo: 12 },
  { email: 'legacy.box@live.com', provider: 'outlook', client_id: CID, refresh_token: rt(3), password: 'live$pass', last: 'imap_old', pref: 'imap_old', daysAgo: 64 },
  { email: 'archive2019@outlook.com', provider: 'outlook', client_id: CID, refresh_token: rt(4), password: '', last: 'cache', pref: '', daysAgo: 85, error: 'Graph API: AADSTS70000 invalid_grant | IMAP (New): AUTHENTICATE failed | IMAP (Old): AUTHENTICATE failed' },
  { email: 'dev.team@gmail.com', provider: 'gmail', imap_password: 'abcd efgh ijkl mnop', last: 'imap', daysAgo: 1 },
  { email: '18820001234@qq.com', provider: 'qq', imap_password: 'qwertyuiopasdfgh', remark: '工单', last: 'imap', daysAgo: 5 },
  { email: 'market_cn@163.com', provider: '163', imap_password: 'NETEASEAUTH01', last: 'imap', daysAgo: 20 },
  { email: 'invoice@126.com', provider: '126', imap_password: 'NETEASEAUTH02', last: '', daysAgo: null },
  { email: 'yuki.tanaka@yahoo.co.jp', provider: 'yahoo', imap_password: 'app-pass-yahoo', last: 'imap', daysAgo: 9 },
  { email: 'hr@aliyun.com', provider: 'aliyun', imap_password: 'aliyunpass', last: '', daysAgo: null },
  { email: 'support@acme.dev', provider: 'custom', imap_password: 'S3cure!', imap_host: 'mail.acme.dev', imap_port: 993, remark: '自建 Dovecot', last: 'imap', daysAgo: 3 },
];

const subjects = [
  ['GitHub', 'noreply@github.com', '[GitHub] A new SSH key was added to your account', '你的账户新增了一个 SSH 公钥。如果这不是你本人操作，请立即检查账户安全设置。'],
  ['Microsoft 帐户团队', 'account-security-noreply@accountprotection.microsoft.com', 'Microsoft 帐户安全代码', '请使用以下安全代码验证你的 Microsoft 帐户：482 913。'],
  ['Vercel', 'notifications@vercel.com', 'Deployment ready: mail-manager (production)', 'Your deployment is now live. Build completed in 42s with 0 warnings.'],
  ['Linear', 'notifications@linear.app', 'ENG-214 · Fallback to IMAP old server when live.com times out', 'Assigned to you by Wei. Priority: High. Cycle 18.'],
  ['阿里云', 'service@aliyun.com', '【阿里云】您的云服务器 ECS 实例即将到期', '尊敬的用户，您的实例 i-bp1xx 将于 7 天后到期，请及时续费以免影响业务。'],
  ['Stripe', 'receipts@stripe.com', 'Your receipt from Acme Inc. #2041-7731', 'Amount paid $24.00 · Card ending 4242 · Oct 18, 2026'],
  ['Figma', 'no-reply@figma.com', 'Mina commented on “Mail Manager — v2 UI”', '“Channel badge reads well in dark mode, ship it.”'],
  ['Notion', 'notify@mail.notion.so', 'Weekly digest: 6 pages updated in Engineering', 'Runbook: token rotation · Incident review 10/14 · Q4 roadmap'],
];

const now = Date.now();
db.transaction(() => {
  seed.forEach((s, i) => {
    const acc = accounts.create(s);
    const daysAgo = s.daysAgo;
    db.prepare(`UPDATE accounts SET last_channel = ?, preferred_channel = ?, last_channel_at = ?, token_refreshed_at = ?, status = ?, last_error = ?, last_synced_at = ? WHERE id = ?`).run(
      s.last || '', s.pref ?? (s.last === 'imap' ? 'imap' : ''),
      s.last ? new Date(now - (i * 37 + 5) * 60000).toISOString().replace('T', ' ').slice(0, 19) : null,
      daysAgo == null ? null : new Date(now - daysAgo * 86400000).toISOString().replace('T', ' ').slice(0, 19),
      s.error ? 'error' : 'active', s.error || '',
      s.last ? new Date(now - (i * 37 + 5) * 60000).toISOString().replace('T', ' ').slice(0, 19) : null,
      acc.id,
    );
    if (!s.last) return;
    const n = 3 + ((i * 5) % 6);
    const mails = Array.from({ length: n }, (_, k) => {
      const [name, from, subject, body] = subjects[(i + k) % subjects.length];
      const idMode = s.last === 'graph' || (s.last === 'cache') ? 'graph' : 'uid';
      return {
        mail_id: idMode === 'graph' ? `AAMkAD${i}${k}demo` : String(1000 + k),
        sender: from, sender_name: name, subject,
        text_content: body,
        html_content: `<div style="font-family:Inter,system-ui,sans-serif;max-width:560px"><p style="color:#71717a;font-size:12px;margin:0 0 16px">${name}</p><h2 style="font-size:18px;margin:0 0 12px;color:#18181b">${subject}</h2><p style="color:#3f3f46;line-height:1.7">${body}</p><p style="color:#3f3f46;line-height:1.7">此邮件为演示数据，用于预览界面布局。</p><hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0"/><p style="color:#a1a1aa;font-size:12px">You are receiving this email because you signed up for notifications.</p></div>`,
        mail_date: new Date(now - (i * 3 + k * 7 + 1) * 3600000).toISOString(),
        is_read: k > 1,
        id_mode: idMode,
        channel: s.last,
        to_addr: s.email,
        has_attachments: k === 0 && i % 2 === 0,
        attachments: k === 0 && i % 2 === 0 ? [{ id: 'idx-0', name: 'invoice-2041.pdf', content_type: 'application/pdf', size: 184320 }] : [],
      };
    });
    cache.upsert(acc.id, 'INBOX', mails);
    if (i % 3 === 0) {
      cache.upsert(acc.id, 'Junk', [{ mail_id: `junk-${i}`, sender: 'promo@deals.example', sender_name: 'Deals', subject: '恭喜！您获得了 1 张限时优惠券', text_content: '点击领取…', mail_date: new Date(now - 86400000 * 2).toISOString(), id_mode: 'uid', channel: s.last }]);
    }
  });
  db.prepare(`INSERT INTO proxies (name, type, host, port, is_default, status, last_test_ip, last_tested_at) VALUES ('HK SOCKS5', 'socks5', '127.0.0.1', 10808, 1, 'active', '103.152.xx.21', datetime('now','-2 hours')), ('Office HTTP', 'http', '10.0.0.8', 8080, 0, 'untested', '', NULL)`).run();
  db.prepare(`INSERT OR IGNORE INTO tags (name, color) VALUES ('重要', '#4F46E5'), ('通知', '#0EA5E9'), ('财务', '#D97706')`).run();
  db.prepare(`INSERT OR IGNORE INTO account_tags (account_id, tag_id) VALUES (1, 1), (2, 2), (6, 2), (8, 3)`).run();
})();
console.log('demo data seeded:', seed.length, 'accounts');
