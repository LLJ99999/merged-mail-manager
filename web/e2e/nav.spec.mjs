/**
 * 导航 / 返回 / 转场 QA 脚本（Playwright，非 CI）。
 *
 *   1. 构建前端并启动带演示数据的后端：
 *        cd server && DB_PATH=./data/demo.db npx tsx scripts/seed-demo.ts
 *        DB_PATH=./data/demo.db PORT=3917 npm start
 *   2. 在任意装有 playwright 的目录运行（npm i -D playwright && npx playwright install chromium）：
 *        BASE=http://localhost:3917 OUT=./e2e-out node web/e2e/nav.spec.mjs
 *
 * 输出：OUT 目录下的截图（转场中 100ms / 300ms 与稳定后），控制台打印每一项检查的 PASS/FAIL、
 * 页面报错与 console error/warning，最后以失败数作为退出码。
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:3917';
const OUT = process.env.OUT || './e2e-out';
const ONLY = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });

const ROUTES = [
  { path: '/dashboard', nav: '概览', title: '概览' },
  { path: '/mail', nav: '邮件', title: '邮箱' },
  { path: '/accounts', nav: '账户', title: '账户' },
  { path: '/proxy', nav: '代理', title: '代理' },
  { path: '/settings', nav: '设置', title: '设置' },
];
const titleOf = path => ROUTES.find(r => path.startsWith(r.path))?.title;

let failures = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

const browser = await chromium.launch();
const logs = [];

async function newPage(viewport, { mobile = false, appearance, reducedMotion } = {}) {
  const c = await browser.newContext({
    viewport, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, reducedMotion: reducedMotion || 'no-preference',
  });
  await c.addInitScript(a => {
    if (!sessionStorage.getItem('qa-init')) {
      localStorage.clear();
      localStorage.setItem('mm-appearance', JSON.stringify(a));
      sessionStorage.setItem('qa-init', '1');
    }
  }, appearance || { mode: 'light', seed: '#4285F4', variant: 'tonal', glass: false });
  // 只允许访问本地服务
  await c.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, r => r.abort());
  const p = await c.newPage();
  const tag = `${viewport.width}x${viewport.height}`;
  p.on('pageerror', e => logs.push(`[${tag}] PAGEERROR ${e.message}`));
  p.on('console', m => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${tag}] ${m.type()} ${m.text()}`);
  });
  return { c, p };
}

/** 页面状态：main 中的页面容器数量、透明度、标题、滚动位置、打开的对话框 */
async function state(p) {
  return p.evaluate(() => {
    const main = document.querySelector('main');
    if (!main) return { path: location.pathname + location.search, pages: 0, ops: [], titles: [], scroll: 0, dialogs: 0, indicator: [] };
    const kids = [...main.children];
    const visible = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; };
    return {
      path: location.pathname + location.search,
      pages: kids.length,
      ops: kids.map(k => Number(getComputedStyle(k).opacity)),
      // v2.4：窗口 < 1440 时邮件页账户栏默认收起，标题「邮箱」隐藏 —— 收起状态（显示「展开账户列表」按钮）同样算作邮件页已渲染
      titles: [...[...main.querySelectorAll('h1, aside h2')].filter(visible).map(h => h.textContent.trim()), ...(main.querySelector('aside button[title="展开账户列表"]') ? ['邮箱'] : [])],
      scroll: Math.round(main.scrollTop + document.scrollingElement.scrollTop),
      dialogs: document.querySelectorAll('[role=dialog], [role=alertdialog]').length,
      // 导航指示器所在的导航项（桌面 rail 或移动端底栏，取可见的那个）
      indicator: [...document.querySelectorAll('aside nav a, nav.fixed a')].filter(a => visible(a) && a.querySelector('.bg-secondary-container')).map(a => a.textContent.trim()),
    };
  });
}

async function settle(p, ms = 900) { await p.waitForTimeout(ms); }

async function expectRoute(p, label, path) {
  const s = await state(p);
  const want = titleOf(path);
  const okPath = s.path.startsWith(path);
  const okPage = s.pages === 1 && s.ops[0] > 0.99;
  const okTitle = want ? s.titles.includes(want) : true;
  const navLabel = ROUTES.find(r => path.startsWith(r.path))?.nav;
  const okInd = s.indicator.length === 1 && s.indicator[0] === navLabel;
  check(`${label}: ${path}`, okPath && okPage && okTitle && okInd,
    `url=${s.path} pages=${s.pages} opacity=${s.ops.join(',')} titles=${JSON.stringify(s.titles)} indicator=${JSON.stringify(s.indicator)}`);
  return s;
}

