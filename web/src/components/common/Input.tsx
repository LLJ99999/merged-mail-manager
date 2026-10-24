import { forwardRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Minus } from 'lucide-react';
import { cn } from '../../lib/utils';

/** M3 filled 风格输入框：色调填充、无描边，聚焦时出现 primary 指示环 */
const base =
  'w-full rounded-xl bg-surface-container-highest px-3.5 text-body-l text-on-surface placeholder:text-on-surface-variant/70 outline-none transition-[box-shadow,background-color] duration-200 ease-emphasized hover:bg-[color-mix(in_srgb,rgb(var(--surface-container-highest)),rgb(var(--on-surface))_6%)] focus:shadow-[inset_0_0_0_2px_rgb(var(--primary))] disabled:opacity-60 sm:text-body-m';

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(base, 'h-11', className)} {...props} />
));
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(base, 'py-3 leading-relaxed', className)} {...props} />
));
Textarea.displayName = 'Textarea';

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => (
  <div className={cn('relative', className?.match(/\bw-\S+/)?.[0])}>
    <select ref={ref} className={cn(base, 'h-11 cursor-pointer appearance-none pr-9', className)} {...props}>
      {children}
    </select>
    <svg className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-on-surface-variant" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="m7 10 5 5 5-5" /></svg>
  </div>
));
Select.displayName = 'Select';

export function Field({ label, hint, children, className }: { label: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="field-label">{label}</label>
      {children}
      {hint && <p className="mt-1.5 px-1 text-body-s text-on-surface-variant">{hint}</p>}
    </div>
  );
}

/** M3 复选框 */
export function Checkbox({ checked, indeterminate, onChange, className, ...rest }: { checked: boolean; indeterminate?: boolean; onChange: () => void; className?: string; 'aria-label'?: string }) {
  const on = checked || indeterminate;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      onClick={e => { e.stopPropagation(); onChange(); }}
      className={cn('group relative flex size-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-on-surface/[0.08]', className)}
      {...rest}
    >
      <span className={cn('flex size-[18px] items-center justify-center rounded-[5px] transition-colors duration-150', on ? 'bg-primary text-on-primary' : 'shadow-[inset_0_0_0_2px_rgb(var(--on-surface-variant))]')}>
        <AnimatePresence initial={false}>
          {on && (
            <motion.span key={indeterminate ? 'i' : 'c'} initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }} transition={{ type: 'spring', stiffness: 700, damping: 30 }}>
              {indeterminate ? <Minus className="size-3.5" strokeWidth={3.2} /> : <Check className="size-3.5" strokeWidth={3.2} />}
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </button>
  );
}

/** M3 开关：轨道 52×32，滑块未选中 16px → 选中 24px（带对勾） */
export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-8 w-[52px] shrink-0 items-center rounded-full px-1 transition-colors duration-200 disabled:opacity-40',
        checked ? 'justify-end bg-primary' : 'justify-start bg-surface-container-highest shadow-[inset_0_0_0_2px_rgb(var(--outline))]',
      )}
    >
      <motion.span
        layout
        transition={{ type: 'spring', stiffness: 700, damping: 35 }}
        className={cn('flex items-center justify-center rounded-full', checked ? 'size-6 bg-on-primary text-primary' : 'ml-1 size-4 bg-outline')}
      >
        {checked && <Check className="size-3.5" strokeWidth={3} />}
      </motion.span>
    </button>
  );
}
