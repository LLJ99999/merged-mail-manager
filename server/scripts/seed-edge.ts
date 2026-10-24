/**
 * QA 边界数据（在 seed-demo 之后运行）：超长主题/正文、含脚本/超大图片/超宽表格的 HTML、纯文本、附件、emoji、
 * 空邮箱、垃圾箱、异常账户、标签；EDGE_BULK=N 追加 N 个批量账户（测试 200+ 账户的分页/全选/批量）。
 * 用法：DB_PATH=./data/qa.db npx tsx scripts/seed-edge.ts
 */
import { runMigrations } from '../src/database/migrations';
import db from '../src/database';
import { AccountModel } from '../src/models/Account';
import { MailCacheModel } from '../src/models/MailCache';

runMigrations();
const accounts = new AccountModel();
const cache = new MailCacheModel();
const CID = '9e5f94bc-e8a4-4e73-b8be-63364c29d753';
const now = Date.now();
const longSubject = '【重要通知】关于 2026 年第四季度账户安全策略调整以及多因素认证强制启用的详细说明和常见问题解答 — 请务必在截止日期前完成配置 🚀🔐✨ '.repeat(3);
const longWord = 'Supercalifragilisticexpialidocious_'.repeat(12);
const bigTable = `<table width="1800" border="1" style="border-collapse:collapse"><tr>${Array.from({ length: 24 }, (_, i) => `<td style="padding:6px;white-space:nowrap">Column ${i + 1} 数据</td>`).join('')}</tr></table>`;
const html = (body: string) => `<div style="font-family:system-ui">${body}</div>`;

