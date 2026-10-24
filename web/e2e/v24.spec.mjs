/**
 * v2.4 回归：QA 全面巡检中发现并修复的问题（Playwright，非 CI）。真实服务端 + 真实 SQLite，不伪造接口
 * （唯一例外：「批量收取追加后的并发」用路由延迟 /api/mails/fetch 以便观察并发数，响应仍来自真实服务端）。
 *
 * 准备（边界数据：超长主题 / 脚本邮件 / 附件 / 纯文本长 URL / emoji / 120 封邮件 / 长标签 / 短密码）：
 *   cd server && rm -f data/v24.db* && DB_PATH=./data/v24.db npx tsx scripts/seed-demo.ts \
 *     && EDGE_BULK=30 DB_PATH=./data/v24.db npx tsx scripts/seed-edge.ts && DB_PATH=./data/v24.db PORT=3920 npm start
 *   可选：空库 + 访问密码  rm -f data/v24pw.db* && DB_PATH=./data/v24pw.db ACCESS_PASSWORD=secret123 PORT=3921 npm start
 *   BASE=http://localhost:3920 [BASE_PW=http://localhost:3921] OUT=./e2e-out node web/e2e/v24.spec.mjs [reader|accounts|mail|misc|auth]
 *
 * 任何 pageerror 或 console.error（浏览器自身的 401 网络日志除外）都记为失败。
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE || 'http://localhost:3920';
const BASE_PW = process.env.BASE_PW || '';
const OUT = process.env.OUT || './e2e-out';
const ONLY = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });

let passed = 0, failures = 0;
function check(name, ok, detail = '') {
  ok ? passed++ : failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const api = async (p, init) => (await (await fetch(BASE + '/api' + p, { headers: { 'Content-Type': 'application/json' }, ...init })).json()).data;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch();
const errors = [];

async function newPage({ viewport = { width: 1440, height: 900 }, base = BASE, init } = {}) {
  const c = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: viewport.width < 800 });
  await c.addInitScript(() => {
    if (!sessionStorage.getItem('qa-init')) {
      localStorage.clear();
      localStorage.setItem('mm-appearance', JSON.stringify({ mode: 'light', seed: '#4285F4', variant: 'tonal', glass: false }));
      localStorage.setItem('mm-mail-accounts-collapsed', '0');
      sessionStorage.setItem('qa-init', '1');
    }
  });
  if (init) await c.addInitScript(init);
  await c.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, r => r.abort());
  const p = await c.newPage();
  p.on('pageerror', e => errors.push(`PAGEERROR ${e.message}`));
  p.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/status of 401|ERR_FAILED|ERR_CONNECTION_REFUSED|ECONNREFUSED/.test(t)) return;
    errors.push(`console.error ${t.slice(0, 200)}`);
  });
  p.base = base;
  return p;
}
const go = async (p, url) => { await p.goto(p.base + url, { waitUntil: 'networkidle' }); await p.waitForTimeout(500); };
const accountId = async email => (await api(`/accounts?pageSize=10000&search=${encodeURIComponent(email)}`)).list.find(a => a.email === email)?.id;

// ---------------------------------------------------------------- reader
async function readerSuite() {
  const edge = await accountId('edge.case.with.a.really.long.local.part.for.layout.testing@outlook.com');
  const list = (await api(`/mails/cached?account_id=${edge}&mailbox=INBOX&pageSize=100`)).list;
  const mid = k => list.find(m => m.mail_id === k)?.id;
  const p = await newPage({ viewport: { width: 1366, height: 768 } });
  const before = errors.length;
  const frame = () => p.frameLocator('iframe[title="邮件内容"]');

  await go(p, `/mail/${edge}/${mid('e2')}`);
  await p.waitForTimeout(800);
  check('reader: script mail does not execute (window.__XSS__ unset)', (await p.evaluate(() => window.__XSS__ ?? null)) === null);
  const html = await frame().locator('body').innerHTML();
  check('reader: <script>/onerror stripped before render', !/<script|onerror/i.test(html), html.slice(0, 80));
  check('reader: links open in new tab with noopener', (await frame().locator('a#lnk').getAttribute('rel'))?.includes('noopener') && (await frame().locator('a#lnk').getAttribute('target')) === '_blank');
  check('reader: no sandbox "Blocked script execution" console errors', errors.slice(before).filter(e => /Blocked script|sandboxed/.test(e)).length === 0, errors.slice(before).join(' | '));

  await go(p, `/mail/${edge}/${mid('e9')}`);
  await p.waitForTimeout(1500);
  const h9 = await frame().locator('html').innerHTML();
  check('reader: mail <meta refresh>/<base href> removed', !/evil\.example|http-equiv/i.test(h9) && (await frame().locator('a:has-text("相对链接")').getAttribute('target')) === '_blank');

  await go(p, `/mail/${edge}/${mid('e1')}`);
  const h2 = p.locator('article h2').first();
  const hb = await h2.boundingBox();
  check('reader: very long subject clamped (≤ 3 lines)', hb && hb.height <= 3 * 36, `h=${hb?.height}`);
  check('reader: full subject kept as tooltip', ((await h2.getAttribute('title')) || '').length > 100);
  const ifr = await p.locator('iframe[title="邮件内容"]').boundingBox();
  check('reader: body stays visible under long subject (iframe ≥ 250px tall)', ifr && ifr.height >= 250, `h=${ifr?.height}`);

  await go(p, `/mail/${edge}/${mid('e6')}`);
  const chips = p.locator('article button[aria-label^="下载附件"]');
  check('reader: 3 attachment chips', (await chips.count()) === 3);
  const hs = await chips.evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().height)));
  check('reader: attachment chips stay single-line (36px)', hs.every(h => h <= 38), JSON.stringify(hs));
  check('reader: zero-size attachment shows no "0 B"', !(await chips.nth(2).innerText()).includes('0 B'));

  await go(p, `/mail/${edge}/${mid('e5')}`);
  const pre = p.locator('article pre');
  const ov = await pre.evaluate(el => el.scrollWidth - el.clientWidth);
  check('reader: plain-text long URL wraps (no horizontal overflow)', ov <= 1, `overflow=${ov}`);
  check('reader: plain-text URL is a link', (await pre.locator('a[href^="https://example.com/a/very/long"]').count()) === 1);

  await go(p, `/mail/${edge}`);
  const emojiRow = p.locator('button:has-text("Emoji 发件人")').first();
  const av = await emojiRow.locator('span.rounded-full').first().innerText();
  check('mail list: emoji sender avatar is a whole grapheme (no �)', av && !av.includes('\uFFFD') && !/^[\uD800-\uDFFF]$/.test(av), JSON.stringify(av));

  // 打开即已读
  // 重新读取（前面的用例已打开过几封邮件）；e4「超宽表格」种子数据为未读且未被前面的用例打开
  const unreadMail = (await api(`/mails/cached?account_id=${edge}&mailbox=INBOX&pageSize=100`)).list.find(m => m.mail_id === 'e4' && !m.is_read);
  const badge = async () => Number((await p.locator('button:has-text("收件箱") span.bg-primary').first().innerText().catch(() => '0')) || 0);
  const b0 = await badge();
  await p.locator(`button:has-text("${unreadMail?.subject}")`).first().click();
  await p.waitForTimeout(1500);
  check('mail: opening an unread mail decrements unread badge', (await badge()) === b0 - 1, `${b0} → ${await badge()}`);
  const after = (await api(`/mails/cached?account_id=${edge}&mailbox=INBOX&pageSize=100`)).list.find(m => m.id === unreadMail.id);
  check('mail: server cache marks opened mail read', after?.is_read === true);
  await p.context().close();
}

// ---------------------------------------------------------------- accounts
async function accountsSuite() {
  const p = await newPage({ viewport: { width: 1440, height: 900 } });
  await go(p, '/accounts');
  await p.locator('select').last().selectOption('10');
  await p.waitForTimeout(700);
  await p.getByRole('checkbox', { name: '全选' }).click();
  check('accounts: select-all selects the page', (await p.locator('text=/已选 10 项/').count()) === 1);
  await p.getByRole('button', { name: '下一页' }).click();
  await p.waitForTimeout(800);
  check('accounts: changing page clears selection', (await p.locator('text=/已选 \\d+ 项/').count()) === 0);
  check('accounts: header checkbox unchecked on new page', (await p.getByRole('checkbox', { name: '全选' }).getAttribute('aria-checked')) === 'false');

  // # 列全局序号
  await p.getByRole('button', { name: '显示列' }).click();
  await p.locator('label:has-text("#")').first().click();
  await p.keyboard.press('Escape'); await p.mouse.click(5, 5);
  await p.waitForTimeout(300);
  check('accounts: # column continues across pages (page 2 starts at 11)', (await p.locator('tbody tr').first().locator('td').nth(1).innerText()).trim() === '11');
  await p.getByRole('button', { name: '显示列' }).click();
  await p.locator('label:has-text("#")').first().click();
  await p.mouse.click(5, 5);

  // 短密码遮挡
  await p.locator('input[placeholder="搜索邮箱或备注"]').fill('broken@qq.com');
  await p.waitForTimeout(900);
  const cellTexts = await p.locator('tbody tr').first().locator('td').allInnerTexts();
  check('accounts: short secret is masked (not "bad")', !cellTexts.some(t => t.trim() === 'bad'), JSON.stringify(cellTexts.slice(0, 5)));

  // 搜索快速输入：只显示最后一次的结果
  const inp = p.locator('input[placeholder="搜索邮箱或备注"]');
  await inp.fill('bulk'); await p.waitForTimeout(260); await inp.fill('alice'); await p.waitForTimeout(1200);
  check('accounts: fast typing ends on latest query', (await p.locator('tbody tr').count()) === 1 && (await p.locator('tbody tr').first().innerText()).includes('alice'));

  // 长标签 chip 单行
  await inp.fill('edge.case'); await p.waitForTimeout(900);
  const tagH = await p.locator('tbody tr').first().locator('span[title="一个特别长的标签名称测试"]').evaluate(e => e.getBoundingClientRect().height).catch(() => -1);
  check('accounts: long tag chip stays one line (24px)', tagH > 0 && tagH <= 26, `h=${tagH}`);

  // 编辑对话框：切换标签不丢失正在输入的内容
  await inp.fill('alice.chen'); await p.waitForTimeout(900);
  await p.locator('tr:has-text("alice.chen") button[title="编辑"]').click();
  await p.waitForTimeout(500);
  const remark = p.locator('[role=dialog] input[placeholder="可选"]');
  await remark.fill('typed-remark-v24');
  await p.locator('[role=dialog] button:has-text("财务")').first().click();
  await p.waitForTimeout(1200);
  check('edit dialog: typed remark survives tag toggle / account refresh', (await remark.inputValue()) === 'typed-remark-v24');
  const tagOn = await p.locator('[role=dialog] span.bg-secondary-container:has-text("财务")').count();
  check('edit dialog: tag chip reflects the toggle', tagOn === 1);
  await p.locator('[role=dialog] button:has-text("财务")').first().click(); // 还原
  await p.waitForTimeout(800);
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);

  // 右键菜单：标签勾选随切换更新
  await p.locator('tr:has-text("alice.chen")').click({ button: 'right' });
  await p.waitForTimeout(300);
  const menu = p.locator('[role=menu].fixed');
  const has = async () => menu.locator('button:has-text("通知") svg.lucide-check').count();
  const c0 = await has();
  await menu.locator('button:has-text("通知")').click();
  await p.waitForTimeout(1200);
  check('context menu: tag check mark updates after toggle', (await has()) === (c0 ? 0 : 1), `${c0} → ${await has()}`);
  await menu.locator('button:has-text("通知")').click(); await p.waitForTimeout(800); // 还原
  await p.keyboard.press('Escape');

  // 剪贴板不可用（http 局域网访问）时复制不崩溃
  const before = errors.length;
  await p.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }));
  await p.locator('tr:has-text("alice.chen") button[title="点击复制"]').first().click();
  await p.waitForTimeout(400);
  check('copy without navigator.clipboard: no pageerror', errors.slice(before).filter(e => e.startsWith('PAGEERROR')).length === 0, errors.slice(before).join(' | '));
  check('copy without navigator.clipboard: success toast (execCommand fallback)', (await p.locator('[data-sonner-toast]').allInnerTexts()).some(t => t.includes('已复制')));
  await p.context().close();

  // 删除最后一页唯一一条 → 页码回退（用搜索把范围限定在 11 个临时账户：每页 10 条 → 第 2 页只有 1 条）
  const tag = `v24last${Date.now()}`;
  for (let i = 0; i < 11; i++) await api('/accounts', { method: 'POST', body: JSON.stringify({ email: `${tag}-${i}@example.com`, provider: 'gmail', imap_password: 'x' }) });
  const p2 = await newPage();
  await go(p2, '/accounts');
  await p2.locator('input[placeholder="搜索邮箱或备注"]').fill(tag); await p2.waitForTimeout(900);
  await p2.locator('select').last().selectOption('10'); await p2.waitForTimeout(700);
  await p2.getByRole('button', { name: '下一页' }).click(); await p2.waitForTimeout(700);
  const onP2 = await p2.locator('tbody tr').count();
  await p2.locator('tbody tr').first().locator('button[title="删除"]').click();
  await p2.locator('[role=dialog] button:has-text("删除")').click();
  await p2.waitForTimeout(1500);
  check('accounts: deleting the only row of the last page goes back a page', onP2 === 1 && (await p2.locator('tbody tr').count()) === 10 && (await p2.locator('text="1 / 1"').count()) === 1, `rowsOnP2=${onP2} now=${await p2.locator('tbody tr').count()}`);
  for (const a of (await api(`/accounts?pageSize=100&search=${tag}`)).list) await api(`/accounts/${a.id}`, { method: 'DELETE' });
  await p2.context().close();

  // 移动端：工具栏按钮换行，不被裁掉
  const m = await newPage({ viewport: { width: 390, height: 844 } });
  await go(m, '/accounts');
  const colBtn = await m.getByRole('button', { name: '显示列' }).boundingBox();
  check('mobile accounts: toolbar wraps, column button fully visible', colBtn && colBtn.x + colBtn.width <= 390 - 8, JSON.stringify(colBtn));
  await m.context().close();
}

// ---------------------------------------------------------------- mail list
async function mailSuite() {
  const many = await accountId('many.mails@gmail.com');
  const total = (await api(`/mails/cached?account_id=${many}&mailbox=INBOX&pageSize=1`)).total;
  const p = await newPage({ viewport: { width: 1440, height: 900 } });
  await go(p, `/mail/${many}`);
  const rows = () => p.locator('section button:has-text("封邮件")').count();
  const r0 = await rows();
  check('mail: first page shows 100 cached mails', r0 === Math.min(100, total), `rows=${r0} total=${total}`);
  const lastOpacity = await p.locator('section button:has-text("封邮件")').last().evaluate(e => Number(getComputedStyle(e).opacity));
  check('mail: long list fully visible within ~1s (stagger capped; last row opacity 1)', lastOpacity > 0.95, `opacity=${lastOpacity}`);
  const more = p.getByTestId('mail-load-more');
  check('mail: "加载更多" visible when cache has more', total > 100 ? (await more.count()) === 1 : true);
  if (total > 100) {
    await more.click(); await p.waitForTimeout(1000);
    check('mail: load more appends the rest', (await rows()) === total, `rows=${await rows()}`);
    check('mail: "加载更多" hidden when everything is loaded', (await more.count()) === 0);
  }
  // 1440 默认展开账户栏；1366 默认收起（阅读面板更宽）
  const c = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const q = await c.newPage();
  await q.goto(BASE + '/mail', { waitUntil: 'networkidle' });
  const w = await q.locator('aside.sf-low').first().evaluate(e => e.getBoundingClientRect().width);
  check('mail: account pane collapsed by default below 1440px', w < 120, `w=${w}`);
  await c.close();
  await p.context().close();
}

// ---------------------------------------------------------------- misc
async function miscSuite() {
  const p = await newPage();
  await go(p, '/settings');
  const sw = p.getByRole('switch', { name: '显示为背景' });
  check('settings: wallpaper switch off & disabled without wallpaper', (await sw.getAttribute('aria-checked')) === 'false' && (await sw.isDisabled()));

  // 导入：UTF-16 LE（记事本「Unicode」）与 GBK 文件
  await go(p, '/accounts');
  await p.getByRole('button', { name: '导入' }).first().click();
  await p.locator('[role=dialog] button:has-text("文件")').click();
  const email16 = `utf16-${Date.now()}@gmail.com`;
  const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`${email16}----授权码一\r\n`, 'utf16le')]);
  await p.getByTestId('import-file-input').setInputFiles({ name: 'u16.txt', mimeType: 'text/plain', buffer: buf });
  await p.waitForTimeout(300);
  await p.locator('[role=dialog] button:has-text("下一步")').click();
  await p.waitForTimeout(800);
  check('import: UTF-16 LE file decoded (preview lists the email)', (await p.locator(`[role=dialog] >> text=${email16}`).count()) === 1);
  await p.locator('[role=dialog] button:has-text("返回")').click();
  // GB18030 / GBK：手写 "测试" 的 GBK 字节 B2 E2 CA D4 作为备注之外的内容 —— 只检查不会解析失败成乱码邮箱
  const gbk = Buffer.concat([Buffer.from(`gbk-${Date.now()}@qq.com----`), Buffer.from([0xb2, 0xe2, 0xca, 0xd4]), Buffer.from('\n')]);
  await p.getByTestId('import-file-input').setInputFiles({ name: 'gbk.txt', mimeType: 'text/plain', buffer: gbk });
  await p.waitForTimeout(300);
  const ta = await p.locator('[role=dialog] .text-title-s:has-text("gbk.txt")').count();
  check('import: re-selecting a file works (input value reset) and GBK file loads', ta === 1);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(500);

  // 批量收取：运行中追加账户后恢复到并发 4
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let inflight = 0, peakAfterAppend = 0, appended = false;
  await c.route('**/api/mails/fetch', async route => {
    inflight++;
    if (appended) peakAfterAppend = Math.max(peakAfterAppend, inflight);
    await sleep(900);
    try { await route.continue(); } catch { /* aborted */ }
    inflight--;
  });
  await c.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, r => r.abort());
  const b = await c.newPage();
  b.on('pageerror', e => errors.push(`PAGEERROR ${e.message}`));
  await b.goto(BASE + '/accounts', { waitUntil: 'networkidle' });
  const all = (await api('/accounts?pageSize=10000')).list;
  await b.evaluate(() => 0);
  // 先收取 5 个，等到只剩 1 个在跑时追加 12 个
  await b.locator('select').last().selectOption('10'); await b.waitForTimeout(500);
  const boxes = b.locator('tbody tr td:first-child button[role=checkbox]');
  for (let i = 0; i < 5; i++) await boxes.nth(i).click();
  await b.getByTestId('batch-fetch-selected').click();
  await b.waitForTimeout(1500);
  await b.getByRole('button', { name: '下一页' }).click(); await b.waitForTimeout(600);
  await b.getByRole('checkbox', { name: '全选' }).click();
  appended = true;
  await b.getByTestId('batch-fetch-selected').click();
  await b.waitForTimeout(2200);
  check('batch: appended accounts run at full concurrency (peak ≥ 3)', peakAfterAppend >= 3, `peak=${peakAfterAppend} of ${all.length}`);
  await b.getByTestId('batch-cancel').click().catch(() => {});
  await b.waitForTimeout(1500);
  await c.close();
  await p.context().close();
}

