import { create } from 'zustand';
import { toast } from 'sonner';
import { mailApi, isAbortError, isAuthError } from '../lib/api';
import type { Box } from '../lib/mailRoute';
import { CHANNELS } from '../lib/utils';
import { confirmDialog, useUi } from './ui';
import { useAccountStore } from './accounts';
import { useMailStore } from './mails';

/**
 * 收取引擎（v2.5）：所有「收取」——单个账户的当前文件夹、收件箱 + 垃圾箱、批量收取——都走这一个队列。
 *
 *  规则
 *  1. 任务 = 账户 + 文件夹（key = "id:INBOX"）。同一个 key 已在排队 / 进行中时，再次请求只会「加入」它，绝不重复请求。
 *  2. 固定并发 4；同一账户的两个文件夹不会同时进行（避免对同一邮箱开两个连接）。手动收取（single）插到队首。
 *  3. 每个任务一个 AbortController：可取消单个任务、某个账户的全部任务，或全部任务。
 *     （取消只是前端不再等待；服务端那一次收取仍会完成并写入缓存。）
 *  4. 任务结束后，只有当这个账户 + 文件夹仍是邮件页正在显示的列表时才重新读取缓存，绝不覆盖别的列表。
 *  5. 提示：一次手动收取（单个账户）结束时提示它自己的结果；批量收取（≥ 2 个账户）只在全部结束时提示一次汇总，
 *     其中每个账户都不再单独提示——即使它最初是手动发起、后来被批量收取「接管」的。
 *  6. 进度面板只在批量收取（≥ 2 个账户）时出现；批量运行中再发起批量 = 追加到同一批次。
 */

export type JobStatus = 'queued' | 'running' | 'ok' | 'cached' | 'error' | 'cancelled';
export const ACTIVE: JobStatus[] = ['queued', 'running'];
export const DONE: JobStatus[] = ['ok', 'cached', 'error', 'cancelled'];
export const FETCH_CONCURRENCY = 4;

export interface FetchJob {
  key: string;
  accountId: number;
  mailbox: Box;
  email: string;
  provider: string;
  status: JobStatus;
  /** 属于哪个批量批次（undefined = 单独的手动收取） */
  run?: number;
  channel?: string;
  count?: number;
  cached?: boolean;
  errors?: Record<string, string>;
  error?: string;
  /** 递增序号：排队顺序（手动收取取负数插到队首） */
  seq: number;
  finishedAt?: number;
}

export interface FetchTarget { id: number; email?: string; provider?: string }

export interface BulkRun {
  id: number;
  startedAt: number;
  finishedAt: number | null;
  panelOpen: boolean;
}

/** 某个账户在一个批次（或当前所有任务）中的聚合状态：用于账户行徽标与进度面板的每一行 */
export interface AccountProgress {
  accountId: number;
  email: string;
  provider: string;
  status: JobStatus;
  count: number;
  channel?: string;
  error?: string;
  mailboxes: Box[];
}

interface FetchQueueStore {
  jobs: Record<string, FetchJob>;
  run: BulkRun | null;
  /** 收取：targets × mailboxes。返回这次请求涉及的所有任务结束后的状态 */
  enqueue: (targets: FetchTarget[], mailboxes: Box[], opts?: { bulk?: boolean }) => Promise<FetchJob[]>;
  cancelJob: (key: string) => void;
  cancelAccount: (accountId: number) => void;
  cancelAll: () => void;
  /** 关闭进度面板：运行中只最小化；结束后清掉批次 */
  dismissRun: () => void;
  setPanelOpen: (v: boolean) => void;
}

export const jobKey = (accountId: number, mailbox: string) => `${accountId}:${mailbox}`;
const boxLabel = (b: string) => (b === 'Junk' ? '垃圾箱' : '收件箱');

/** 进度面板一行只有两行空间：去掉"收取失败：所有通道均失败 —"之类的固定前缀，留下真正的原因（完整内容见悬停提示） */
export function cleanFetchError(msg: string): string {
  return String(msg || '失败')
    .replace(/^(收取失败[:：]\s*|Failed to fetch (new )?mails?:\s*)/i, '')
    .replace(/^所有通道均失败\s*[—:：-]\s*/, '')
    .replace(/^超时:\s*/, '')
    .trim() || '失败';
}