async function navClick(p, label, mobile) {
  const scope = mobile ? 'nav.fixed' : 'aside nav';
  await p.locator(`${scope} a:has-text("${label}")`).first().click();
}

const shot = (p, name) => p.screenshot({ path: `${OUT}/${name}.png` });

// ---------------------------------------------------------------------------
async function desktop(viewport) {
  const tag = `d${viewport.width}`;
  const { c, p } = await newPage(viewport);
  await p.goto(BASE + '/dashboard'); await settle(p, 1500);

  // 1) 逐个点击导航，抓转场中/稳定后截图
  for (const r of ROUTES) {
    await navClick(p, r.nav);
    await p.waitForTimeout(100); await shot(p, `${tag}-nav-${r.nav}-100ms`);
    const mid = await state(p);
    check(`${tag} mid-transition ≤2 page containers (${r.path})`, mid.pages <= 2, `pages=${mid.pages}`);
    await p.waitForTimeout(200); await shot(p, `${tag}-nav-${r.nav}-300ms`);
    await settle(p);
    await shot(p, `${tag}-nav-${r.nav}-settled`);
    await expectRoute(p, `${tag} nav click`, r.path);
  }

  // 2) 滚动位置：在账户页向下滚动后切换到设置，应回到顶部
  await navClick(p, '账户'); await settle(p);
  await p.locator('main').evaluate(el => el.scrollTo(0, 400));
  await navClick(p, '设置'); await settle(p);
  let s = await state(p);
  check(`${tag} scroll reset on navigation`, s.scroll === 0, `scrollTop=${s.scroll}`);

  // 3) 快速连点
  for (const label of ['概览', '邮件', '账户', '代理', '设置', '邮件', '概览', '账户']) {
    await navClick(p, label); await p.waitForTimeout(40);
  }
  await settle(p, 1200);
  await shot(p, `${tag}-rapid-settled`);
  await expectRoute(p, `${tag} rapid clicks end on`, '/accounts');

  // 4) 后退/前进遍历全部路由
  await p.goto(BASE + '/dashboard'); await settle(p, 1200);
  const seq = ['/mail', '/accounts', '/proxy', '/settings'];
  for (const path of seq) { await navClick(p, ROUTES.find(r => r.path === path).nav); await settle(p, 600); }
  for (const path of ['/proxy', '/accounts', '/mail', '/dashboard']) {
    await p.goBack(); await p.waitForTimeout(120); await shot(p, `${tag}-back-${path.slice(1)}-120ms`); await settle(p);
    await expectRoute(p, `${tag} back`, path);
  }
  for (const path of ['/mail', '/accounts']) {
    await p.goForward(); await settle(p);
    await expectRoute(p, `${tag} forward`, path);
  }
  // 快速连续后退
  await p.goBack(); await p.goBack(); await p.waitForTimeout(30); await p.goForward();
  await settle(p, 1200);
  await expectRoute(p, `${tag} rapid back/back/forward`, '/mail');

  // 5) 邮件：账户 → 邮件 → 返回
  await p.goto(BASE + '/mail'); await settle(p, 1400);
  await p.locator('main aside button:has-text("@")').first().click(); await settle(p, 1000);
  const afterAccount = (await state(p)).path;
  check(`${tag} selecting an account updates URL`, /account=\d+|\/mail\/\d+/.test(afterAccount), afterAccount);
  await p.locator('main section button:has(p)').first().click();
  await p.waitForTimeout(100); await shot(p, `${tag}-mail-open-100ms`);
  await p.waitForTimeout(200); await shot(p, `${tag}-mail-open-300ms`);
  await settle(p);
  await shot(p, `${tag}-mail-open-settled`);
  const afterMail = (await state(p)).path;
  check(`${tag} selecting a mail updates URL`, afterMail !== afterAccount, afterMail);
  const readerOpen = await p.locator('main article').count();
  check(`${tag} reader shows article`, readerOpen === 1, `articles=${readerOpen}`);
  // 切到垃圾箱再回来
  await p.locator('main section button:has-text("垃圾箱")').click(); await settle(p);
  const junk = (await state(p)).path;
  check(`${tag} junk folder in URL`, /Junk|junk/.test(junk), junk);
  await p.goBack(); await settle(p);
  check(`${tag} back from junk restores mail`, (await state(p)).path === afterMail && (await p.locator('main article').count()) === 1, (await state(p)).path);
  // 刷新保持选择
  await p.reload(); await settle(p, 1800);
  check(`${tag} reload keeps selected mail`, (await p.locator('main article').count()) === 1, (await state(p)).path);
  await shot(p, `${tag}-mail-reload`);
  await p.goBack(); await settle(p);
  check(`${tag} back from mail → account list`, (await state(p)).path === afterAccount && (await p.locator('main article').count()) === 0, (await state(p)).path);
  await p.goForward(); await settle(p);
  check(`${tag} forward → mail again`, (await p.locator('main article').count()) === 1, (await state(p)).path);
  // 离开邮件页再返回：选择应恢复
  await navClick(p, '设置'); await settle(p);
  await p.goBack(); await settle(p, 1200);
  check(`${tag} back to /mail restores selection`, (await p.locator('main article').count()) === 1, (await state(p)).path);
  // 点导航「邮件」回到上次的账户
  await navClick(p, '概览'); await settle(p);
  await navClick(p, '邮件'); await settle(p, 1200);
  s = await state(p);
  check(`${tag} nav “邮件” remembers last account`, /\d/.test(s.path), s.path);

  // 6) 折叠账户列表
  if (viewport.width >= 1024) {
    const btn = p.locator('main aside button[aria-label="折叠"]');
    await btn.click(); await p.waitForTimeout(150); await shot(p, `${tag}-collapse-150ms`); await settle(p);
    const w1 = await p.locator('main aside').first().evaluate(el => el.getBoundingClientRect().width);
    await shot(p, `${tag}-collapsed`);
    await btn.click(); await settle(p);
    const w2 = await p.locator('main aside').first().evaluate(el => el.getBoundingClientRect().width);
    check(`${tag} collapse toggles width`, Math.abs(w1 - w2) > 100, `${w1} ↔ ${w2}`);
  }

  // 7) 对话框：导入 → 后退关闭；确认框 → Esc 关闭
  await p.goto(BASE + '/accounts'); await settle(p, 1400);
  await navClick(p, '概览'); await settle(p);
  await p.locator('aside button[aria-label="导入"]').click(); await settle(p, 600);
  check(`${tag} import dialog opens`, (await state(p)).dialogs === 1);
  await shot(p, `${tag}-import`);
  await p.goBack(); await settle(p);
  s = await state(p);
  check(`${tag} back closes import dialog`, s.dialogs === 0, `dialogs=${s.dialogs} url=${s.path}`);
  await shot(p, `${tag}-import-after-back`);
  if (s.dialogs) { await p.keyboard.press('Escape'); await settle(p, 600); }
  await p.locator('aside button[aria-label="导入"]').click(); await settle(p, 600);
  await p.keyboard.press('Escape'); await settle(p, 600);
  check(`${tag} Esc closes import dialog`, (await state(p)).dialogs === 0);
  await p.goto(BASE + '/dashboard'); await settle(p, 1500);
  const tokBtn = p.locator('main button:has-text("刷新全部")').first();
  if (await tokBtn.count()) {
    await tokBtn.click(); await settle(p, 500);
    check(`${tag} confirm dialog opens`, (await state(p)).dialogs === 1);
    await shot(p, `${tag}-confirm`);
    await p.locator('[role=dialog] button:has-text("取消")').click(); await settle(p, 500);
    check(`${tag} confirm dialog closes`, (await state(p)).dialogs === 0);
    await tokBtn.click(); await settle(p, 500);
    await p.goBack(); await settle(p);
    check(`${tag} back closes confirm dialog`, (await state(p)).dialogs === 0, (await state(p)).path);
    if ((await state(p)).dialogs) { await p.keyboard.press('Escape'); await settle(p, 600); }
  }

  // 8) 主题与玻璃
  await p.goto(BASE + '/settings'); await settle(p, 1200);
  await p.locator('aside button[aria-label="切换主题"]').click(); await settle(p, 800);
  check(`${tag} theme toggle → dark`, await p.evaluate(() => document.documentElement.classList.contains('dark')));
  await shot(p, `${tag}-dark`);
  await p.locator('button[role=switch][aria-label="Liquid Glass"]').click(); await settle(p, 600);
  check(`${tag} glass on`, await p.evaluate(() => document.documentElement.classList.contains('glass')));
  await navClick(p, '邮件'); await settle(p, 1200); await shot(p, `${tag}-glass-mail`);
  await navClick(p, '概览'); await settle(p, 1200); await shot(p, `${tag}-glass-dash`);
  await expectRoute(p, `${tag} glass dashboard`, '/dashboard');

  // 9) 直接 URL 加载 + 刷新
  for (const r of ROUTES) {
    await p.goto(BASE + r.path); await settle(p, 1200);
    await expectRoute(p, `${tag} direct load`, r.path);
    await p.reload(); await settle(p, 1200);
    await expectRoute(p, `${tag} reload`, r.path);
  }
  const res = await p.request.get(BASE + '/');
  check(`index.html not cached long-term`, !/max-age=31536000/.test(res.headers()['cache-control'] || ''), res.headers()['cache-control']);
  await c.close();
}

