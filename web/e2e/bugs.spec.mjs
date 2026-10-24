/**
 * 回归 QA：用户反馈的三个问题 + 批量收取（Playwright，非 CI）。
 *
 *   1) 导入邮箱后无法点击其他页面按钮（粘贴 / 文件导入；新增 + 已存在；预览后取消 / Esc / 返回键；叠加对话框）
 *   2) 刷新/收取邮件后点击其他页面显示空白（网络失败、HTTP 500、业务错误、空数据、null、畸形数据、截断 JSON、
 *      收取进行中离开页面、注入渲染错误 → 错误卡片而不是白屏）
 *   3) 批量收取：收取选中 / 收取全部的进度（x/y、成功/失败计数、每账户通道）、跨页面保持、取消
 *
 * 运行方式同 nav.spec.mjs：
 *   cd server && DB_PATH=./data/demo.db npx tsx scripts/seed-demo.ts && DB_PATH=./data/demo.db PORT=3917 npm start
 *   BASE=http://localhost:3917 OUT=./e2e-out node web/e2e/bugs.spec.mjs [import|stack|fetch|api|crash|batch]
 *
 * 所有 /api/mails/fetch 请求都被拦截并伪造（不访问真实邮箱）；任何 pageerror 或非预期的 console.error 记为失败。
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE || 'http://localhost:3917';
const OUT = process.env.OUT || './e2e-out';
const ONLY = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

const browser = await chromium.launch();
const errors = [];
const NAV = ['概览', '邮件', '账户', '代理', '设置'];
const TITLE = { 概览: '概览', 邮件: '邮箱', 账户: '账户', 代理: '代理', 设置: '设置' };

async function newPage({ viewport = { width: 1440, height: 900 }, fetchHandler } = {}) {
  const c = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await c.addInitScript(() => {
    if (!sessionStorage.getItem('qa-init')) {
      localStorage.clear();
      localStorage.setItem('mm-appearance', JSON.stringify({ mode: 'light', seed: '#4285F4', variant: 'tonal', glass: false }));
      sessionStorage.setItem('qa-init', '1');
    }
  });
  await c.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, r => r.abort());
  // 默认：收取永远走伪造的成功结果，绝不连接真实邮箱
  await c.route('**/api/mails/fetch', fetchHandler || (r => okFetch(r)));
  const p = await c.newPage();
  p.expectedConsole = [];
  p.on('pageerror', e => errors.push(`PAGEERROR ${e.message}`));
  p.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // 场景内故意制造的失败请求 / 故意注入的渲染错误
    if (/Failed to load resource|net::ERR_FAILED/.test(t)) return;
    if (p.expectedConsole.some(re => re.test(t))) return;
    errors.push(`console.error ${t.slice(0, 240)}`);
  });
  return { c, p };
}

const settle = (p, ms = 700) => p.waitForTimeout(ms);
const delay = ms => new Promise(r => setTimeout(r, ms));

function bodyOf(r) {
  try { return JSON.parse(r.request().postData() || '{}'); } catch { return {}; }
}
async function okFetch(r, { wait = 250 } = {}) {
  const { account_id = 1, mailbox = 'INBOX' } = bodyOf(r);
  await delay(wait);
  return r.fulfill({ json: { code: 200, message: 'ok', data: { channel: 'graph', protocol: 'graph', cached: false, total: 1, mails: [
    { id: 900000 + account_id, account_id, mailbox, mail_id: 'qa', sender: 'qa@example.com', sender_name: 'QA', subject: 'QA 伪造邮件', text_content: 'hello', html_content: '<p>hello</p>', mail_date: new Date().toISOString(), is_read: false, attachments: [] },
  ] } } });
}

/** body 上没有残留锁、没有打开的对话框 */
async function unlocked(p) {
  return p.evaluate(() => ({
    pe: getComputedStyle(document.body).pointerEvents,
    locked: document.body.hasAttribute('data-scroll-locked'),
    dialogs: document.querySelectorAll('[role=dialog]').length,
    hidden: document.querySelectorAll('[data-aria-hidden]').length,
  }));
}