const controllers = new Map<string, AbortController>();
/** 等待某个任务结束的回调（同一个 key 被多次请求时都会收到通知） */
const waiters = new Map<string, Array<(j: FetchJob) => void>>();
let seq = 0;
let runSeq = 0;
/** 每个 key 由最近一次覆盖它的手动请求「负责」提示；更早的请求被接管后不再提示（双击、先收取收件箱再收取两个文件夹等） */
const reporter = new Map<string, number>();
let reqSeq = 0;

/** 账户列表 / 概览：运行中节流刷新，空闲时立即刷新 */
let bumpTimer: number | undefined;
/** 自上次刷新以来有任务结束（账户的通道 / 状态 / 计数可能变了） */
let dirty = false;
function refreshAccounts(idle: boolean) {
  if (!dirty) return;
  const go = () => {
    bumpTimer = undefined;
    dirty = false;
    useUi.getState().bumpAccounts();
    useAccountStore.getState().refreshAccountsSilent().catch(() => { /* 静默 */ });
  };
  if (idle) { window.clearTimeout(bumpTimer); go(); }
  else if (bumpTimer === undefined) bumpTimer = window.setTimeout(go, 1500); // 节流：批量收取期间最多每 1.5 秒刷新一次
}

function aggregate(jobs: FetchJob[]): AccountProgress[] {
  const map = new Map<number, AccountProgress>();
  const rank: Record<JobStatus, number> = { running: 6, queued: 5, error: 4, cached: 3, ok: 2, cancelled: 1 };
  for (const j of jobs) {
    const a = map.get(j.accountId) || { accountId: j.accountId, email: j.email, provider: j.provider, status: j.status, count: 0, mailboxes: [] };
    a.mailboxes.push(j.mailbox);
    a.count += j.count || 0;
    if (rank[j.status] > rank[a.status]) a.status = j.status;
    // 部分成功（一个文件夹成功，另一个已取消）按成功算
    if (a.status === 'cancelled' && (j.status === 'ok' || j.status === 'cached')) a.status = j.status;
    if (j.channel && (!a.channel || a.channel === 'cache')) a.channel = j.channel;
    if (j.error) a.error = [a.error, a.mailboxes.length > 1 || j.mailbox === 'Junk' ? `${boxLabel(j.mailbox)}：${j.error}` : j.error].filter(Boolean).join('\n');
    map.set(j.accountId, a);
  }
  return [...map.values()];
}

export function runJobs(s: Pick<FetchQueueStore, 'jobs' | 'run'>): FetchJob[] {
  if (!s.run) return [];
  const id = s.run.id;
  return Object.values(s.jobs).filter(j => j.run === id).sort((a, b) => a.seq - b.seq);
}

/** 批次汇总（按账户） */
export function runSummary(s: Pick<FetchQueueStore, 'jobs' | 'run'>) {
  const accounts = aggregate(runJobs(s));
  const by = (st: JobStatus) => accounts.filter(a => a.status === st).length;
  const done = accounts.filter(a => DONE.includes(a.status)).length;
  return {
    accounts,
    total: accounts.length,
    done,
    ok: by('ok'),
    cached: by('cached'),
    failed: by('error'),
    cancelled: by('cancelled'),
    running: by('running'),
    mails: accounts.reduce((n, a) => n + a.count, 0),
    active: !!s.run && !s.run.finishedAt,
  };
}