// ---------------------------------------------------------------------------
async function mobile() {
  const tag = 'm390';
  const { c, p } = await newPage({ width: 390, height: 844 }, { mobile: true, appearance: { mode: 'light', seed: '#C2185B', variant: 'tonal' } });
  await p.goto(BASE + '/dashboard'); await settle(p, 1500);
  for (const r of ROUTES) {
    await navClick(p, r.nav, true);
    await p.waitForTimeout(100); await shot(p, `${tag}-nav-${r.nav}-100ms`);
    await settle(p); await shot(p, `${tag}-nav-${r.nav}-settled`);
    const s = await state(p);
    check(`${tag} nav ${r.path}`, s.path.startsWith(r.path) && s.pages === 1 && s.ops[0] > 0.99, `url=${s.path} pages=${s.pages} op=${s.ops}`);
  }
  // 邮件三栏 → 单栏：账户 → 列表 → 阅读，系统返回逐级回退
  await p.goto(BASE + '/dashboard'); await settle(p, 1200);
  await navClick(p, '邮件', true); await settle(p, 1200);
  await p.locator('main aside button:has-text("@")').first().click(); await settle(p, 900);
  await shot(p, `${tag}-mail-list`);
  const listVisible = await p.locator('main section').first().isVisible();
  check(`${tag} list pane shown after picking account`, listVisible);
  await p.locator('main section button:has(p)').first().click(); await p.waitForTimeout(150);
  await shot(p, `${tag}-mail-reader-150ms`); await settle(p);
  await shot(p, `${tag}-mail-reader`);
  check(`${tag} reader pane shown`, await p.locator('main article').isVisible());
  await p.goBack(); await settle(p);
  await shot(p, `${tag}-mail-back1`);
  check(`${tag} back: reader → list (stays on /mail)`, (await state(p)).path.startsWith('/mail') && (await p.locator('main article').count()) === 0 && await p.locator('main section').first().isVisible(), (await state(p)).path);
  await p.goBack(); await settle(p);
  await shot(p, `${tag}-mail-back2`);
  check(`${tag} back: list → accounts (stays on /mail)`, (await state(p)).path.startsWith('/mail') && await p.locator('main aside').first().isVisible(), (await state(p)).path);
  await p.goBack(); await settle(p);
  check(`${tag} back: accounts → dashboard`, (await state(p)).path.startsWith('/dashboard'), (await state(p)).path);
  // 应用内返回按钮
  await p.goForward(); await settle(p); await p.goForward(); await settle(p); await p.goForward(); await settle(p, 1200);
  check(`${tag} forward ×3 → reader`, (await p.locator('main article').count()) === 1, (await state(p)).path);
  await p.locator('main article button[aria-label="返回列表"]').click(); await settle(p);
  check(`${tag} in-app back → list`, (await p.locator('main article').count()) === 0 && await p.locator('main section').first().isVisible(), (await state(p)).path);
  await p.locator('main section button[aria-label="返回"]').click(); await settle(p);
  check(`${tag} in-app back → accounts`, await p.locator('main aside').first().isVisible(), (await state(p)).path);
  // 底部面板
  await navClick(p, '概览', true); await settle(p, 1200);
  await p.locator('button:has-text("导入")').last().click(); await settle(p, 800);
  await shot(p, `${tag}-sheet`);
  check(`${tag} bottom sheet opens`, (await state(p)).dialogs === 1);
  await p.goBack(); await settle(p, 800);
  check(`${tag} back closes sheet`, (await state(p)).dialogs === 0, (await state(p)).path);
  if ((await state(p)).dialogs) { await p.keyboard.press('Escape'); await settle(p, 600); }
  // FAB 位置不跳
  const fab1 = await p.locator('button.fixed').first().boundingBox();
  await navClick(p, '账户', true); await p.waitForTimeout(120);
  const fab2 = await p.locator('button.fixed').first().boundingBox();
  await settle(p);
  const fab3 = await p.locator('button.fixed').first().boundingBox();
  check(`${tag} FAB stays put across navigation`, fab1 && fab3 && Math.abs(fab1.y - fab3.y) < 2 && Math.abs((fab1.x + fab1.width) - (fab3.x + fab3.width)) < 2 && (!fab2 || Math.abs(fab1.y - fab2.y) < 2), JSON.stringify([fab1, fab2, fab3]));
  await c.close();
}

