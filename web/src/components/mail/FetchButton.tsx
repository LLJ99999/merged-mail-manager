import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Ban, ChevronDown, FolderSync, Layers, RefreshCw } from 'lucide-react';
import { cn } from '../../lib/utils';
import { spring, springBouncy } from '../../lib/motion';
import { useRipple } from '../common/Ripple';
import { Button } from '../common/Button';
import { useRunSummary } from '../../stores/fetchQueue';

export interface FetchMenuItem {
  key: string;
  icon: React.ElementType;
  label: string;
  hint?: string;
  disabled?: boolean;
  onSelect: () => void;
}

/** 收取进度指示：M3 圆形进度（不定进度旋转；有 value 时显示确定进度） */
export function Progress({ value, className }: { value?: number; className?: string }) {
  const r = 8;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 20 20" className={cn('size-[18px]', value == null && 'animate-[spin_0.9s_linear_infinite]', className)} fill="none" aria-hidden>
      <circle cx="10" cy="10" r={r} stroke="currentColor" strokeOpacity="0.24" strokeWidth="2.4" />
      {value == null ? (
        <path d="M18 10a8 8 0 0 0-8-8" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      ) : (
        <circle cx="10" cy="10" r={r} stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(1, value)))} transform="rotate(-90 10 10)" style={{ transition: 'stroke-dashoffset 300ms cubic-bezier(0.2,0,0,1)' }} />
      )}
    </svg>
  );
}

const VARIANT = {
  filled: 'bg-primary text-on-primary hover:bg-[color-mix(in_srgb,rgb(var(--primary)),rgb(var(--on-primary))_8%)]',
  tonal: 'bg-secondary-container text-on-secondary-container hover:bg-[color-mix(in_srgb,rgb(var(--secondary-container)),rgb(var(--on-secondary-container))_8%)]',
} as const;

/**
 * M3 Expressive 分体按钮（split button）：
 *   [⟳ 收取] [▾]
 * 主体收取当前账户的当前文件夹；右侧菜单：收取收件箱和垃圾箱 / 取消收取（进行中时）。
 * 收取中：图标换成圆形进度，文字为「收取中…」/「排队中…」。主体仍可点击——同一个任务只会被「加入」
 * （排队中的会被提到队首），不会重复请求；取消在菜单里。
 */
