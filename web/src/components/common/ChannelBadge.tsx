import { Waypoints, Zap, History, Mail, Database } from 'lucide-react';
import { CHANNELS, cn } from '../../lib/utils';
import { toneClass, type Tone } from './Badge';

const META: Record<string, { icon: React.ElementType; tone: Tone }> = {
  graph: { icon: Waypoints, tone: 'primary' },
  imap_new: { icon: Zap, tone: 'secondary' },
  imap_old: { icon: History, tone: 'tertiary' },
  imap: { icon: Mail, tone: 'secondary' },
  cache: { icon: Database, tone: 'warning' },
};

/** 取信通道：Graph / IMAP-new / IMAP-old / IMAP / Cache —— 带图标的柔和色调 chip */
export function ChannelBadge({ channel, className, withHint, size = 'md' }: { channel?: string | null; className?: string; withHint?: boolean; size?: 'sm' | 'md' }) {
  if (!channel) return <span className={cn('text-body-s text-on-surface-variant/60', className)}>—</span>;
  const meta = CHANNELS[channel] || { label: channel, short: channel, hint: '' };
  const m = META[channel] || { icon: Mail, tone: 'neutral' as Tone };
  const Icon = m.icon;
  return (
    <span
      title={meta.hint}
      className={cn(
        'inline-flex shrink-0 items-center whitespace-nowrap rounded-full',
        size === 'sm' ? 'h-5 gap-1 pl-1.5 pr-2 text-label-s' : 'h-6 gap-1.5 pl-2 pr-2.5 text-label-m',
        toneClass[m.tone],
        className,
      )}
    >
      <Icon className={size === 'sm' ? 'size-3' : 'size-3.5'} strokeWidth={2.2} />
      {meta.short}
      {withHint && meta.hint && <span className="font-normal opacity-75">· {meta.hint}</span>}
    </span>
  );
}
