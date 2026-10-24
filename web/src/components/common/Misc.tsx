import { useEffect, useId, useRef } from 'react';
import { animate, motion, useReducedMotion } from 'framer-motion';
import { cn } from '../../lib/utils';
import { spring } from '../../lib/motion';

/** M3 圆形进度指示器（仅 transform 旋转） */
export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn('size-5 animate-[spin_0.9s_linear_infinite] text-primary', className)} fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.18" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function EmptyState({ icon: Icon, title, description, action, className }: { icon?: React.ElementType; title: string; description?: string; action?: React.ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={spring}
      className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}
    >
      {Icon && (
        <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-secondary-container text-on-secondary-container">
          <Icon className="size-6" />
        </div>
      )}
      <p className="text-title-m text-on-surface">{title}</p>
      {description && <p className="mt-1 max-w-xs text-body-m text-on-surface-variant">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </motion.div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-headline-m text-on-surface">{title}</h1>
        {description && <p className="mt-1 text-body-l text-on-surface-variant">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** 分段按钮/选项卡：选中指示器用 shared layout 平滑滑动 */
export function Segmented<T extends string>({ value, onChange, options, className, size = 'md' }: { value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode }[]; className?: string; size?: 'sm' | 'md' }) {
  const id = useId();
  return (
    <div className={cn('inline-flex items-center rounded-full bg-surface-container-highest p-1', size === 'sm' ? 'h-9' : 'h-10', className)}>
      {options.map(o => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              'relative inline-flex h-full items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-label-l transition-colors duration-200 [&_svg]:size-4',
              active ? 'text-on-secondary-container' : 'text-on-surface-variant hover:text-on-surface',
            )}
          >
            {active && (
              <motion.span layoutId={`seg-${id}`} transition={spring} className="absolute inset-0 rounded-full bg-secondary-container shadow-elev-1" />
            )}
            <span className="relative z-10 inline-flex items-center gap-1.5">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} />;
}

/** 数字滚动计数（直接写 textContent，不触发 React 重渲染） */
export function CountUp({ value, className, duration = 1.1 }: { value: number; className?: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduce) { el.textContent = value.toLocaleString(); prev.current = value; return; }
    const controls = animate(prev.current, value, {
      duration,
      ease: [0.2, 0, 0, 1],
      onUpdate: v => { el.textContent = Math.round(v).toLocaleString(); },
    });
    prev.current = value;
    return () => controls.stop();
  }, [value, duration, reduce]);
  return <span ref={ref} className={cn('tabular', className)}>0</span>;
}

/** 内容卡片：色调表面 + 大圆角；interactive 时带悬停/按压缩放 */
export function Card({ className, children, interactive, as = 'section', ...rest }: { className?: string; children: React.ReactNode; interactive?: boolean; as?: 'section' | 'div' } & Omit<React.HTMLAttributes<HTMLElement>, 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart'>) {
  const Comp = as === 'div' ? motion.div : motion.section;
  return (
    <Comp
      className={cn('card sf-low', className)}
      {...(interactive ? { whileHover: { scale: 1.01 }, whileTap: { scale: 0.99 }, transition: spring } : {})}
      {...rest}
    >
      {children}
    </Comp>
  );
}