export const useFetchQueue = create<FetchQueueStore>((set, get) => {
  const patch = (key: string, p: Partial<FetchJob>) => set(s => (s.jobs[key] ? { jobs: { ...s.jobs, [key]: { ...s.jobs[key], ...p } } } : s));

  function settle(key: string) {
    const j = get().jobs[key];
    if (!j) return;
    const ws = waiters.get(key) || [];
    waiters.delete(key);
    ws.forEach(w => w(j));
  }

  async function runJob(job: FetchJob) {
    const ctrl = new AbortController();
    controllers.set(job.key, ctrl);
    try {
      const r = await mailApi.fetch({ account_id: job.accountId, mailbox: job.mailbox }, ctrl.signal);
      const errs = Object.entries(r.errors || {}).filter(([, v]) => v);
      patch(job.key, {
        status: r.cached ? 'cached' : 'ok',
        channel: r.channel || (r.cached ? 'cache' : ''),
        count: r.mails.length,
        cached: r.cached,
        errors: r.errors,
        error: r.cached && errs.length ? errs.map(([k, v]) => (k === 'timeout' ? String(v) : `${k}: ${v}`)).join(' | ') : undefined,
        finishedAt: Date.now(),
      });
      // 规则 4：只刷新仍在显示的那个列表
      const ms = useMailStore.getState();
      if (ms.currentAccountId === job.accountId && ms.currentMailbox === job.mailbox) {
        ms.fetchCachedMails(job.accountId, job.mailbox).catch(() => { /* 列表保持原样 */ });
      }
    } catch (e) {
      if (isAbortError(e)) patch(job.key, { status: 'cancelled', finishedAt: Date.now() });
      else patch(job.key, { status: 'error', error: isAuthError(e) ? '未登录' : cleanFetchError((e as Error)?.message || String(e)), finishedAt: Date.now() });
    } finally {
      controllers.delete(job.key);
      dirty = true;
      settle(job.key);
      pump();
    }
  }

  /** 调度：补足到并发上限 */
  function pump() {
    const jobs = Object.values(get().jobs);
    let running = jobs.filter(j => j.status === 'running').length;
    const busyAccounts = new Set(jobs.filter(j => j.status === 'running').map(j => j.accountId));
    const queue = jobs.filter(j => j.status === 'queued').sort((a, b) => a.seq - b.seq);
    for (const j of queue) {
      if (running >= FETCH_CONCURRENCY) break;
      if (busyAccounts.has(j.accountId)) continue;
      running++;
      busyAccounts.add(j.accountId);
      patch(j.key, { status: 'running' });
      void runJob(get().jobs[j.key]);
    }
    refreshAccounts(!running && !queue.length);
    maybeFinishRun();
  }

  function maybeFinishRun() {
    const s = get();
    if (!s.run || s.run.finishedAt) return;
    const jobs = runJobs(s);
    if (jobs.some(j => ACTIVE.includes(j.status))) return;
    set({ run: { ...s.run, finishedAt: Date.now() } });
    const sum = runSummary(get());
    const msg = `收取完成：成功 ${sum.ok}${sum.cached ? ` · 缓存 ${sum.cached}` : ''}${sum.failed ? ` · 失败 ${sum.failed}` : ''}${sum.cancelled ? ` · 已取消 ${sum.cancelled}` : ''}`;
    if (sum.failed) toast.warning(msg, { id: 'fetch-summary' });
    else if (sum.cancelled && !sum.ok && !sum.cached) toast.message(msg, { id: 'fetch-summary' });
    else toast.success(`${msg} · ${sum.mails} 封`, { id: 'fetch-summary' });
  }

  /** 单个账户（可能是两个文件夹）的手动收取结果提示；被批量收取接管的任务不提示（规则 5） */
  function toastSingle(results: FetchJob[], req: number) {
    if (!results.length || results.some(j => j.run != null)) return;
    if (!results.some(j => reporter.get(j.key) === req)) return;
    results.forEach(j => { if (reporter.get(j.key) === req) reporter.delete(j.key); });
    const tid = `fetch-${results[0].accountId}`;
    const n = results.reduce((a, j) => a + (j.count || 0), 0);
    const failed = results.filter(j => j.status === 'error');
    const cached = results.filter(j => j.status === 'cached');
    const cancelled = results.filter(j => j.status === 'cancelled');
    const both = results.length > 1;
    const where = both ? '收件箱和垃圾箱' : '';
    if (cancelled.length === results.length) { toast.message('已取消收取', { id: tid }); return; }
    if (failed.length === results.length) {
      toast.error(both ? failed.map(j => `${boxLabel(j.mailbox)}：${j.error}`).join('；') : `收取失败：${failed[0].error || '未知错误'}`, { id: tid });
      return;
    }
    if (failed.length) { toast.warning(`已收取 ${n} 封；${boxLabel(failed[0].mailbox)}：${failed[0].error}`, { id: tid }); return; }
    if (cached.length) { toast.warning(`网络通道全部失败，已显示本地缓存（${n} 封）`, { id: tid }); return; }
    const ch = results.find(j => j.channel)?.channel || '';
    toast.success(`${where ? `${where}共` : ''}收取 ${n} 封${!both ? ` · 通道 ${CHANNELS[ch]?.label || ch || '未知'}` : ''}`, { id: tid });
  }

  return {
    jobs: {},
    run: null,

    enqueue: (targets, mailboxes, opts = {}) => {
      const boxes: Box[] = mailboxes.length ? [...new Set(mailboxes)] : ['INBOX'];
      const uniq = targets.filter((t, i, a) => t && Number.isFinite(t.id) && a.findIndex(x => x.id === t.id) === i);
      if (!uniq.length) return Promise.resolve([]);
      const s = get();
      const runActive = !!s.run && !s.run.finishedAt;
      // ≥ 2 个账户才算批量；批量运行中再发起的批量请求追加到同一批次
      const bulk = !!opts.bulk && (uniq.length >= 2 || runActive);
      let runId: number | undefined;
      if (bulk) {
        if (runActive) runId = s.run!.id;
        else {
          runId = ++runSeq;
          set({ run: { id: runId, startedAt: Date.now(), finishedAt: null, panelOpen: true } });
        }
      }
      const next = { ...get().jobs };
      const keys: string[] = [];
      const req = ++reqSeq;
      for (const t of uniq) {
        for (const mailbox of boxes) {
          const key = jobKey(t.id, mailbox);
          keys.push(key);
          const cur = next[key];
          if (cur && ACTIVE.includes(cur.status)) {
            // 规则 1：加入已有任务。批量接管单独任务；手动收取把排队中的任务提到队首
            const p: Partial<FetchJob> = {};
            if (bulk && cur.run == null) p.run = runId;
            if (!bulk && cur.status === 'queued') p.seq = -++seq;
            next[key] = { ...cur, ...p };
            continue;
          }
          next[key] = {
            key, accountId: t.id, mailbox,
            email: t.email || cur?.email || `#${t.id}`,
            provider: t.provider || cur?.provider || 'custom',
            status: 'queued',
            run: runId,
            seq: bulk ? ++seq : -++seq,
          };
        }
      }
      set(st => ({ jobs: next, run: st.run && runId === st.run.id ? { ...st.run, panelOpen: true } : st.run }));
      const done = Promise.all(keys.map(key => new Promise<FetchJob>(resolve => {
        const arr = waiters.get(key) || [];
        arr.push(resolve);
        waiters.set(key, arr);
      })));
      pump();
      if (!bulk) {
        keys.forEach(k => reporter.set(k, req));
        void done.then(r => toastSingle(r, req));
      }
      return done;
    },

    cancelJob: key => {
      const j = get().jobs[key];
      if (!j || !ACTIVE.includes(j.status)) return;
      if (j.status === 'queued') {
        patch(key, { status: 'cancelled', finishedAt: Date.now() });
        settle(key);
        pump();
      } else controllers.get(key)?.abort();
    },

    cancelAccount: accountId => {
      Object.values(get().jobs).filter(j => j.accountId === accountId).forEach(j => get().cancelJob(j.key));
    },

    cancelAll: () => {
      // 先把排队中的全部标记为已取消（否则中止进行中的任务时 pump 会立刻启动下一个）
      const queued = Object.values(get().jobs).filter(j => j.status === 'queued');
      if (queued.length) {
        const now = Date.now();
        set(s => {
          const jobs = { ...s.jobs };
          queued.forEach(j => { jobs[j.key] = { ...jobs[j.key], status: 'cancelled', finishedAt: now }; });
          return { jobs };
        });
        queued.forEach(j => settle(j.key));
      }
      controllers.forEach(c => c.abort());
      pump();
    },

    dismissRun: () => {
      const s = get();
      if (!s.run) return;
      if (!s.run.finishedAt) { set({ run: { ...s.run, panelOpen: false } }); return; }
      // 结束后关闭：清掉这个批次已结束的任务（徽标随之消失）
      const id = s.run.id;
      set(st => ({ run: null, jobs: Object.fromEntries(Object.entries(st.jobs).filter(([, j]) => !(j.run === id && DONE.includes(j.status)))) }));
    },

    setPanelOpen: panelOpen => set(s => (s.run ? { run: { ...s.run, panelOpen } } : s)),
  };
});