/** 依次点击每个导航项：URL、标题正确，main 非空、没有错误卡片 */
async function navEverywhere(p, label) {
  for (const n of NAV) {
    let clicked = true;
    try { await p.locator(`aside nav a:has-text("${n}")`).click({ timeout: 2500 }); } catch { clicked = false; }
    await settle(p, 650);
    const s = await p.evaluate(() => ({
      path: location.pathname,
      text: (document.querySelector('main')?.innerText || '').trim().length,
      titles: [...document.querySelectorAll('main h1, main aside h2')].map(h => h.textContent.trim()),
      boundary: !!document.querySelector('[data-testid=error-boundary]'),
      opacity: Number(getComputedStyle(document.querySelector('main > div') || document.body).opacity),
    }));
    check(`${label}: 导航「${n}」可点击且非空白`, clicked && s.text > 20 && s.titles.includes(TITLE[n]) && !s.boundary && s.opacity > 0.99,
      `clicked=${clicked} path=${s.path} text=${s.text} titles=${JSON.stringify(s.titles)} boundary=${s.boundary} opacity=${s.opacity}`);
  }
}

async function openImport(p, from) {
  if (from === 'rail') await p.locator('aside button[aria-label="导入"]').click();
  else await p.locator('main button:has-text("导入")').first().click();
  await p.locator('[role=dialog] textarea, [role=dialog] input[type=file]').first().waitFor({ state: 'attached', timeout: 3000 });
  await settle(p, 350);
}