// ---------------------------------------------------------------- auth / empty
async function authSuite() {
  if (!BASE_PW) { check('auth suite skipped (set BASE_PW to an empty-DB server with ACCESS_PASSWORD=secret123)', true); return; }
  const p = await newPage({ base: BASE_PW });
  await go(p, '/dashboard');
  check('auth: login screen shown first', (await p.locator('text=访问验证').count()) === 1);
  check('auth: no "Unauthorized" toasts behind the login screen', (await p.locator('[data-sonner-toast]').count()) === 0);
  await p.fill('input[type=password]', 'nope'); await p.keyboard.press('Enter'); await p.waitForTimeout(800);
  check('auth: wrong password message', (await p.locator('text=密码错误').count()) === 1);
  await p.fill('input[type=password]', 'secret123'); await p.keyboard.press('Enter'); await p.waitForTimeout(2500);
  check('auth: login reaches dashboard', (await p.locator('h1:has-text("概览")').count()) === 1);
  check('empty: 刷新全部 Token disabled with 0 accounts', await p.locator('button:has-text("刷新全部 Token")').isDisabled());
  await go(p, '/accounts');
  check('empty: export disabled with 0 accounts', await p.locator('button:has-text("导出")').first().isDisabled());
  await go(p, '/mail');
  check('empty: mail page offers 导入账户 action', (await p.locator('button:has-text("导入账户")').count()) === 1);
  await p.evaluate(() => localStorage.setItem('auth_token', 'expired'));
  await go(p, '/accounts');
  await p.waitForTimeout(600);
  check('auth: expired token → login screen, no error toasts', (await p.locator('text=访问验证').count()) === 1 && (await p.locator('[data-sonner-toast]').count()) === 0);
  await p.context().close();
}

const suites = { reader: readerSuite, accounts: accountsSuite, mail: mailSuite, misc: miscSuite, auth: authSuite };
for (const [k, fn] of Object.entries(suites)) {
  if (ONLY.length && !ONLY.includes(k)) continue;
  console.log(`\n### ${k}`);
  try { await fn(); } catch (e) { check(`${k} suite threw`, false, e.message.split('\n')[0]); }
}
await browser.close();
check('no pageerror / unexpected console.error', errors.length === 0, [...new Set(errors)].slice(0, 6).join(' | '));
console.log(`\n== ${passed} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