db.transaction(() => {
  const edge = accounts.create({ email: 'edge.case.with.a.really.long.local.part.for.layout.testing@outlook.com', provider: 'outlook', client_id: CID, refresh_token: 'M.C5_BAY.edge' + 'y'.repeat(200), password: 'p', remark: '边界测试 · 超长备注超长备注超长备注超长备注超长备注超长备注超长备注 😀' } as any);
  db.prepare(`UPDATE accounts SET last_channel='graph', last_channel_at=datetime('now','-3 minutes'), token_refreshed_at=datetime('now','-1 days') WHERE id=?`).run(edge.id);
  const mails: any[] = [
    { mail_id: 'e1', sender: 'very.long.sender.address.for.testing.overflow@subdomain.example-company.co.uk', sender_name: '一个非常非常长的发件人显示名称用于测试布局截断效果 Very Long Display Name', subject: longSubject, text_content: longSubject + longWord, html_content: html(`<h1>${longSubject}</h1><p>${longWord}</p>`) },
    { mail_id: 'e2', sender: 'xss@evil.example', sender_name: 'Script Test', subject: '<script>alert(1)</script> HTML 注入测试', text_content: 'script test', html_content: `<p>正文前</p><script>window.parent.__XSS__=1;document.body.innerHTML='HACKED'</script><img src=x onerror="window.parent.__XSS__=2"><a href="https://example.com" id="lnk">外部链接</a><form action="https://evil.example"><input name=q><button>提交</button></form><p>正文后</p>` },
    { mail_id: 'e3', sender: 'img@example.com', sender_name: 'Huge Image', subject: '超大图片 6000px', text_content: 'img', html_content: `<p>图片：</p><img width="6000" height="3000" style="width:6000px;height:3000px;background:linear-gradient(90deg,red,blue)" src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='6000' height='3000'><rect width='6000' height='3000' fill='%234285F4'/></svg>"><p>图片后文字</p>` },
    { mail_id: 'e4', sender: 'table@example.com', sender_name: 'Wide Table', subject: '超宽表格 1800px', text_content: 'table', html_content: html(`<p>表格：</p>${bigTable}<p>表格后</p>`) },
    { mail_id: 'e5', sender: 'plain@example.com', sender_name: '纯文本', subject: '纯文本邮件（无 HTML）', text_content: '第一行\n第二行\n\n    缩进的代码行\n' + 'https://example.com/a/very/long/url/' + 'x'.repeat(300) + '\n结尾 🎉', html_content: '' },
    { mail_id: 'e6', sender: 'att@example.com', sender_name: '附件', subject: '带多个附件 📎', text_content: 'att', html_content: html('<p>见附件</p>'), has_attachments: true, attachments: [
      { id: 'idx-0', name: '季度报告-2026Q4-最终版-非常长的文件名用于测试截断效果.pdf', content_type: 'application/pdf', size: 5242880 },
      { id: 'idx-1', name: 'photo.jpg', content_type: 'image/jpeg', size: 2048 },
      { id: 'idx-2', name: '数据.xlsx', content_type: 'application/vnd.ms-excel', size: 0 },
    ] },
    { mail_id: 'e7', sender: '', sender_name: '', subject: '', text_content: '', html_content: '' },
    { mail_id: 'e8', sender: 'emoji@example.com', sender_name: '😀 Emoji 发件人 👩‍👩‍👧‍👦', subject: '🎉🎊 Unicode：中文 · 日本語 · 한국어 · العربية · עברית · Ελληνικά', text_content: 'RTL: مرحبا بالعالم', html_content: html('<p dir="rtl">مرحبا بالعالم</p><p>👩‍👩‍👧‍👦🏳️‍🌈</p>') },
    { mail_id: 'e9', sender: 'refresh@example.com', sender_name: 'Meta refresh', subject: 'meta refresh / base 劫持测试', text_content: 'x', html_content: `<meta http-equiv="refresh" content="0;url=https://example.com"><base href="https://evil.example/"><style>body{background:#000!important;color:#0f0}</style><p>样式与刷新</p><a href="/relative">相对链接</a>` },
  ].map((m, k) => ({ ...m, mail_date: new Date(now - k * 3600000).toISOString(), is_read: k % 2 === 0, id_mode: 'graph', channel: 'graph', to_addr: 'edge@outlook.com' }));
  cache.upsert(edge.id, 'INBOX', mails);
  cache.upsert(edge.id, 'Junk', Array.from({ length: 3 }, (_, k) => ({ mail_id: `ej${k}`, sender: 'spam@x.example', sender_name: 'Spam', subject: `垃圾邮件 ${k}`, text_content: 'spam', mail_date: new Date(now - k * 7200000).toISOString(), id_mode: 'graph', channel: 'graph' })));

  // 很多邮件的账户（列表滚动）
  const many = accounts.create({ email: 'many.mails@gmail.com', provider: 'gmail', imap_password: 'x' } as any);
  db.prepare(`UPDATE accounts SET last_channel='imap', last_channel_at=datetime('now','-1 hours') WHERE id=?`).run(many.id);
  cache.upsert(many.id, 'INBOX', Array.from({ length: 120 }, (_, k) => ({ mail_id: String(5000 + k), sender: `s${k}@example.com`, sender_name: `Sender ${k}`, subject: `第 ${k + 1} 封邮件`, text_content: `内容 ${k}`, html_content: '', mail_date: new Date(now - k * 600000).toISOString(), is_read: k > 5, id_mode: 'uid', channel: 'imap' })));

  // 空邮箱 / 异常账户
  const empty = accounts.create({ email: 'empty.box@outlook.com', provider: 'outlook', client_id: CID, refresh_token: 'M.C5_BAY.empty' + 'z'.repeat(80) } as any);
  void empty;
  const bad = accounts.create({ email: 'broken@qq.com', provider: 'qq', imap_password: 'bad' } as any);
  db.prepare(`UPDATE accounts SET status='error', last_error=?, last_channel='cache', last_channel_at=datetime('now','-2 days') WHERE id=?`).run('收取失败：IMAP: Login fail. Account is abnormal, service is not open, password is incorrect, login frequency limited, or system is busy. More information at https://help.mail.qq.com/detail/108/1023', bad.id);

  const n = Number(process.env.EDGE_BULK || 0);
  const providers = ['outlook', 'gmail', 'qq', '163', '126', 'yahoo', 'aliyun', '2925', 'custom'];
  for (let i = 0; i < n; i++) {
    const p = providers[i % providers.length];
    const email = `bulk${String(i).padStart(4, '0')}@${p === 'outlook' ? 'outlook.com' : p === 'custom' ? 'corp.example' : p === 'gmail' ? 'gmail.com' : p === 'yahoo' ? 'yahoo.com' : p + '.com'}`;
    accounts.create(p === 'outlook' ? { email, provider: p, client_id: CID, refresh_token: 'M.C5_BAY.bulk' + i + 'q'.repeat(60) } as any : { email, provider: p, imap_password: 'pw' + i, imap_host: p === 'custom' ? 'mail.corp.example' : undefined, imap_port: 993 } as any);
  }
  db.prepare(`INSERT OR IGNORE INTO tags (name, color) VALUES ('一个特别长的标签名称测试', '#BE123C'), ('🔥 热门', '#16A34A')`).run();
  const t = db.prepare(`SELECT id FROM tags WHERE name='一个特别长的标签名称测试'`).get() as any;
  if (t) db.prepare(`INSERT OR IGNORE INTO account_tags (account_id, tag_id) VALUES (?, ?), (?, 1), (?, 2)`).run(edge.id, t.id, edge.id, edge.id);
  db.prepare(`INSERT INTO proxies (name, type, host, port, is_default, status) VALUES (?, 'http', 'proxy.with.a.very.long.hostname.example.internal.corp', 3128, 0, 'failed')`).run('一个名字很长很长很长很长很长很长很长的代理服务器 · 备用线路');
})();
console.log('edge data seeded; bulk =', process.env.EDGE_BULK || 0);