// ---------------------------------------------------------------------------
async function importSuite() {
  const { c, p } = await newPage();
  const uniq = () => `qa${Date.now()}${Math.floor(Math.random() * 1e4)}`;

  // A. 账户页：粘贴新账户 → 预览 → 确认
  await p.goto(BASE + '/accounts'); await settle(p, 1500);
  await openImport(p);
  await p.locator('[role=dialog] textarea').fill(`${uniq()}@gmail.com----pass1\n${uniq()}@qq.com----authcode`);
  await p.locator('[role=dialog] button:has-text("下一步")').click(); await settle(p, 700);
  await p.locator('[role=dialog] button:has-text("确认导入")').click(); await settle(p, 900);
  let u = await unlocked(p);
  check('import(paste,new): 对话框关闭且 body 无残留锁', u.dialogs === 0 && u.pe !== 'none' && !u.locked && u.hidden === 0, JSON.stringify(u));
  // 页面按钮：新增账户对话框能打开/关闭；筛选 chip 可点
  await p.locator('main button:has-text("新增账户")').click({ timeout: 2500 }).catch(() => {});
  await settle(p, 500);
  check('import(paste,new): 之后「新增账户」按钮可点击', (await unlocked(p)).dialogs === 1);
  await p.keyboard.press('Escape'); await settle(p, 600);
  await p.locator('main button:has-text("异常")').click({ timeout: 2500 }).then(() => true, () => false).then(ok => check('import(paste,new): 之后状态筛选可点击', ok));
  await p.locator('main button:has-text("全部")').first().click({ timeout: 2500 }).catch(() => {});
  await navEverywhere(p, 'import(paste,new)');

  // B. 已存在（覆盖更新）+ 新增混合
  await p.goto(BASE + '/accounts'); await settle(p, 1200);
  await openImport(p);
  await p.locator('[role=dialog] textarea').fill(`alice.chen@outlook.com----pw----9e5f94bc-e8a4-4e73-b8be-63364c29d753----M.C5_BAY.0.U.-Demo1${'x'.repeat(80)}\n${uniq()}@163.com----auth`);
  await p.locator('[role=dialog] button:has-text("下一步")').click(); await settle(p, 700);
  await p.locator('[role=dialog] button:has-text("覆盖更新")').click(); await settle(p, 300);
  await p.locator('[role=dialog] button:has-text("确认导入")').click(); await settle(p, 900);
  u = await unlocked(p);
  check('import(duplicate+overwrite): 对话框关闭且 body 无残留锁', u.dialogs === 0 && u.pe !== 'none' && !u.locked, JSON.stringify(u));
  await navEverywhere(p, 'import(duplicate)');

  // C. 只有重复行（跳过）→ 预览后取消 / Esc（旧版在这里卡死）
  for (const how of ['取消', 'Escape', 'back']) {
    await p.goto(BASE + '/accounts'); await settle(p, 1100);
    await openImport(p);
    await p.locator('[role=dialog] textarea').fill('dev.team@gmail.com----abcd efgh ijkl mnop');
    await p.locator('[role=dialog] button:has-text("下一步")').click(); await settle(p, 700);
    if (how === '取消') await p.locator('[role=dialog] button:has-text("取消")').click();
    else if (how === 'Escape') await p.keyboard.press('Escape');
    else await p.goBack();
    await settle(p, 700);
    u = await unlocked(p);
    const url = await p.evaluate(() => location.pathname);
    check(`import(preview → ${how}): 关闭且可点击`, u.dialogs === 0 && u.pe !== 'none' && !u.locked && url === '/accounts', `${JSON.stringify(u)} url=${url}`);
    const ok = await p.locator('aside nav a:has-text("代理")').click({ timeout: 2500 }).then(() => true, () => false);
    await settle(p, 500);
    check(`import(preview → ${how}): 导航可点击`, ok && (await p.evaluate(() => location.pathname)) === '/proxy');
  }

  // D. 文件导入（从邮件页的 Navigation Rail FAB 打开）
  const file = path.join(os.tmpdir(), `qa-import-${Date.now()}.txt`);
  fs.writeFileSync(file, `${uniq()}@gmail.com----pass\n${uniq()}@126.com----auth\nbroken line\n`);
  await p.goto(BASE + '/dashboard'); await settle(p, 1200);
  await openImport(p, 'rail');
  await p.locator('[role=dialog] button:has-text("文件")').click(); await settle(p, 300);
  await p.locator('[role=dialog] input[type=file]').setInputFiles(file); await settle(p, 400);
  await p.locator('[role=dialog] button:has-text("下一步")').click(); await settle(p, 700);
  await p.locator('[role=dialog] button:has-text("确认导入")').click(); await settle(p, 900);
  u = await unlocked(p);
  check('import(file, rail FAB): 对话框关闭且 body 无残留锁', u.dialogs === 0 && u.pe !== 'none' && !u.locked, JSON.stringify(u));
  await navEverywhere(p, 'import(file)');

  // E. 叠加对话框：编辑账户 → 删除标签确认框（若有标签）；返回键逐层关闭
  await p.goto(BASE + '/accounts'); await settle(p, 1200);
  const before = await p.evaluate(() => history.length);
  await p.locator('main button:has-text("新增账户")').click(); await settle(p, 500);
  await p.locator('[role=dialog] input').first().fill('stack@test.dev');
  await p.goBack(); await settle(p, 700);
  u = await unlocked(p);
  check('dialog + 返回键：关闭且停留在本页', u.dialogs === 0 && (await p.evaluate(() => location.pathname)) === '/accounts', JSON.stringify(u));
  // 关闭后立刻导航（退出动画期间）
  await p.locator('main button:has-text("新增账户")').click(); await settle(p, 500);
  await p.locator('[role=dialog] button[aria-label="关闭"]').click();
  const t0 = Date.now();
  await p.locator('aside nav a:has-text("代理")').click({ timeout: 2000 });
  const dt = Date.now() - t0;
  await settle(p, 600);
  check('关闭对话框后立即点击导航：不被遮挡、不被后退吞掉', (await p.evaluate(() => location.pathname)) === '/proxy', `clickDelay=${dt}ms`);
  await p.goBack(); await settle(p, 600);
  check('随后后退回到账户页（历史干净）', (await p.evaluate(() => location.pathname)) === '/accounts', `history ${before}→${await p.evaluate(() => history.length)}`);

  // F. 删除确认框（ConfirmHost）→ 确认后 body 解锁
  await p.locator('main tbody tr').first().click({ button: 'right' }); await settle(p, 300);
  const del = p.locator('button:has-text("删除")').last();
  if (await del.count()) {
    await del.click(); await settle(p, 500);
    await p.locator('[role=dialog] button:has-text("取消")').click(); await settle(p, 600);
    u = await unlocked(p);
    check('确认框取消：body 无残留锁', u.dialogs === 0 && u.pe !== 'none' && !u.locked, JSON.stringify(u));
  }
  await c.close();
}

