/**
 * 遮罩 / 对话框的全局守护。
 *
 * 1. dialogHistory —— 对话框与浏览器历史的唯一协调者（「返回」键关闭对话框）。
 *    - 每个打开的对话框压入一条同地址的历史记录（state.__dialog = marker），按打开顺序组成栈；
 *    - popstate 时，凡是 marker 已不在当前历史位置之下的对话框都被关闭（支持多层叠加：
 *      返回一次只关闭最上层）；
 *    - 以按钮 / Esc / 代码关闭时，只有当前历史位置仍是这条对话框记录时才 history.back() 退掉它；
 *      如果同一时刻已经 navigate() 到别的页面（关闭 + 跳转在同一 tick），就不再后退，避免把用户
 *      刚跳转到的页面又退回去；
 *    - history.back() 是异步的：若在它完成之前又发生了 pushState（关闭后 await 再 navigate），
 *      会把这次 popstate 吞掉并 forward() 回到新页面。
 *
 * 2. releaseStaleLocks —— 没有任何打开的对话框/弹层时，清除 Radix 残留在 <body> 上的
 *    pointer-events:none、react-remove-scroll 的 data-scroll-locked、aria-hidden 与 inert。
 *    由 MutationObserver 与路由变化触发，是「导入后整个页面无法点击」这类问题的最后一道保险。
 */

type Entry = { marker: string; close: () => void; pushed: boolean; timer: number };

const stack: Entry[] = [];
/** 由我们自己发起、尚未收到 popstate 的 history.back() 次数 */
let pendingBacks = 0;
/** pendingBacks > 0 期间发生的 pushState（说明后退会把新页面退掉） */
let pushedDuringBack = false;
let installed = false;
let backResetTimer = 0;

const markerOf = (state: unknown) => (state && typeof state === 'object' ? (state as any).__dialog : undefined);

function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const origPush = window.history.pushState.bind(window.history);
  window.history.pushState = function (data: any, unused: string, url?: string | URL | null) {
    if (pendingBacks > 0 && !markerOf(data)) pushedDuringBack = true;
    return origPush(data, unused, url);
  };

  // 捕获阶段注册在 window 上，早于 react-router 的监听器
  window.addEventListener('popstate', e => {
    if (pendingBacks > 0) {
      pendingBacks--;
      if (pushedDuringBack) {
        // 我们的 back() 在 navigate() 之后才生效：吞掉这次 popstate，回到刚跳转到的页面
        pushedDuringBack = pendingBacks > 0;
        e.stopImmediatePropagation();
        window.history.forward();
        return;
      }
      if (pendingBacks === 0) pushedDuringBack = false;
    }
    const current = markerOf(e.state);
    const idx = current ? stack.findIndex(s => s.marker === current) : -1;
    // 当前位置之上的对话框（已被「返回」弹出）全部关闭，从最上层开始
    const toClose = stack.slice(idx + 1).filter(s => s.pushed).reverse();
    for (const s of toClose) {
      s.pushed = false;
      s.close();
    }
  }, true);

  const mo = new MutationObserver(() => scheduleRelease());
  const observe = () => mo.observe(document.body, { attributes: true, attributeFilter: ['style', 'data-scroll-locked', 'aria-hidden', 'inert'], childList: true });
  if (document.body) observe();
  else window.addEventListener('DOMContentLoaded', observe, { once: true });
}

export const dialogHistory = {
  /** 对话框打开时调用；返回值在对话框关闭（或卸载）时调用 */
  open(close: () => void): () => void {
    install();
    const entry: Entry = { marker: Math.random().toString(36).slice(2), close, pushed: false, timer: 0 };
    stack.push(entry);
    // 延后一拍：StrictMode 下立即卸载的 effect 不会留下多余记录
    entry.timer = window.setTimeout(() => {
      window.history.pushState({ ...(window.history.state || {}), __dialog: entry.marker }, '');
      entry.pushed = true;
    }, 0);
    return () => {
      window.clearTimeout(entry.timer);
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      if (entry.pushed && markerOf(window.history.state) === entry.marker) {
        entry.pushed = false;
        pendingBacks++;
        // 浏览器若取消了这次后退（没有 popstate），不要让计数一直挂着吞掉用户之后的「返回」
        window.clearTimeout(backResetTimer);
        backResetTimer = window.setTimeout(() => { pendingBacks = 0; pushedDuringBack = false; }, 1500);
        window.history.back();
      }
      entry.pushed = false;
      scheduleRelease();
    };
  },
  get depth() { return stack.length; },
};

const OPEN_OVERLAY = [
  '[role=dialog][data-state=open]:not([data-closing])',
  '[role=alertdialog][data-state=open]:not([data-closing])',
  '[data-radix-popper-content-wrapper]',
  '[role=menu][data-state=open]',
].join(',');

export function hasOpenOverlay() {
  return !!document.querySelector(OPEN_OVERLAY);
}

/** 没有打开的对话框时清除 body 上残留的交互/滚动锁；返回是否做了清理 */
export function releaseStaleLocks(): boolean {
  if (typeof document === 'undefined' || hasOpenOverlay()) return false;
  const body = document.body;
  let changed = false;
  if (body.style.pointerEvents === 'none') { body.style.removeProperty('pointer-events'); changed = true; }
  if (body.hasAttribute('data-scroll-locked')) { body.removeAttribute('data-scroll-locked'); changed = true; }
  document.querySelectorAll('[data-aria-hidden]').forEach(el => {
    el.removeAttribute('aria-hidden');
    el.removeAttribute('data-aria-hidden');
    changed = true;
  });
  for (const el of Array.from(body.children)) {
    if (el.hasAttribute('inert')) { el.removeAttribute('inert'); changed = true; }
  }
  return changed;
}

let releaseTimer = 0;
export function scheduleRelease(delay = 120) {
  if (typeof window === 'undefined') return;
  window.clearTimeout(releaseTimer);
  releaseTimer = window.setTimeout(releaseStaleLocks, delay);
}

install();
