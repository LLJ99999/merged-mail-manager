import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Ban, CheckCircle2, ChevronDown, Clock3, Layers, X, XCircle, Database } from 'lucide-react';
import { useFetchQueue, useRunSummary, ACTIVE, type AccountProgress, type JobStatus } from '../../stores/fetchQueue';
import { cn } from '../../lib/utils';
import { spring } from '../../lib/motion';
import { ProviderIcon } from '../common/ProviderIcon';
import { ChannelBadge } from '../common/ChannelBadge';
import { Spinner } from '../common/Misc';
import { Button, IconButton } from '../common/Button';

/**
 * 全局收取进度面板（任意页面右下角 / 移动端导航栏上方）。只在批量收取（≥ 2 个账户）时出现；
 * x/y、成功/缓存/失败计数、每个账户的通道结果；可取消单个账户或全部取消。
 */
export function FetchProgressPanel() {
  const run = useFetchQueue(s => s.run);
  const cancelAll = useFetchQueue(s => s.cancelAll);
  const cancelAccount = useFetchQueue(s => s.cancelAccount);
  const dismiss = useFetchQueue(s => s.dismissRun);
  const setPanelOpen = useFetchQueue(s => s.setPanelOpen);
  const [expanded, setExpanded] = useState(false);
  const s = useRunSummary();
  const items = s.accounts;
  const running = s.active;
  const panelOpen = !!run?.panelOpen;
  // 规则：只有 ≥ 2 个账户的批量收取才显示面板
  const visible = !!run && s.total >= 2;
  const pct = s.total ? s.done / s.total : 0;
  // 面板悬浮在右下角：显示期间给页面底部留出空间，可以把分页按钮 / 最后几行滚到面板上方（否则被挡住无法点击）
  const reserve = visible ? (panelOpen ? (expanded ? 'lg' : 'md') : 'sm') : '';
  useEffect(() => {
    const root = document.documentElement;
    if (reserve) root.dataset.batchPanel = reserve; else delete root.dataset.batchPanel;
    return () => { delete root.dataset.batchPanel; };
  }, [reserve]);

  return (
    <AnimatePresence>
      {visible && !panelOpen && (
        <motion.button
          key="pill"
          type="button"
          onClick={() => setPanelOpen(true)}
          initial={{ opacity: 0, y: 16, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.9 }}
          transition={spring}
          className="sf-high fixed bottom-[104px] right-4 z-40 inline-flex h-10 items-center gap-2 rounded-full pl-3 pr-4 text-label-l text-on-surface shadow-elev-2 md:bottom-6 md:right-6"
          data-testid="batch-pill"
        >
          {running ? <Spinner className="size-4" /> : <Layers className="size-4 text-primary" />}
          <span className="tabular">收取 {s.done}/{s.total}</span>
        </motion.button>
      )}
      {visible && panelOpen && (
        <motion.section
          key="panel"
          role="status"
          aria-live="polite"
          aria-label="收取进度"
          data-testid="batch-panel"
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.96, transition: { duration: 0.16 } }}
          transition={spring}
          className="sf-high fixed inset-x-3 bottom-[96px] z-40 overflow-hidden rounded-[24px] shadow-elev-3 md:inset-x-auto md:bottom-6 md:right-6 md:w-[380px]"
        >
          <div className="flex items-center gap-3 px-4 pb-2 pt-3.5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary-container text-on-primary-container">
              {running ? <Spinner className="size-5 text-on-primary-container" /> : s.failed ? <XCircle className="size-5" /> : <CheckCircle2 className="size-5" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-title-s text-on-surface">{running ? '正在收取' : '收取完成'}</p>
              <p className="tabular text-body-s text-on-surface-variant" data-testid="batch-count">
                {s.done} / {s.total} 个账户{running && s.running ? ` · ${s.running} 个进行中` : ''}{s.mails ? ` · ${s.mails} 封` : ''}
              </p>
            </div>
            <IconButton size="icon-sm" onClick={() => setExpanded(e => !e)} aria-label={expanded ? '收起详情' : '展开详情'} title={expanded ? '收起详情' : '展开详情'}>
              <motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={spring} className="flex"><ChevronDown /></motion.span>
            </IconButton>
            <IconButton size="icon-sm" onClick={dismiss} aria-label={running ? '最小化' : '关闭'} title={running ? '最小化（继续在后台收取）' : '关闭'}><X /></IconButton>
          </div>

          {/* M3 线性进度 */}
          <div className="mx-4 h-1.5 overflow-hidden rounded-full bg-secondary-container" role="progressbar" aria-valuemin={0} aria-valuemax={s.total} aria-valuenow={s.done}>
            <motion.div className="h-full rounded-full bg-primary" initial={false} animate={{ width: `${Math.max(pct * 100, running ? 4 : 0)}%` }} transition={spring} />
          </div>

          <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3 pt-3">
            <Stat tone="success" icon={CheckCircle2} label="成功" n={s.ok} />
            {s.cached > 0 && <Stat tone="warning" icon={Database} label="缓存" n={s.cached} />}
            <Stat tone={s.failed ? 'error' : 'neutral'} icon={XCircle} label="失败" n={s.failed} />
            {s.cancelled > 0 && <Stat tone="neutral" icon={Ban} label="取消" n={s.cancelled} />}
            <div className="ml-auto">
              {running ? (
                <Button size="sm" variant="text" onClick={cancelAll} data-testid="batch-cancel">全部取消</Button>
              ) : (
                <Button size="sm" variant="text" onClick={dismiss}>完成</Button>
              )}
            </div>
          </div>

          <AnimatePresence initial={false}>
            {expanded && (
              <motion.ul
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
                className="batch-list max-h-[38vh] overflow-y-auto border-t border-outline-variant/40 pb-4 pt-1"
                data-testid="batch-list"
              >
                {items.map(it => <Row key={it.accountId} it={it} onCancel={() => cancelAccount(it.accountId)} />)}
              </motion.ul>
            )}
          </AnimatePresence>
        </motion.section>
      )}
    </AnimatePresence>
  );
}