// ---------------------------------------------------------------------------
const FETCH_CASES = {
  '网络失败': r => r.abort('failed'),
  'HTTP 500 HTML': r => r.fulfill({ status: 500, contentType: 'text/html', body: '<h1>Internal Server Error</h1>' }),
  '业务错误': r => r.fulfill({ json: { code: 500, data: null, message: '所有通道均失败: Graph API: AADSTS70000 | IMAP (New): AUTHENTICATE failed' } }),
  '缓存回退': r => r.fulfill({ json: { code: 200, data: { channel: 'cache', protocol: 'cache', cached: true, total: 1, errors: { graph: 'AADSTS70000', imap_new: null }, mails: [{ id: 1, account_id: 1, mailbox: 'INBOX', subject: 'cached' }] } } }),
  '空列表': r => r.fulfill({ json: { code: 200, data: { mails: [], total: 0, channel: 'graph', protocol: 'graph', cached: false } } }),
  'data=null': r => r.fulfill({ json: { code: 200, data: null } }),
  '缺少 mails': r => r.fulfill({ json: { code: 200, data: { channel: 'weird_channel' } } }),
  '畸形邮件': r => r.fulfill({ json: { code: 200, data: { channel: 'graph', cached: false, mails: [
    { id: 9001, account_id: 1, mailbox: 'INBOX', sender: null, sender_name: null, subject: null, text_content: null, html_content: '<table>' + '<tr><td>大</td></tr>'.repeat(20000) + '</table>', mail_date: null, is_read: 0, attachments: null },
    { id: 9002, account_id: 1, mailbox: 'Spam', sender: { address: 'obj@x.dev', name: 'Obj' }, sender_name: 123, subject: ['数组', '主题'], text_content: 42, html_content: null, mail_date: 'garbage', attachments: 'not json' },
    { id: 9003, attachments: [null, { name: 'a.pdf', size: 'big' }, 'x'] }, null, 'string', { no: 'id' },
  ] } } }),
  '截断 JSON': r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"code":200,"data":{"mails":[{"id":1' }),
};

async function fetchSuite() {
  for (const [name, handler] of Object.entries(FETCH_CASES)) {
    const { c, p } = await newPage({ fetchHandler: async r => { await delay(300); return handler(r); } });
    await p.goto(BASE + '/mail/1'); await settle(p, 1500);
    await p.locator('[data-testid=fetch-button]').click();
    await settle(p, 1100);
    // 打开列表中的一封（畸形数据时也应能渲染阅读面板）
    await p.locator('main section button.group').first().click({ timeout: 1500 }).catch(() => {});
    await settle(p, 600);
    const boundary = await p.locator('[data-testid=error-boundary]').count();
    check(`fetch(${name}): 邮件页未崩溃`, boundary === 0);
    await navEverywhere(p, `fetch(${name})`);
    await c.close();
  }

  // 收取进行中离开页面，再回来（响应在别的页面上返回）
  const { c, p } = await newPage({ fetchHandler: r => okFetch(r, { wait: 2500 }) });
  await p.goto(BASE + '/mail/2'); await settle(p, 1500);
  await p.locator('[data-testid=fetch-button]').click(); await settle(p, 200);
  const busy = await p.locator('[data-testid=fetch-button][aria-busy=true]').count();
  check('fetch(in-flight): 按钮显示忙碌状态', busy === 1);
  await navEverywhere(p, 'fetch(in-flight → navigate)');
  await settle(p, 2500);
  await p.locator('aside nav a:has-text("邮件")').click(); await settle(p, 900);
  const idle = await p.locator('[data-testid=fetch-button]:not([aria-busy])').count();
  check('fetch(in-flight): 回到邮件页后按钮恢复', idle === 1);
  await c.close();
}

// ---------------------------------------------------------------------------
async function crashSuite() {
  // 注入渲染错误：页面级错误边界显示错误卡片（导航仍可用），而不是白屏
  const { c, p } = await newPage();
  p.expectedConsole.push(/QA 注入的渲染错误|页面渲染出错|The above error occurred|React will try to recreate/);
  await p.goto(BASE + '/dashboard'); await settle(p, 1200);
  await p.evaluate(() => localStorage.setItem('mm-qa-crash', '/proxy'));
  await p.locator('aside nav a:has-text("代理")').click(); await settle(p, 700);
  const card = await p.locator('[data-testid=error-boundary]').count();
  const navVisible = await p.locator('aside nav a:has-text("概览")').isVisible();
  check('crash: 页面出错时显示错误卡片且导航仍可见', card === 1 && navVisible);
  await p.evaluate(() => localStorage.removeItem('mm-qa-crash'));
  await p.locator('[data-testid=error-boundary] button:has-text("重试")').click(); await settle(p, 600);
  check('crash: 「重试」后恢复正常', (await p.locator('[data-testid=error-boundary]').count()) === 0 && (await p.locator('main h1:has-text("代理")').count()) === 1);
  await p.evaluate(() => localStorage.setItem('mm-qa-crash', '/settings'));
  await p.locator('aside nav a:has-text("设置")').click(); await settle(p, 600);
  await p.evaluate(() => localStorage.removeItem('mm-qa-crash'));
  await p.locator('[data-testid=error-boundary] button:has-text("返回概览")').click(); await settle(p, 800);
  check('crash: 「返回概览」跳转到概览', (await p.evaluate(() => location.pathname)) === '/dashboard' && (await p.locator('[data-testid=error-boundary]').count()) === 0);
  await c.close();
}

// ---------------------------------------------------------------------------
async function batchSuite() {
  // 偶数 id 成功、id%3==0 失败、id==4 缓存回退；每个请求 1500ms（足够长，保证「取消」发生在批次进行中——700ms 时 11 个账户约 2.1s 跑完，与点击取消竞争）
  let inflight = 0, maxInflight = 0;
  const handler = async r => {
    const { account_id } = bodyOf(r);
    inflight++; maxInflight = Math.max(maxInflight, inflight);
    await delay(1500);
    inflight--;
    if (account_id % 3 === 0) return r.fulfill({ json: { code: 500, data: null, message: `所有通道均失败: IMAP: AUTHENTICATE failed (${account_id})` } }).catch(() => {});
    if (account_id === 4) return r.fulfill({ json: { code: 200, data: { channel: 'cache', cached: true, errors: { graph: 'AADSTS' }, mails: [{ id: 20, account_id: 4 }] } } }).catch(() => {});
    return okFetch(r, { wait: 0 }).catch(() => {});
  };
  const { c, p } = await newPage({ fetchHandler: handler });

  // A. 账户页：选中 3 个 → 收取选中 (3)
  await p.goto(BASE + '/accounts'); await settle(p, 1500);
  const boxes = p.locator('main tbody tr td:first-child button, main tbody tr td:first-child [role=checkbox]');
  for (let i = 0; i < 3; i++) await boxes.nth(i).click();
  await settle(p, 400);
  await p.locator('[data-testid=batch-fetch-selected]').click();
  await settle(p, 300);
  const panel = p.locator('[data-testid=batch-panel]');
  check('batch(selected): 进度面板出现', await panel.isVisible());
  const firstCount = await p.locator('[data-testid=batch-count]').textContent();
  check('batch(selected): 显示 x / 3', /\/ 3/.test(firstCount || ''), firstCount);
  await p.locator('[data-testid=acc-batch-status]').first().waitFor({ timeout: 2000 }).then(() => check('batch(selected): 账户行显示收取状态徽标', true), () => check('batch(selected): 账户行显示收取状态徽标', false));
  await p.waitForFunction(() => /3 \/ 3/.test(document.querySelector('[data-testid=batch-count]')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
  await settle(p, 500);
  const txt = await panel.innerText();
  check('batch(selected): 完成并显示成功/失败计数', /收取完成/.test(txt) && /成功 \d/.test(txt) && /失败 \d/.test(txt), txt.replace(/\s+/g, ' ').slice(0, 160));
  await p.locator('[data-testid=batch-panel] button[aria-label="展开详情"]').click(); await settle(p, 400);
  const rows = await p.locator('[data-testid=batch-list] li').count();
  check('batch(selected): 每个账户一行结果（含通道）', rows === 3 && (await p.locator('[data-testid=batch-list] li').filter({ hasText: /Graph|IMAP|Cache|AUTHENTICATE|封/ }).count()) === 3, `rows=${rows}`);
  await p.screenshot({ path: `${OUT}/batch-selected-done.png` });
  await p.locator('[data-testid=batch-panel] button:has-text("完成")').click(); await settle(p, 500);

  // B. 收取全部（11+ 个账户，确认框）→ 跨页面 → 全部取消
  maxInflight = 0;
  await p.locator('main button:has-text("取消选择"), main button[aria-label="取消选择"]').first().click().catch(() => {});
  await settle(p, 400);
  await p.locator('[data-testid=batch-fetch-all]').click(); await settle(p, 500);
  if (await p.locator('[role=dialog] button:has-text("开始收取")').count()) { await p.locator('[role=dialog] button:has-text("开始收取")').click(); await settle(p, 400); }
  await settle(p, 900);
  const mid = await p.locator('[data-testid=batch-count]').textContent();
  check('batch(all): 运行中显示进度 x / y', /\d+ \/ \d+ 个账户/.test(mid || ''), mid);
  // 跨页面：面板保持
  await p.locator('aside nav a:has-text("邮件")').click(); await settle(p, 700);
  check('batch(all): 切换到邮件页后面板仍在', await panel.isVisible());
  const accBadges = await p.locator('main aside [data-testid=acc-batch-status]').count();
  check('batch(all): 邮件页账户列表显示收取状态', accBadges > 0, `badges=${accBadges}`);
  await p.locator('[data-testid=batch-cancel]').click(); await settle(p, 900);
  const after = await panel.innerText();
  check('batch(all): 取消后停止并显示已取消数量', /收取完成/.test(after) && /取消 \d+/.test(after), after.replace(/\s+/g, ' ').slice(0, 160));
  check('batch(all): 并发受限（≤ 4）', maxInflight > 1 && maxInflight <= 4, `maxInflight=${maxInflight}`);
  await p.screenshot({ path: `${OUT}/batch-cancelled.png` });
  await p.locator('[data-testid=batch-panel] button[aria-label="关闭"]').click(); await settle(p, 500);

  // C. 邮件页（v2.5）：列表头部分体按钮只管当前账户（菜单：收取收件箱和垃圾箱），批量入口只在账户栏「收取全部」
  await p.goto(BASE + '/mail/1'); await settle(p, 1400);
  await p.locator('[data-testid=fetch-menu-button]').click(); await settle(p, 300);
  const menuTexts = await p.locator('[role=menu] [role=menuitem]').allInnerTexts();
  check('split button: 菜单只含当前账户的选项（收取收件箱和垃圾箱），没有批量项', menuTexts.length === 1 && /收取收件箱和垃圾箱/.test(menuTexts[0]), JSON.stringify(menuTexts));
  await p.keyboard.press('Escape'); await settle(p, 300);
  await p.locator('[data-testid=fetch-all-accounts]').click(); await settle(p, 600);
  if (await p.locator('[role=dialog] button:has-text("开始收取")').count()) { await p.locator('[role=dialog] button:has-text("开始收取")').click(); await settle(p, 400); }
  check('账户栏「收取全部」启动批量收取', await panel.isVisible());
  await p.waitForFunction(() => /收取完成/.test(document.querySelector('[data-testid=batch-panel]')?.textContent || ''), null, { timeout: 20000 }).catch(() => {});
  check('账户栏「收取全部」批量收取跑完', /收取完成/.test(await panel.innerText()));
  // Token 批量刷新仍可用（不调用真实接口：拦截）
  await p.route('**/api/accounts/refresh-tokens', r => r.fulfill({ json: { code: 200, data: { total: 2, success: 1, failed: 1, results: [] } } }));
  await p.goto(BASE + '/accounts'); await settle(p, 1300);
  await boxes.nth(0).click(); await boxes.nth(1).click(); await settle(p, 300);
  await p.locator('main button:has-text("刷新 Token")').click(); await settle(p, 900);
  check('批量 Token 刷新仍可用', (await p.locator('text=Token 刷新：成功 1 / 失败 1').count()) > 0);
  await navEverywhere(p, 'batch(after)');
  await c.close();
}


// ---------------------------------------------------------------------------
async function stackSuite() {
  // 叠加对话框：编辑账户对话框 → 删除标签确认框（两层）→ 逐层关闭
  const { c, p } = await newPage();
  await p.goto(BASE + '/accounts'); await settle(p, 1400);
  await p.locator('main tbody tr').first().locator('button[title="编辑"]').click({ force: true }); await settle(p, 600);
  const tagName = `qa-tag-${Date.now() % 100000}`;
  const tagInput = p.locator('[role=dialog] input[placeholder="新标签"]');
  await tagInput.fill(tagName); await tagInput.press('Enter'); await settle(p, 700);
  const delTag = () => p.locator(`[role=dialog] span:has-text("${tagName}") button[title="删除标签"]`);
  check('stack: 编辑对话框内已创建测试标签', (await delTag().count()) === 1);
  // 第二层：确认框 → 取消，编辑框仍在
  await delTag().click(); await settle(p, 500);
  check('stack: 确认框叠加在编辑框之上（2 个 dialog）', (await unlocked(p)).dialogs === 2, JSON.stringify(await unlocked(p)));
  await p.locator('[role=dialog] button:has-text("取消")').last().click(); await settle(p, 600);
  let u = await unlocked(p);
  check('stack: 取消确认框后只剩编辑框且仍可交互', u.dialogs === 1 && (await tagInput.isEditable()), JSON.stringify(u));
  // Esc 只关闭最上层
  await delTag().click(); await settle(p, 500);
  await p.keyboard.press('Escape'); await settle(p, 600);
  check('stack: Esc 只关闭最上层确认框', (await unlocked(p)).dialogs === 1);
  // 确认删除 → 编辑框仍在 → 关闭编辑框 → body 解锁 → 导航
  await delTag().click(); await settle(p, 500);
  await p.locator('[role=dialog] button:has-text("删除")').last().click(); await settle(p, 700);
  check('stack: 确认删除后标签消失且编辑框仍在', (await delTag().count()) === 0 && (await unlocked(p)).dialogs === 1);
  await p.keyboard.press('Escape'); await settle(p, 700);
  u = await unlocked(p);
  check('stack: 全部关闭后 body 无残留锁', u.dialogs === 0 && u.pe !== 'none' && !u.locked && u.hidden === 0, JSON.stringify(u));
  // 关闭最后一层的同一 tick 内点击导航
  await p.locator('main button:has-text("新增账户")').click(); await settle(p, 500);
  await p.evaluate(() => {
    const close = document.querySelector('[role=dialog] button[aria-label="关闭"]');
    const link = [...document.querySelectorAll('aside nav a')].find(a => a.textContent.includes('代理'));
    close.click(); link.click();
  });
  await settle(p, 800);
  u = await unlocked(p);
  check('stack: 关闭与导航在同一 tick 内 → 到达代理页且无残留锁', (await p.evaluate(() => location.pathname)) === '/proxy' && u.dialogs === 0 && u.pe !== 'none' && !u.locked, JSON.stringify(u));
  await navEverywhere(p, 'stack(after)');
  await c.close();
}

// ---------------------------------------------------------------------------
const API_CASES = {
  'HTTP 500': r => r.fulfill({ status: 500, contentType: 'text/html', body: '<h1>500</h1>' }),
  '网络失败': r => r.abort('failed'),
  'data=null': r => r.fulfill({ json: { code: 200, data: null } }),
  '畸形结构': r => r.fulfill({ json: { code: 200, data: { list: 'nope', total: 'x', items: { a: 1 }, accounts: null } } }),
  '数组元素畸形': r => r.fulfill({ json: { code: 200, data: { list: [null, 'x', { id: 'a', email: null, status: 7 }, { id: 99 }], total: 4 } } }),
};

async function apiSuite() {
  // 除登录/健康检查/日志上报外，所有 GET /api 返回异常 → 依次访问每个页面：不白屏、不出现错误边界、无 pageerror
  for (const [name, handler] of Object.entries(API_CASES)) {
    const { c, p } = await newPage();
    await c.route(/\/api\/(?!client-log|auth|health)/, (r) => r.request().method() === 'GET' ? handler(r) : r.continue());
    p.expectedConsole.push(/status of 500|Failed to fetch/);
    await p.goto(BASE + '/dashboard'); await settle(p, 1300);
    await navEverywhere(p, `api(${name})`);
    await p.goto(BASE + '/mail/1'); await settle(p, 1000);
    const s = await p.evaluate(() => ({ text: (document.querySelector('main')?.innerText || '').trim().length, boundary: !!document.querySelector('[data-testid=error-boundary]') }));
    check(`api(${name}): 直接打开 /mail/1 非空白`, s.text > 20 && !s.boundary, JSON.stringify(s));
    await c.close();
  }
}

const suites = { import: importSuite, stack: stackSuite, fetch: fetchSuite, api: apiSuite, crash: crashSuite, batch: batchSuite };
for (const [k, fn] of Object.entries(suites)) {
  if (ONLY.length && !ONLY.includes(k)) continue;
  console.log(`\n== ${k}`);
  try { await fn(); } catch (e) { check(`${k} suite threw`, false, e.message.split('\n')[0]); }
}

const uniqErrors = [...new Set(errors)];
check('无 pageerror / 非预期 console.error', uniqErrors.length === 0, uniqErrors.slice(0, 8).join('\n      '));
await browser.close();
console.log(`\n${failures ? 'FAILED' : 'ALL PASSED'} (${failures} failures)`);
process.exit(failures ? 1 : 0);
