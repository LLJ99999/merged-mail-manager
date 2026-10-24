import { cn } from '../../lib/utils';

export type Tone = 'neutral' | 'primary' | 'accent' | 'secondary' | 'tertiary' | 'success' | 'warning' | 'danger';

export const toneClass: Record<Tone, string> = {
  neutral: 'bg-surface-container-highest text-on-surface-variant',
  primary: 'bg-primary-container text-on-primary-container',
  accent: 'bg-primary-container text-on-primary-container',
  secondary: 'bg-secondary-container text-on-secondary-container',
  tertiary: 'bg-tertiary-container text-on-tertiary-container',
  success: 'bg-success-container text-on-success-container',
  warning: 'bg-warning-container text-on-warning-container',
  danger: 'bg-error-container text-on-error-container',
};

const dotClass: Record<Tone, string> = {
  neutral: 'bg-outline', primary: 'bg-primary', accent: 'bg-primary', secondary: 'bg-secondary', tertiary: 'bg-tertiary',
  success: 'bg-success', warning: 'bg-warning', danger: 'bg-error',
};

/** 柔和色调徽章（pill） */
export function Badge({ tone = 'neutral', dot, icon: Icon, className, children, title }: { tone?: Tone; dot?: boolean; icon?: React.ElementType; className?: string; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={cn('inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-label-m', toneClass[tone], className)}>
      {dot && <span className={cn('size-1.5 rounded-full', dotClass[tone])} />}
      {Icon && <Icon className="size-3.5" strokeWidth={2.2} />}
      {children}
    </span>
  );
}

export function StatusDot({ tone = 'neutral', className }: { tone?: Tone; className?: string }) {
  return <span className={cn('inline-block size-2 shrink-0 rounded-full', dotClass[tone], className)} />;
}
