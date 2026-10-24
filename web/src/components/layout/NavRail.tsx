import { NavLink, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Sun, Moon, SunMoon } from 'lucide-react';
import { NAV_ITEMS } from './nav';
import { Fab } from './Fab';
import { APP_VERSION } from './VersionBanner';
import { cn } from '../../lib/utils';
import { spring } from '../../lib/motion';
import { useAppearance, type ThemeMode } from '../../stores/appearance';
import { useRipple } from '../common/Ripple';
import { useUi } from '../../stores/ui';

const NEXT: Record<ThemeMode, ThemeMode> = { light: 'dark', dark: 'system', system: 'light' };
const MODE_META = { light: { icon: Sun, label: '亮色' }, dark: { icon: Moon, label: '暗色' }, system: { icon: SunMoon, label: '跟随系统' } };

function isActive(pathname: string, to: string) {
  return pathname === to || pathname.startsWith(to + '/');
}

/** 导航目标：「邮件」回到上次查看的账户/邮件，其余为固定地址 */
function useNavTarget() {
  const lastMail = useUi(s => s.lastMailPath);
  return (to: string) => (to === '/mail' ? lastMail || '/mail' : to);
}

function RailItem({ to, icon: Icon, label, active }: { to: string; icon: React.ElementType; label: string; active: boolean }) {
  const { onPointerDown, ripple } = useRipple();
  return (
    <NavLink to={to} data-active={active || undefined} aria-current={active ? 'page' : undefined} className="group flex w-full flex-col items-center gap-1 py-0.5 outline-none" onPointerDown={onPointerDown}>
      <span className="relative flex h-8 w-14 items-center justify-center overflow-hidden rounded-full">
        {active && <motion.span layoutId="rail-indicator" transition={spring} className="absolute inset-0 rounded-full bg-secondary-container" />}
        <span className={cn('absolute inset-0 rounded-full transition-colors', !active && 'group-hover:bg-on-surface/[0.08]')} />
        {ripple}
        <motion.span className="relative" animate={{ scale: active ? 1.06 : 1 }} transition={spring}>
          <Icon className={cn('size-6 transition-colors', active ? 'text-on-secondary-container' : 'text-on-surface-variant')} strokeWidth={active ? 2.3 : 1.9} />
        </motion.span>
      </span>
      <span className={cn('text-label-m transition-colors', active ? 'font-semibold text-on-surface' : 'text-on-surface-variant')}>{label}</span>
    </NavLink>
  );
}

/** M3 Navigation Rail（桌面） */
export function NavRail() {
  const { pathname } = useLocation();
  const target = useNavTarget();
  const mode = useAppearance(s => s.mode);
  const setMode = useAppearance(s => s.setMode);
  const M = MODE_META[mode];
  return (
    <aside className="relative z-20 hidden w-[88px] shrink-0 flex-col items-center gap-5 py-5 md:flex">
      <div className="flex size-10 items-center justify-center rounded-[14px] bg-primary text-on-primary shadow-elev-1" title="Mail Manager">
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="3.5" /><path d="m4 7.5 8 5.5 8-5.5" /></svg>
      </div>
      <Fab variant="rail" />
      <nav className="mt-2 flex w-full flex-col items-center gap-3">
        {NAV_ITEMS.map(it => <RailItem key={it.to} {...it} to={target(it.to)} active={isActive(pathname, it.to)} />)}
      </nav>
      <div className="mt-auto flex flex-col items-center gap-1">
        <motion.button
          type="button"
          onClick={() => setMode(NEXT[mode])}
          whileTap={{ scale: 0.9, rotate: -20 }}
          className="flex size-10 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-on-surface/[0.08]"
          title={`主题：${M.label}（点击切换）`}
          aria-label="切换主题"
        >
          <M.icon className="size-5" />
        </motion.button>
        <span className="tabular text-label-s text-on-surface-variant/70" title={`前端构建版本 v${APP_VERSION}`} data-testid="app-version">v{APP_VERSION}</span>
      </div>
    </aside>
  );
}

/** M3 Navigation Bar（移动端） */
export function NavBar() {
  const { pathname } = useLocation();
  const target = useNavTarget();
  return (
    <nav className="sf-low fixed inset-x-0 bottom-0 z-30 flex h-20 items-start justify-around px-2 pb-[env(safe-area-inset-bottom)] pt-3 md:hidden">
      {NAV_ITEMS.map(it => {
        const active = isActive(pathname, it.to);
        return (
          <NavLink key={it.to} to={target(it.to)} data-active={active || undefined} aria-current={active ? 'page' : undefined} className="flex flex-1 flex-col items-center gap-1">
            <span className="relative flex h-8 w-16 items-center justify-center">
              {active && <motion.span layoutId="bar-indicator" transition={spring} className="absolute inset-0 rounded-full bg-secondary-container" />}
              <it.icon className={cn('relative size-6', active ? 'text-on-secondary-container' : 'text-on-surface-variant')} strokeWidth={active ? 2.3 : 1.9} />
            </span>
            <span className={cn('text-label-m', active ? 'font-semibold text-on-surface' : 'text-on-surface-variant')}>{it.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