async function edges() {
  const tag = 'edge';
  const { c, p } = await newPage({ width: 1440, height: 900 });
  // 旧版链接兼容
  await p.goto(BASE + '/mail?account=11&box=Junk'); await settle(p, 1400);
  let s = await state(p);
  check(`${tag} legacy /mail?account=11&box=Junk redirects`, s.path === '/mail/11?box=Junk', s.path);
  // 失效的邮件 / 账户
  await p.goto(BASE + '/mail/11/999999'); await settle(p, 1800);
  s = await state(p);
  check(`${tag} unknown mail id → list`, s.path === '/mail/11', s.path);
  await p.goto(BASE + '/mail/999999'); await settle(p, 1800);
  s = await state(p);
  check(`${tag} unknown account id → /mail`, s.path === '/mail', s.path);
  // 概览「最近邮件」直达邮件
  await p.goto(BASE + '/dashboard'); await settle(p, 1600);
  const recent = p.locator('main li button:has(span.text-title-s)').first();
  if (await recent.count()) {
    await recent.click(); await settle(p, 1400);
    s = await state(p);
    check(`${tag} dashboard recent mail opens reader`, /^\/mail\/\d+\/\d+/.test(s.path) && (await p.locator('main article').count()) === 1, s.path);
    await p.goBack(); await settle(p);
    check(`${tag} back → dashboard`, (await state(p)).path === '/dashboard', (await state(p)).path);
  }
  // 桌面上连续切换邮件：替换记录，后退回到列表
  await p.goto(BASE + '/mail/11'); await settle(p, 1400);
  const rows = p.locator('main section button:has(p)');
  await rows.nth(0).click(); await settle(p, 500);
  await rows.nth(1).click(); await settle(p, 500);
  await rows.nth(2).click(); await settle(p, 700);
  const sel = await p.locator('main article h2').first().textContent();
  const rowSubj = await rows.nth(2).locator('p').nth(0).textContent();
  check(`${tag} reader shows clicked mail`, !!sel && !!rowSubj && rowSubj.includes(sel.slice(0, 12)), `${sel} | ${rowSubj}`);
  await p.goBack(); await settle(p);
  check(`${tag} back after switching mails → list`, (await state(p)).path === '/mail/11', (await state(p)).path);
  // 快速切换账户：最终列表属于最后点击的账户
  const accs = p.locator('main aside button:has-text("@")');
  for (const i of [1, 2, 3, 0, 4, 6]) { await accs.nth(i).click(); await p.waitForTimeout(30); }
  await settle(p, 1500);
  const lastEmail = (await accs.nth(6).locator('p').first().textContent()).trim();
  const header = (await p.locator('main section p.text-title-m').first().textContent()).trim();
  check(`${tag} rapid account switching ends on last account`, header === lastEmail, `${header} vs ${lastEmail}`);
  await shot(p, `${tag}-rapid-accounts`);
  await c.close();
}

