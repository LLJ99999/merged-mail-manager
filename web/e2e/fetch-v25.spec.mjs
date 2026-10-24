/**
 * v2.5 收取逻辑回归（Playwright，非 CI）。真实 Koa/SQLite 服务端，不伪造 /api/mails/fetch 的响应。
 *
 * 为了让「收取」稳定地处于进行中，本脚本在 HANG_PORT 上起一个「挂起的服务器」：接受 TCP 连接但从不应答。
 * 通过 API 新建一个指向它的 SOCKS5 代理并设为默认（结束时恢复原默认代理），再新建 6 个指向它的自定义 IMAP 账户
 * （hang1..6@hang.test）。于是每一次真实的收取都会挂起，直到服务端 FETCH_TIMEOUT（建议 8 秒）到期后以超时 / 缓存回退结束
 * ——失败路径即可，覆盖的是前端编排。不拦截、不伪造任何接口（只监听请求用于计数）。
 *
 * 准备：
 *   cd server && rm -f data/v25.db* && DB_PATH=./data/v25.db npx tsx scripts/seed-demo.ts \
 *     && DB_PATH=./data/v25.db PORT=3925 FETCH_TIMEOUT=8 npm start
 *   BASE=http://localhost:3925 OUT=./e2e-out node web/e2e/fetch-v25.spec.mjs [entry|dedup|batch|switch|cancel|toast]
 *
 * 覆盖：同一 key 去重（拦截计数）、批量中手动收取、收取中途切换账户、单个 / 全部取消、每个页面的入口、
 *       同一页面没有重复的收取动作、提示策略、进度面板只在 ≥ 2 个账户时出现、徽标与列表头部一致、0 console error。
 */
import { chromium } from 'playwright';
import net from 'node:net';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:3925';
const OUT = process.env.OUT || './e2e-out';
const HANG_PORT = Number(process.env.HANG_PORT || 3994);
const ONLY = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });

let passed = 0, failures = 0;
function check(name, ok, detail = '') {
  ok ? passed++ : failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const api = async (path, init) => (await (await fetch(BASE + '/api' + path, { headers: { 'Content-Type': 'application/json' }, ...init })).json());

// ---------------------------------------------------------------- hang IMAP server
const sockets = new Set();
const hang = net.createServer(s => { sockets.add(s); s.on('error', () => {}); s.on('close', () => sockets.delete(s)); });
await new Promise(r => hang.listen(HANG_PORT, '127.0.0.1', r));

// ---------------------------------------------------------------- fixtures
async function ensureHangAccounts() {
  const have = (await api('/accounts?pageSize=10000&search=hang.test')).data.list;
  for (let i = 1; i <= 6; i++) {
    const email = `hang${i}@hang.test`;
    if (have.some(a => a.email === email)) continue;
    const r = await api('/accounts', { method: 'POST', body: JSON.stringify({ email, provider: 'custom', imap_host: '127.0.0.1', imap_port: HANG_PORT, imap_password: 'x', remark: 'v25 hang' }) });
    if (r.code !== 200) throw new Error(`create ${email}: ${r.message}`);
  }
  return (await api('/accounts?pageSize=10000&search=hang.test')).data.list.sort((a, b) => a.email.localeCompare(b.email));
}
const HANG = await ensureHangAccounts();
// 默认代理 → 挂起服务器（演示账户的收取也会挂起到 FETCH_TIMEOUT）
const proxies = (await api('/proxies')).data;
const origDefault = proxies.find(x => x.is_default)?.id;
let hangProxy = proxies.find(x => x.name === 'v25 hang');
if (!hangProxy) hangProxy = (await api('/proxies', { method: 'POST', body: JSON.stringify({ name: 'v25 hang', type: 'socks5', host: '127.0.0.1', port: HANG_PORT }) })).data;
await api(`/proxies/${hangProxy.id}/default`, { method: 'PUT' });
const ALL = (await api('/accounts?pageSize=10000')).data.list;
const DEMO = ALL.filter(a => !a.email.endsWith('@hang.test'));
// 有缓存邮件的两个演示账户（切换测试用）
const withMail = [];
for (const a of DEMO) {
  const c = await api(`/mails/cached?account_id=${a.id}&mailbox=INBOX&pageSize=5`);
  if (c.data?.list?.length) withMail.push({ ...a, subjects: c.data.list.map(m => m.subject) });
  if (withMail.length >= 2) break;
}

const browser = await chromium.launch();
const errors = [];

async function newPage({ viewport = { width: 1440, height: 900 } } = {}) {
  const c = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await c.addInitScript(() => {
    if (!sessionStorage.getItem('qa-init')) {
      localStorage.clear();
      localStorage.setItem('mm-appearance', JSON.stringify({ mode: 'light', seed: '#4285F4', variant: 'tonal', glass: false }));
      localStorage.setItem('mm-mail-accounts-collapsed', '0');
      sessionStorage.setItem('qa-init', '1');
    }
  });
  await c.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, r => r.abort());
  const p = await c.newPage();
  p.fetches = [];
  p.cachedReqs = [];
  // 同一个 key 同时在途的请求（真正的重复请求）
  const live = new Map();
  p.overlaps = [];
  const keyOf = r => { try { const b = JSON.parse(r.postData() || '{}'); return `${b.account_id}:${b.mailbox}`; } catch { return ''; } };
  const isFetch = r => r.method() === 'POST' && r.url().endsWith('/api/mails/fetch');
  p.on('request', r => { if (!isFetch(r)) return; const k = keyOf(r); live.set(k, (live.get(k) || 0) + 1); if (live.get(k) > 1) p.overlaps.push(k); });
  const end = r => { if (!isFetch(r)) return; const k = keyOf(r); live.set(k, Math.max(0, (live.get(k) || 1) - 1)); };
  p.on('requestfinished', end);
  p.on('requestfailed', end);
  p.on('request', r => {
    if (r.method() === 'POST' && r.url().endsWith('/api/mails/fetch')) {
      try { const b = JSON.parse(r.postData() || '{}'); p.fetches.push({ key: `${b.account_id}:${b.mailbox}`, at: Date.now() }); } catch { /* ignore */ }
    }
    if (r.method() === 'GET' && r.url().includes('/api/mails/cached')) p.cachedReqs.push({ url: r.url(), at: Date.now() });
  });
  p.on('pageerror', e => errors.push(`PAGEERROR ${e.message}`));
  p.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Failed to load resource/.test(t)) return; // 浏览器自身的网络日志（失败的收取 = HTTP 错误响应）
    errors.push(`console.error ${t.slice(0, 240)}`);
  });
  return { c, p };
}
const count = (p, key) => p.fetches.filter(f => f.key === key).length;
const dupKeys = p => { const m = {}; p.fetches.forEach(f => { m[f.key] = (m[f.key] || 0) + 1; }); return Object.entries(m).filter(([, n]) => n > 1); };
const go = async (p, path, ms = 1300) => { await p.goto(BASE + path); await p.waitForTimeout(ms); };
const toasts = p => p.locator('[data-sonner-toast]').allInnerTexts();
const busy = async p => (await p.locator('[data-testid=fetch-button][aria-busy=true]').count()) === 1;
const panel = p => p.locator('[data-testid=batch-panel]');
async function confirmIfAsked(p) {
  const b = p.locator('[role=dialog] button:has-text("开始收取"), [role=dialog] button:has-text("追加")');
  if (await b.count()) { await b.first().click(); await p.waitForTimeout(300); }
}
async function waitIdle(p, timeout = 30000) {
  await p.waitForFunction(() => !document.querySelector('[data-testid=fetch-button][aria-busy=true], [data-busy=true], [data-testid=acc-batch-status][data-status=running], [data-testid=acc-batch-status][data-status=queued]'), null, { timeout }).catch(() => {});
}
/** 页面上所有可见的、与「收取」有关的可点击动作（按钮文字 / aria-label 归一化） */
async function fetchActions(p) {
  return p.evaluate(() => {
    const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    return [...document.querySelectorAll('button, a, [role=menuitem]')].filter(vis)
      .map(b => (b.getAttribute('aria-label') || b.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(t => /收取/.test(t) && !/进度|详情|更多收取选项/.test(t)); // 分体按钮的下拉箭头只是打开菜单
  });
}

// ---------------------------------------------------------------- 1. 入口
async function entrySuite() {
  const { c, p } = await newPage();
  const h = HANG[0];
  // 邮件页（选中账户）
  await go(p, `/mail/${h.id}`);
  let acts = await fetchActions(p);
  check('entry(mail): 列表头部一个「收取」+ 账户栏一个「收取全部 (n)」，没有别的收取入口', acts.length === 2 && acts.includes('收取') && acts.some(t => /^收取全部 \(\d+\)$/.test(t)), JSON.stringify(acts));
  check('entry(mail): 导航栏 FAB 不再是收取（保持「导入」）', (await p.locator('aside:has(nav) button[aria-label="导入"]').count()) === 1 && (await p.locator('aside:has(nav) button[aria-label*="收取"]').count()) === 0);
  await p.getByTestId('fetch-menu-button').click(); await p.waitForTimeout(300);
  const menu = await p.locator('[role=menu] [role=menuitem]').allInnerTexts();
  check('entry(mail): 菜单只有「收取收件箱和垃圾箱」（批量入口不重复出现在菜单里）', menu.length === 1 && /收取收件箱和垃圾箱/.test(menu[0]), JSON.stringify(menu));
  acts = await fetchActions(p);
  check('entry(mail): 菜单打开时也没有重复的收取动作', new Set(acts).size === acts.length, JSON.stringify(acts));
  await p.keyboard.press('Escape');
  check('entry(mail): 旧的错误文案已移除', (await p.locator('text=/全部重新获取|收取所有账户|批量收取|全部收取|收取新邮件/').count()) === 0);
  // 邮件页（未选账户）
  await go(p, '/mail');
  acts = await fetchActions(p);
  check('entry(mail, 未选账户): 只有账户栏「收取全部 (n)」', acts.length === 1 && /^收取全部 \(\d+\)$/.test(acts[0]), JSON.stringify(acts));
  // 账户栏收起：只剩图标按钮，仍是同一个入口
  await p.locator('main aside button[aria-label="折叠"]').click(); await p.waitForTimeout(500);
  acts = await fetchActions(p);
  check('entry(mail, 账户栏收起): 收取全部以图标按钮保留', acts.length === 1 && /^收取全部/.test(acts[0]), JSON.stringify(acts));
  await p.locator('main aside button[aria-label="折叠"]').click(); await p.waitForTimeout(400);
  // 账户页
  await go(p, '/accounts', 1500);
  acts = await fetchActions(p);
  check('entry(accounts): 无选中时只有「收取全部 (n)」', acts.length === 1 && acts[0] === `收取全部 (${ALL.length})`, JSON.stringify(acts));
  const boxes = p.locator('main tbody tr td:first-child [role=checkbox]');
  await boxes.nth(0).click(); await boxes.nth(1).click(); await p.waitForTimeout(500);
  acts = await fetchActions(p);
  check('entry(accounts): 有选中时只有「收取选中 (2)」', acts.length === 1 && acts[0] === '收取选中 (2)', JSON.stringify(acts));
  // 概览
  await go(p, '/dashboard', 1500);
  acts = await fetchActions(p);
  check('entry(dashboard): 只有一个「收取全部」', acts.length === 1 && acts[0] === '收取全部', JSON.stringify(acts));
  // 代理 / 设置：没有收取入口
  await go(p, '/proxy'); const ap = await fetchActions(p);
  await go(p, '/settings'); const as = await fetchActions(p);
  check('entry(proxy/settings): 没有收取入口', ap.length === 0 && as.length === 0, JSON.stringify([ap, as]));
  await c.close();
}

// ---------------------------------------------------------------- 2. 去重 + 单个取消
async function dedupSuite() {
  const { c, p } = await newPage();
  const h = HANG[0];
  await go(p, `/mail/${h.id}`);
  const fb = p.getByTestId('fetch-button');
  await fb.click();
  await fb.dblclick();
  await fb.click();
  await p.waitForTimeout(900);
  check('dedup: 单击 + 双击 + 单击 → 同一 key 只有 1 个请求', count(p, `${h.id}:INBOX`) === 1, `n=${count(p, `${h.id}:INBOX`)}`);
  check('dedup: 收取中按钮仍可点击（不禁用）且显示忙碌', await busy(p) && !(await fb.isDisabled()));
  const badge = await p.locator('main aside [data-testid=acc-batch-status]').first().getAttribute('data-status').catch(() => null);
  check('dedup: 账户栏徽标与列表头部一致（running）', badge === 'running', `badge=${badge}`);
  check('dedup: 单个收取不弹进度面板', (await panel(p).count()) === 0);
  // 菜单：收取收件箱和垃圾箱 → INBOX 加入已有任务，只新增 Junk（同一账户串行：Junk 排队）
  await p.getByTestId('fetch-menu-button').click(); await p.waitForTimeout(250);
  await p.locator('[role=menuitem]:has-text("收取收件箱和垃圾箱")').click(); await p.waitForTimeout(800);
  check('dedup: 「收取收件箱和垃圾箱」不重复收件箱（INBOX 仍 1 个请求）', count(p, `${h.id}:INBOX`) === 1);
  check('dedup: 同一账户的垃圾箱排队，不与收件箱并发', count(p, `${h.id}:Junk`) === 0, `junk=${count(p, `${h.id}:Junk`)}`);
  // 切到垃圾箱：按钮显示「排队中…」
  await p.locator('main section button:has-text("垃圾箱")').first().click(); await p.waitForTimeout(600);
  const lbl = await fb.getAttribute('aria-label');
  check('dedup: 垃圾箱的列表头部显示「排队中…」', lbl === '排队中…', `label=${lbl}`);
  // 单个取消（菜单「取消收取」= 这个账户的全部任务）
  await p.getByTestId('fetch-menu-button').click(); await p.waitForTimeout(250);
  const items = await p.locator('[role=menu] [role=menuitem]').allInnerTexts();
  check('cancel(job): 进行中时菜单出现「取消收取」', items.some(t => /取消收取/.test(t)), JSON.stringify(items));
  await p.locator('[role=menuitem]:has-text("取消收取")').click(); await p.waitForTimeout(700);
  check('cancel(job): 取消后按钮立即恢复', !(await busy(p)));
  const t = await toasts(p);
  check('cancel(job): 一条「已取消收取」提示', t.filter(x => /已取消收取/.test(x)).length === 1, JSON.stringify(t));
  await p.waitForTimeout(1500);
  check('cancel(job): 取消后排队中的垃圾箱不再发请求', count(p, `${h.id}:Junk`) === 0);
  check('dedup: 全程没有重复 key 的请求（也没有同时在途的）', dupKeys(p).length === 0 && p.overlaps.length === 0, JSON.stringify(dupKeys(p)));
  await c.close();
}

// ---------------------------------------------------------------- 3. 批量 + 批量中的手动收取
async function batchSuite() {
  const { c, p } = await newPage();
  const [h1] = HANG;
  // 先手动收取 h1（单个，进行中）→ 再收取全部（筛选 hang.test：6 个）
  await go(p, `/mail/${h1.id}`);
  await p.getByTestId('fetch-button').click(); await p.waitForTimeout(500);
  await p.locator('main aside input[placeholder="搜索账户"]').fill('hang.test'); await p.waitForTimeout(500);
  const scope = p.getByTestId('fetch-all-accounts');
  check('batch: 账户栏按钮作用于筛选结果「收取全部 (6)」', (await scope.getAttribute('aria-label')) === '收取全部 (6)', await scope.getAttribute('aria-label'));
  await scope.click(); await confirmIfAsked(p); await p.waitForTimeout(800);
  check('batch: ≥ 2 个账户 → 进度面板出现', await panel(p).isVisible());
  const cnt = await p.getByTestId('batch-count').textContent();
  check('batch: 面板 x / 6（手动收取中的账户被批次接管，没有另起请求）', /\/ 6 个账户/.test(cnt || '') && count(p, `${h1.id}:INBOX`) === 1, `${cnt} h1=${count(p, `${h1.id}:INBOX`)}`);
  const inflight = new Set(p.fetches.map(f => f.key)).size;
  check('batch: 固定并发 4', inflight === 4, `started=${inflight}`);
  check('batch: 所有入口显示同一进度（账户栏按钮 busy + x/6）', (await scope.getAttribute('data-busy')) === 'true' && /\d\/6/.test(await p.getByTestId('fetch-scope-progress').innerText()));
  // 打开一个排队中的账户并点「收取」：加入并提到队首，不另起请求
  const queuedBtn = p.locator('main aside button:has([data-testid=acc-batch-status][data-status=queued])').first();
  const h6email = (await queuedBtn.innerText()).split('\n')[0].trim();
  const h6 = HANG.find(a => a.email === h6email) || HANG[5];
  await queuedBtn.click(); await p.waitForTimeout(700);
  const st = await p.getByTestId('fetch-button').getAttribute('aria-label');
  check('batch: 排队中的账户在列表头部显示「排队中…」', st === '排队中…', `label=${st}`);
  await p.getByTestId('fetch-button').click(); await p.waitForTimeout(500);
  const t1 = await toasts(p);
  check('batch: 批量中手动收取 → 提示已在批量收取中（不另发请求）', t1.some(x => /已在批量收取中/.test(x)) && count(p, `${h6.id}:INBOX`) <= 1, JSON.stringify(t1));
  // 再点一次账户栏按钮 = 追加；全部已在队列 → 不重复
  await scope.click(); await p.waitForTimeout(500);
  check('batch: 运行中再点「收取全部」→ 已在队列中，不重复', (await toasts(p)).some(x => /已在收取队列中/.test(x)) && dupKeys(p).length === 0);
  // 跨页面：账户页、概览的入口显示同一进度
  await p.locator('aside nav a:has-text("账户")').click(); await p.waitForTimeout(1200);
  const accBtn = p.getByTestId('batch-fetch-all');
  check('batch: 账户页入口显示同一进度（busy）', (await accBtn.getAttribute('data-busy')) === 'true');
  const accBadges = await p.locator('main tbody [data-testid=acc-batch-status]').count();
  check('batch: 账户表格同样显示收取徽标', accBadges >= 1, `badges=${accBadges}`);
  await p.locator('aside nav a:has-text("概览")').click(); await p.waitForTimeout(1200);
  check('batch: 概览入口显示同一进度（busy）', (await p.getByTestId('dashboard-fetch-all').getAttribute('data-busy')) === 'true');
  await p.screenshot({ path: `${OUT}/v25-batch-dashboard.png` });
  // 等批次结束（挂起服务器 → FETCH_TIMEOUT 后失败）
  await p.waitForFunction(() => /收取完成/.test(document.querySelector('[data-testid=batch-panel]')?.textContent || ''), null, { timeout: 40000 }).catch(() => {});
  await p.waitForTimeout(600);
  const t2 = await toasts(p);
  check('batch: 结束时只有一条汇总提示，没有逐账户提示', t2.filter(x => /收取完成/.test(x)).length === 1 && !t2.some(x => /收取失败|网络通道全部失败|收取 \d+ 封 · 通道/.test(x)), JSON.stringify(t2));
  check('batch: 每个 key 只请求一次', dupKeys(p).length === 0 && HANG.every(a => count(p, `${a.id}:INBOX`) === 1), JSON.stringify(dupKeys(p)));
  await p.locator('[data-testid=batch-panel] button:has-text("完成")').click(); await p.waitForTimeout(500);
  check('batch: 「完成」后面板与徽标清除', (await panel(p).count()) === 0 && (await p.locator('[data-testid=acc-batch-status]').count()) === 0);
  await c.close();
}

// ---------------------------------------------------------------- 4. 中途切换账户
async function switchSuite() {
  if (withMail.length < 2) { check('switch: 需要两个有缓存邮件的演示账户', false); return; }
  const [a, b] = withMail;
  const { c, p } = await newPage();
  let released = false;
  p.on('response', r => { if (r.url().endsWith('/api/mails/fetch')) released = true; });
  await go(p, `/mail/${a.id}`);
  await p.getByTestId('fetch-button').click(); await p.waitForTimeout(400);
  await p.locator(`main aside button:has-text("${b.email}")`).click(); await p.waitForTimeout(800);
  const switchAt = Date.now();
  check('switch: 切到别的账户后列表头部不显示忙碌（忙碌属于 A）', !(await busy(p)));
  const badgeA = await p.locator(`main aside button:has-text("${a.email}") [data-testid=acc-batch-status]`).getAttribute('data-status').catch(() => null);
  check('switch: A 的账户行徽标仍显示收取中', badgeA === 'running' || badgeA === 'queued', `badgeA=${badgeA}`);
  await p.waitForFunction(() => !document.querySelector('[data-testid=acc-batch-status][data-status=running]'), null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(1200);
  const rows = await p.locator('main section button.group').allInnerTexts();
  // 用完整主题比较：列表里每一行都必须是 B 的缓存邮件，且没有只属于 A 的邮件
  const subj = async id => (await api(`/mails/cached?account_id=${id}&mailbox=INBOX&pageSize=200`)).data.list.map(m => String(m.subject || ''));
  const [subA, subB] = [await subj(a.id), await subj(b.id)];
  const aOnly = subA.filter(x => x && !subB.includes(x));
  const showsB = rows.length > 0 && rows.every(r => subB.some(x => x && r.includes(x)));
  const showsAOnly = rows.some(r => aOnly.some(x => r.includes(x)));
  check('switch: A 的收取结果返回后列表仍是 B 的邮件', showsB && !showsAOnly && released, `rows=${rows.length} showsB=${showsB} showsA=${showsAOnly} released=${released} B=${JSON.stringify(b.subjects.slice(0, 2))} first=${JSON.stringify(rows.slice(0, 2))}`);
  const staleReload = p.cachedReqs.filter(r => r.at > switchAt && r.url.includes(`account_id=${a.id}&`)).length;
  check('switch: 没有为不在显示的 A 重新读取列表', staleReload === 0, `n=${staleReload}`);
  // 回到 A：看到 A 的邮件
  await p.locator(`main aside button:has-text("${a.email}")`).click(); await p.waitForTimeout(1200);
  const rowsA = await p.locator('main section button.group').allInnerTexts();
  check('switch: 回到 A 显示 A 的邮件', a.subjects.some(s => rowsA.some(r => r.includes(String(s).slice(0, 12)))));
  await c.close();
}

// ---------------------------------------------------------------- 5. 单个 / 全部取消（批量）
async function cancelSuite() {
  const { c, p } = await newPage();
  await go(p, '/mail');
  await p.locator('main aside input[placeholder="搜索账户"]').fill('hang.test'); await p.waitForTimeout(500);
  await p.getByTestId('fetch-all-accounts').click(); await confirmIfAsked(p); await p.waitForTimeout(900);
  await p.locator('[data-testid=batch-panel] button[aria-label="展开详情"]').click(); await p.waitForTimeout(500);
  // 单个取消：第一行（进行中）
  const firstRow = p.locator('[data-testid=batch-list] li').first();
  const email = (await firstRow.locator('p').first().innerText()).trim();
  await firstRow.hover();
  await firstRow.getByTestId('batch-row-cancel').click(); await p.waitForTimeout(700);
  check('cancel(row): 面板中取消单个账户 → 该行「已取消」', (await firstRow.getAttribute('data-status')) === 'cancelled', email);
  const running = await p.locator('[data-testid=batch-list] li[data-status=running]').count();
  check('cancel(row): 其他账户继续（空出的并发由排队中的补上）', running === 4, `running=${running}`);
  await p.screenshot({ path: `${OUT}/v25-cancel-row.png` });
  const before = p.fetches.length;
  await p.getByTestId('batch-cancel').click(); await p.waitForTimeout(900);
  const txt = await panel(p).innerText();
  check('cancel(all): 「全部取消」后批次结束并显示取消数', /收取完成/.test(txt) && /取消 6/.test(txt), txt.replace(/\s+/g, ' ').slice(0, 140));
  await p.waitForTimeout(1500);
  check('cancel(all): 取消后不再发出新的收取请求', p.fetches.length === before, `${before} → ${p.fetches.length}`);
  const t = await toasts(p);
  check('cancel(all): 一条汇总提示', t.filter(x => /收取完成/.test(x)).length === 1, JSON.stringify(t));
  check('cancel(all): 列表头部 / 徽标都回到空闲', (await p.locator('[data-testid=acc-batch-status][data-status=running], [data-testid=acc-batch-status][data-status=queued]').count()) === 0);
  await c.close();
}

// ---------------------------------------------------------------- 6. 提示策略 / 面板阈值（演示账户，真实服务端快速失败或回退缓存）
async function toastSuite() {
  const { c, p } = await newPage();
  const d = DEMO[0];
  await go(p, `/mail/${d.id}`);
  await p.getByTestId('fetch-button').click();
  await waitIdle(p); await p.waitForTimeout(600);
  let t = await toasts(p);
  check('toast(single): 单个收取恰好一条结果提示，无面板', t.length === 1 && (await panel(p).count()) === 0, JSON.stringify(t));
  // 账户页：选中 1 个 → 收取选中 (1) 按单个处理（无面板）
  await go(p, '/accounts', 1500);
  const boxes = p.locator('main tbody tr td:first-child [role=checkbox]');
  await boxes.nth(0).click(); await p.waitForTimeout(300);
  await p.getByTestId('batch-fetch-selected').click();
  await waitIdle(p); await p.waitForTimeout(600);
  t = await toasts(p);
  check('toast(selected 1): 1 个账户不弹进度面板，提示它自己的结果', (await panel(p).count()) === 0 && t.length >= 1, JSON.stringify(t));
  // 选中 3 个演示账户 → 批量：只有汇总
  await p.locator('main button[aria-label="取消选择"]').click(); await p.waitForTimeout(500);
  const rows = p.locator('main tbody tr');
  const n = await rows.count();
  let picked = 0;
  for (let i = 0; i < n && picked < 3; i++) {
    if ((await rows.nth(i).innerText()).includes('hang.test')) continue;
    await rows.nth(i).locator('td:first-child [role=checkbox]').click(); picked++;
  }
  await p.waitForTimeout(400);
  const before = (await toasts(p)).length;
  await p.getByTestId('batch-fetch-selected').click(); await p.waitForTimeout(400);
  check('toast(bulk): 3 个账户 → 进度面板', await panel(p).isVisible());
  await p.waitForFunction(() => /收取完成/.test(document.querySelector('[data-testid=batch-panel]')?.textContent || ''), null, { timeout: 40000 }).catch(() => {});
  await p.waitForTimeout(800);
  t = await toasts(p);
  check('toast(bulk): 批量只出汇总，没有逐账户提示', t.filter(x => /收取完成/.test(x)).length === 1 && !t.some(x => /网络通道全部失败|收取 \d+ 封 · 通道|收取失败/.test(x)), `before=${before} ${JSON.stringify(t)}`);
  check('toast: 同一个 key 从未同时有两个请求在途（先后两次收取是正常的）', p.overlaps.length === 0, JSON.stringify(p.overlaps));
  await c.close();
}

const suites = { entry: entrySuite, dedup: dedupSuite, batch: batchSuite, switch: switchSuite, cancel: cancelSuite, toast: toastSuite };
for (const [k, fn] of Object.entries(suites)) {
  if (ONLY.length && !ONLY.includes(k)) continue;
  console.log(`\n### ${k}`);
  try { await fn(); } catch (e) { check(`${k} suite threw`, false, e.message.split('\n')[0]); }
}
const uniq = [...new Set(errors)];
check('0 pageerror / console.error', uniq.length === 0, uniq.slice(0, 6).join('\n      '));
await browser.close();
if (origDefault) await api(`/proxies/${origDefault}/default`, { method: 'PUT' });
sockets.forEach(s => s.destroy());
hang.close();
console.log(`\n== ${passed} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