const TONE = {
  success: 'bg-success-container text-on-success-container',
  warning: 'bg-warning-container text-on-warning-container',
  error: 'bg-error-container text-on-error-container',
  neutral: 'bg-surface-container-highest text-on-surface-variant',
};

function Stat({ tone, icon: Icon, label, n }: { tone: keyof typeof TONE; icon: React.ElementType; label: string; n: number }) {
  return (
    <span className={cn('tabular inline-flex h-7 items-center gap-1.5 rounded-lg pl-2 pr-2.5 text-label-m', TONE[tone])}>
      <Icon className="size-3.5" />{label} {n}
    </span>
  );
}

export function FetchStatusIcon({ status, className }: { status: JobStatus; className?: string }) {
  if (status === 'running') return <Spinner className={cn('size-4', className)} />;
  if (status === 'queued') return <Clock3 className={cn('size-4 text-on-surface-variant', className)} />;
  if (status === 'cancelled') return <Ban className={cn('size-4 text-on-surface-variant', className)} />;
  if (status === 'error') return <XCircle className={cn('size-4 text-error', className)} />;
  if (status === 'cached') return <Database className={cn('size-4 text-warning', className)} />;
  return <CheckCircle2 className={cn('size-4 text-success', className)} />;
}

export const STATUS_TEXT: Record<JobStatus, string> = { queued: '排队中', running: '收取中…', ok: '已收取', cached: '已显示缓存', error: '失败', cancelled: '已取消' };

/** 账户头像右下角的收取状态徽标（邮件页账户栏、账户表格共用；数据来自同一个引擎） */
export function AccountFetchBadge({ it }: { it: AccountProgress | undefined }) {
  if (!it) return null;
  return (
    <span
      title={it.status === 'error' ? it.error : STATUS_TEXT[it.status]}
      data-testid="acc-batch-status"
      data-status={it.status}
      className="absolute -bottom-1 -right-1 flex size-[18px] items-center justify-center rounded-full bg-surface-container-high ring-2 ring-surface-container-low"
    >
      <FetchStatusIcon status={it.status} className="size-3" />
    </span>
  );
}

function Row({ it, onCancel }: { it: AccountProgress; onCancel: () => void }) {
  const active = ACTIVE.includes(it.status);
  const junk = it.mailboxes.includes('Junk');
  const text = it.status === 'queued' ? '排队中' : it.status === 'running' ? '收取中…' : it.status === 'cancelled' ? '已取消'
    : it.status === 'error' ? (it.error || '失败') : `${it.count ?? 0} 封${junk ? '（含垃圾箱）' : ''}`;
  return (
    <li className="group flex items-center gap-3 px-4 py-2" title={it.error || undefined} data-status={it.status}>
      <ProviderIcon provider={it.provider} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-body-m text-on-surface">{it.email}</p>
        <p className={cn('text-body-s', it.status === 'error' ? 'line-clamp-2 break-words text-error' : 'truncate text-on-surface-variant')} data-testid="batch-row-text">{text}</p>
      </div>
      {(it.status === 'ok' || it.status === 'cached') && it.channel && <ChannelBadge channel={it.channel} size="sm" />}
      {active ? (
        <IconButton size="icon-sm" onClick={onCancel} aria-label={`取消收取 ${it.email}`} title="取消收取该账户" data-testid="batch-row-cancel" className="-mr-1.5">
          <span className="relative flex size-[18px] items-center justify-center">
            <span className="absolute inset-0 flex items-center justify-center transition-opacity group-hover:opacity-0"><FetchStatusIcon status={it.status} /></span>
            <X className="opacity-0 transition-opacity group-hover:opacity-100" />
          </span>
        </IconButton>
      ) : <FetchStatusIcon status={it.status} />}
    </li>
  );
}