async function reduced() {
  const { c, p } = await newPage({ width: 1280, height: 720 }, { reducedMotion: 'reduce' });
  await p.goto(BASE + '/dashboard'); await settle(p, 1200);
  await navClick(p, '账户'); await p.waitForTimeout(60);
  const s = await state(p);
  check('reduced-motion: page swaps without lingering transition', s.pages === 1, `pages=${s.pages} op=${s.ops}`);
  await settle(p);
  await expectRoute(p, 'reduced-motion nav', '/accounts');
  await c.close();
}

const want = k => !ONLY.length || ONLY.includes(k);
try {
  if (want('d1440')) await desktop({ width: 1440, height: 900 });
  if (want('d1280')) await desktop({ width: 1280, height: 720 });
  if (want('mobile')) await mobile();
  if (want('edges')) await edges();
  if (want('reduced')) await reduced();
} catch (e) {
  failures++;
  console.log('FAIL  script error —', e.message.split('\n')[0]);
}
await browser.close();

const noisy = logs.filter(l => !/Failed to load resource: net::ERR_FAILED/.test(l));
console.log(`\n== console errors/warnings (${noisy.length})`);
for (const l of [...new Set(noisy)]) console.log(l);
console.log(`\n== ${results.filter(r => r.ok).length} passed, ${failures} failed`);
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ results, logs: noisy }, null, 2));
process.exit(failures ? 1 : 0);