/* ------------------------------------------------------------------ selectors */

/** 某账户某文件夹的任务状态（无任务 = undefined） */
export function useJobStatus(accountId: number | null | undefined, mailbox: string): JobStatus | undefined {
  return useFetchQueue(s => (accountId == null ? undefined : s.jobs[jobKey(accountId, mailbox)]?.status));
}
export function useJob(accountId: number | null | undefined, mailbox: string): FetchJob | undefined {
  return useFetchQueue(s => (accountId == null ? undefined : s.jobs[jobKey(accountId, mailbox)]));
}

export function isAccountBusy(s: Pick<FetchQueueStore, 'jobs'>, accountId: number): boolean {
  for (const j of Object.values(s.jobs)) if (j.accountId === accountId && ACTIVE.includes(j.status)) return true;
  return false;
}
export function useIsAccountBusy(accountId: number | null | undefined): boolean {
  return useFetchQueue(s => (accountId == null ? false : isAccountBusy(s, accountId)));
}

/**
 * 账户行徽标：进行中 / 排队中（任何来源），或当前批次里的结果。
 * 邮件页账户栏与账户表格都用它，因此两处与列表头部的状态永远一致。
 */
export function accountBadge(s: Pick<FetchQueueStore, 'jobs' | 'run'>, accountId: number): AccountProgress | undefined {
  const mine = Object.values(s.jobs).filter(j => j.accountId === accountId && (ACTIVE.includes(j.status) || (s.run && j.run === s.run.id)));
  if (!mine.length) return undefined;
  return aggregate(mine)[0];
}
export function useAccountBadge(accountId: number): AccountProgress | undefined {
  // 返回原始值组合，避免每次渲染生成新对象导致无限更新
  const sig = useFetchQueue(s => {
    const a = accountBadge(s, accountId);
    return a ? `${a.status}|${a.count}|${a.error || ''}` : '';
  });
  return sig ? accountBadge(useFetchQueue.getState(), accountId) : undefined;
}

