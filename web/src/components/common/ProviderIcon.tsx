import { useMemo } from 'react';
import { firstGrapheme, cn, providerMeta } from '../../lib/utils';
import { harmonizedTile } from '../../lib/monet';
import { useAppearance } from '../../stores/appearance';

/** 将任意品牌色/字符串色与当前种子色协调，返回 M3 容器式配色 */
export function useHarmonized(hex: string) {
  const seed = useAppearance(s => s.seed);
  const dark = useAppearance(s => s.isDark);
  return useMemo(() => harmonizedTile(hex, seed, dark), [hex, seed, dark]);
}

/** 服务商头像：彩色圆角图块（品牌色已与 Monet 种子色协调） */
export function ProviderIcon({ provider, size = 'md', className }: { provider?: string; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const meta = providerMeta(provider);
  const { bg, fg } = useHarmonized(meta.color);
  const dims = { sm: 'size-7 rounded-[9px] text-[10px]', md: 'size-9 rounded-xl text-[11px]', lg: 'size-11 rounded-[14px] text-[12px]' }[size];
  return (
    <span
      title={meta.label}
      className={cn('inline-flex shrink-0 items-center justify-center font-bold tracking-tight transition-colors duration-300', dims, className)}
      style={{ backgroundColor: bg, color: fg }}
    >
      {provider === 'outlook' ? <OutlookGlyph /> : provider === 'gmail' ? <GmailGlyph /> : meta.short}
    </span>
  );
}

function OutlookGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-[58%]" fill="none" stroke="currentColor" strokeWidth="2.2">
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <ellipse cx="9.5" cy="12" rx="3" ry="3.4" />
      <path d="M15 9.5h3.5M15 12h3.5M15 14.5h3.5" strokeLinecap="round" />
    </svg>
  );
}

function GmailGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-[58%]" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round">
      <path d="M3.5 18V7.5l8.5 6 8.5-6V18" />
    </svg>
  );
}

export function ProviderBadge({ provider }: { provider?: string }) {
  const meta = providerMeta(provider);
  const { bg, fg } = useHarmonized(meta.color);
  return (
    <span className="inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full bg-surface-container-highest pl-1 pr-2.5 text-label-m text-on-surface-variant">
      <span className="size-4 rounded-full" style={{ backgroundColor: bg, boxShadow: `inset 0 0 0 4px ${fg}` }} />
      {meta.label}
    </span>
  );
}

/** 发件人头像：圆形，色相由字符串哈希决定并与种子色协调 */
export function SenderAvatar({ name, seedKey, size = 40, className }: { name: string; seedKey: string; size?: number; className?: string }) {
  const hues = ['#4285F4', '#0F9D58', '#DB4437', '#F4B400', '#AB47BC', '#00ACC1', '#FF7043', '#5C6BC0'];
  let h = 0;
  for (let i = 0; i < seedKey.length; i++) h = seedKey.charCodeAt(i) + ((h << 5) - h);
  const { bg, fg } = useHarmonized(hues[Math.abs(h) % hues.length]);
  const ch = firstGrapheme(name || '').toUpperCase() || '?';
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-semibold', className)} style={{ width: size, height: size, backgroundColor: bg, color: fg, fontSize: size * 0.4 }}>
      {ch}
    </span>
  );
}