export function FetchSplitButton({
  busy, disabled, label = '收取', busyLabel = '收取中…', title, progress, onFetch, items, variant = 'tonal', size = 'md', className,
}: {
  title?: string;
  busy?: boolean;
  disabled?: boolean;
  label?: string;
  busyLabel?: string;
  /** 0..1：批量收取时的确定进度 */
  progress?: number;
  onFetch: () => void;
  items?: FetchMenuItem[];
  variant?: keyof typeof VARIANT;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const lead = useRipple();
  const trail = useRipple();
  const h = size === 'sm' ? 'h-9' : 'h-10';

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey, true); };
  }, [open]);

  const leadDisabled = disabled;
  return (
    <div ref={ref} className={cn('fetch-split relative inline-flex shrink-0 items-stretch gap-[2px]', className)} data-busy={busy || undefined}>
      <motion.button
        type="button"
        onClick={onFetch}
        disabled={leadDisabled}
        onPointerDown={lead.onPointerDown}
        whileTap={leadDisabled ? undefined : { scale: 0.96 }}
        transition={springBouncy}
        aria-label={busy ? busyLabel : label}
        title={title}
        aria-busy={busy || undefined}
        data-testid="fetch-button"
        className={cn(
          'relative isolate inline-flex select-none items-center gap-2 overflow-hidden whitespace-nowrap rounded-l-full pl-4 text-label-l font-medium transition-[background-color,border-radius,box-shadow] duration-200',
          // 分体模式给主体一个最小宽度（≈「收取中…」的宽度），收取开始/结束时工具栏不会左右跳动
          items?.length ? 'min-w-[106px] justify-center rounded-r-[6px] pr-3.5 active:rounded-r-[12px]' : 'rounded-r-full pr-5',
          h, VARIANT[variant],
          'hover:shadow-elev-1 disabled:cursor-default disabled:hover:shadow-none',
          disabled && !busy && 'opacity-[0.38]',
        )}
      >
        {lead.ripple}
        <span className="relative flex size-[18px] items-center justify-center">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={busy ? 'busy' : 'idle'}
              initial={{ scale: 0.4, opacity: 0, rotate: -90 }}
              animate={{ scale: 1, opacity: 1, rotate: 0 }}
              exit={{ scale: 0.4, opacity: 0, rotate: 90 }}
              transition={springBouncy}
              className="absolute inset-0 flex items-center justify-center"
            >
              {busy ? <Progress value={progress} /> : <RefreshCw className="size-[18px]" strokeWidth={2.2} />}
            </motion.span>
          </AnimatePresence>
        </span>
        <span className="relative tabular">{busy ? busyLabel : label}</span>
      </motion.button>
      {!!items?.length && (
        <motion.button
          type="button"
          onClick={() => setOpen(o => !o)}
          disabled={disabled}
          onPointerDown={trail.onPointerDown}
          whileTap={{ scale: 0.94 }}
          transition={springBouncy}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="更多收取选项"
          title="更多收取选项"
          data-testid="fetch-menu-button"
          className={cn(
            'relative isolate inline-flex select-none items-center justify-center overflow-hidden transition-[background-color,border-radius] duration-200',
            // 宽度固定，打开菜单时只变形为圆形，避免工具栏抖动
            'w-10', open ? 'rounded-full' : 'rounded-l-[6px] rounded-r-full',
            h, VARIANT[variant], 'hover:shadow-elev-1 disabled:opacity-[0.38]',
          )}
        >
          {trail.ripple}
          <motion.span animate={{ rotate: open ? 180 : 0 }} transition={spring} className="relative flex">
            <ChevronDown className="size-[18px]" strokeWidth={2.2} />
          </motion.span>
        </motion.button>
      )}
      <AnimatePresence>
        {open && items && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, scale: 0.92, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -4, transition: { duration: 0.12 } }}
            transition={spring}
            style={{ transformOrigin: 'top right' }}
            className="sf-high absolute right-0 top-full z-40 mt-2 w-[268px] rounded-2xl py-2 shadow-elev-2"
          >
            {items.map(it => (
              <button
                key={it.key}
                type="button"
                role="menuitem"
                disabled={it.disabled}
                onClick={() => { setOpen(false); it.onSelect(); }}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-on-surface/[0.08] focus-visible:bg-on-surface/[0.1] focus-visible:outline-none disabled:pointer-events-none disabled:opacity-[0.38]"
              >
                <it.icon className="size-5 shrink-0 text-on-surface-variant" />
                <span className="min-w-0 flex-1">
                  <span className="block text-body-l text-on-surface">{it.label}</span>
                  {it.hint && <span className="block truncate text-body-s text-on-surface-variant">{it.hint}</span>}
                </span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export const FETCH_ICONS = { both: FolderSync, cancel: Ban };

/**
 * 批量收取入口（邮件页账户栏「收取全部」、账户页「收取选中 / 收取全部」、概览「收取全部」）。
 * 所有入口显示同一个引擎的批次进度；运行中仍可点击 = 把这些账户追加到同一批次（已在队列中的不会重复）。
 * 取消在进度面板里（单个账户或全部取消）。
 */
export function FetchScopeButton({
  label, count, onClick, disabled, variant = 'tonal', size, iconOnly, compact, className, testId,
}: {
  /** 空间有限（邮件页账户栏）：运行中只显示「收取全部」+ 进度，不再显示 (n) */
  compact?: boolean;
  label: string;
  count?: number;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'filled' | 'tonal';
  size?: 'sm' | 'md';
  iconOnly?: boolean;
  className?: string;
  testId?: string;
}) {
  const sum = useRunSummary();
  const busy = sum.active && sum.total > 0;
  const text = count != null ? `${label} (${count})` : label;
  const shown = compact && busy ? label : text;
  const title = busy
    ? `正在收取 ${sum.done}/${sum.total}。点击把${count != null ? `这 ${count} 个` : '这些'}账户追加到队列（已在队列中的不会重复）`
    : `${text}：以 4 个并发收取收件箱`;
  return (
    <Button
      variant={variant}
      size={size}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={busy ? `${text}（正在收取 ${sum.done}/${sum.total}）` : text}
      aria-busy={busy || undefined}
      data-testid={testId}
      data-busy={busy || undefined}
      className={cn(iconOnly && 'size-10 px-0', className)}
    >
      <span className="relative flex size-[18px] items-center justify-center">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={busy ? 'busy' : 'idle'}
            initial={{ scale: 0.4, opacity: 0, rotate: -90 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            exit={{ scale: 0.4, opacity: 0, rotate: 90 }}
            transition={springBouncy}
            className="absolute inset-0 flex items-center justify-center"
          >
            {busy ? <Progress value={sum.total ? Math.max(0.04, sum.done / sum.total) : undefined} className="!size-[18px]" /> : <Layers />}
          </motion.span>
        </AnimatePresence>
      </span>
      {!iconOnly && <span className="tabular">{shown}</span>}
      {!iconOnly && busy && (
        <motion.span initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={springBouncy} className="tabular -mr-1 rounded-full bg-on-surface/[0.08] px-1.5 text-label-s" data-testid="fetch-scope-progress">
          {sum.done}/{sum.total}
        </motion.span>
      )}
    </Button>
  );
}