/** 批次汇总（进度面板 / 所有批量入口共用） */
export function useRunSummary() {
  const sig = useFetchQueue(s => {
    const r = runSummary(s);
    return `${s.run?.id}|${r.total}|${r.done}|${r.ok}|${r.cached}|${r.failed}|${r.cancelled}|${r.running}|${r.mails}|${r.active}|${s.run?.panelOpen}`;
  });
  void sig;
  return runSummary(useFetchQueue.getState());
}

/* ------------------------------------------------------------------ entry helpers */

/** 手动收取一个账户（当前文件夹，或收件箱 + 垃圾箱）。结果提示由引擎负责 */
export function fetchAccount(target: FetchTarget, mailboxes: Box[]) {
  const s = useFetchQueue.getState();
  // 已经在批量收取中：只提示一次，结果在进度面板里
  if (s.run && !s.run.finishedAt && mailboxes.every(b => {
    const j = s.jobs[jobKey(target.id, b)];
    return j && ACTIVE.includes(j.status) && j.run != null;
  })) toast.message('该账户已在批量收取中，已优先处理', { id: `fetch-joined-${target.id}` });
  return s.enqueue([target], mailboxes);
}

/**
 * 批量收取（收取全部 / 收取选中）。超过 20 个新账户先确认；批量运行中再发起 = 追加。
 * 只有 1 个账户时按单个收取处理（提示它自己的结果，不弹进度面板）。
 */
export async function fetchMany(targets: FetchTarget[], opts: { confirmOver?: number } = {}) {
  const s = useFetchQueue.getState();
  const uniq = targets.filter((t, i, a) => a.findIndex(x => x.id === t.id) === i);
  if (!uniq.length) { toast.message('没有可收取的账户'); return; }
  const fresh = uniq.filter(t => !isAccountBusy(s, t.id));
  const runActive = !!s.run && !s.run.finishedAt;
  if (runActive && !fresh.length) {
    toast.message('这些账户已在收取队列中', { id: 'fetch-append' });
    s.setPanelOpen(true);
    return;
  }
  const limit = opts.confirmOver ?? 20;
  if (fresh.length > limit && !(await confirmDialog({
    title: runActive ? `追加 ${fresh.length} 个账户到收取队列？` : `收取 ${fresh.length} 个账户的新邮件？`,
    message: `将以 ${FETCH_CONCURRENCY} 个并发依次收取收件箱，可随时在右下角的进度面板中取消。`,
    confirmText: runActive ? '追加' : '开始收取',
  }))) return;
  if (runActive) toast.message(`已追加 ${fresh.length} 个账户${uniq.length > fresh.length ? `（${uniq.length - fresh.length} 个已在队列中）` : ''}`, { id: 'fetch-append' });
  void useFetchQueue.getState().enqueue(uniq, ['INBOX'], { bulk: true });
}
