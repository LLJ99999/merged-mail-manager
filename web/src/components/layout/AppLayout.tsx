import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigate, useNavigationType, useOutlet } from 'react-router-dom';
import { motion } from 'framer-motion';
import { NavRail, NavBar } from './NavRail';
import { Background } from './Background';
import { Fab } from './Fab';
import { cn } from '../../lib/utils';
import { pageVariants } from '../../lib/motion';
import ImportDialog from '../accounts/ImportDialog';
import { ConfirmHost } from '../common/ConfirmHost';
import { useUi } from '../../stores/ui';
import { useAccountStore } from '../../stores/accounts';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { FetchProgressPanel } from '../mail/FetchProgressPanel';
import { releaseStaleLocks } from '../../lib/overlayGuard';
import { VersionBanner } from './VersionBanner';

/**
 * 页面转场：按一级路由（/mail、/accounts…）作 key，只做进入动画（淡入 + 轻微上移），旧页面立即卸载。
 *
 * 之前使用 <AnimatePresence mode="wait"> 包裹 useOutlet()：旧页面在退出动画期间仍挂载、却读取到新的 URL
 * （例如邮件页看到没有 account 参数就清空了选择），且两次转场之间会出现约 150ms 的空白；快速点击/后退时还会
 * 叠加。去掉退出阶段后切换是即时且确定的，同时保留 M3 的进入动效（遵循系统「减少动态效果」）。
 */
/** QA：localStorage['mm-qa-crash'] 等于当前一级路由时故意抛错，用于验证错误边界（正常使用不会触发） */
function QaCrashProbe({ segment }: { segment: string }) {
  let flag: string | null = null;
  try { flag = localStorage.getItem('mm-qa-crash'); } catch { /* ignore */ }
  if (flag && flag === segment) throw new Error(`QA 注入的渲染错误（${segment}）`);
  return null;
}

export function AppLayout() {
  const location = useLocation();
  const navType = useNavigationType();
  const outlet = useOutlet();
  const { pathname } = location;
  const segment = '/' + (pathname.split('/')[1] || '');
  const fullBleed = segment === '/mail';
  const importOpen = useUi(s => s.importOpen);
  const setImportOpen = useUi(s => s.setImportOpen);
  const bump = useUi(s => s.bumpAccounts);
  const navigate = useNavigate();

  // 路由变化时：若没有打开的对话框，清除任何残留在 body 上的 pointer-events/滚动锁（见 lib/overlayGuard）
  useEffect(() => { releaseStaleLocks(); }, [location.key]);

  // 首屏不做进入动画
  const firstRender = useRef(true);
  useEffect(() => { firstRender.current = false; }, []);

  // 滚动位置：前进/点击导航回到顶部；浏览器后退/前进恢复离开时的位置
  const mainRef = useRef<HTMLElement>(null);
  const positions = useRef(new Map<string, number>());
  const keyRef = useRef(location.key);
  const segRef = useRef(segment);
  useLayoutEffect(() => {
    const main = mainRef.current;
    keyRef.current = location.key;
    if (!main || segRef.current === segment) return;
    segRef.current = segment;
    const target = navType === 'POP' ? positions.current.get(location.key) ?? 0 : 0;
    main.scrollTop = target;
    if (!target) return;
    // 数据异步加载后内容才足够高，短暂重试几次
    const timers = [60, 250, 600].map(ms => window.setTimeout(() => {
      if (main.scrollTop !== target && main.scrollHeight - main.clientHeight >= target) main.scrollTop = target;
    }, ms));
    return () => timers.forEach(clearTimeout);
  }, [location.key, segment, navType]);

  return (
    <div className="relative flex h-[100dvh] overflow-hidden">
      <Background />
      <NavRail />
      <div className="relative z-10 flex min-w-0 flex-1 flex-col overflow-hidden">
        <VersionBanner />
        <main
          ref={mainRef}
          onScroll={e => positions.current.set(keyRef.current, e.currentTarget.scrollTop)}
          className={cn('relative min-h-0 flex-1', fullBleed ? 'overflow-hidden md:py-3 md:pr-3' : 'overflow-y-auto overflow-x-hidden')}
        >
          <motion.div
            key={segment}
            variants={pageVariants}
            initial={firstRender.current ? false : 'initial'}
            animate="enter"
            className={cn(fullBleed ? 'h-full' : 'mx-auto max-w-[1280px] px-4 pb-28 pt-6 md:px-8 md:pb-10 md:pt-8')}
            data-page-pad={fullBleed ? undefined : ''}
          >
            {/* 每个一级页面独立的错误边界：页面崩溃只显示错误卡片，导航栏仍可用；切换页面自动复位 */}
            <ErrorBoundary resetKey={segment} scope="page" onHome={() => navigate('/dashboard')}>
              <QaCrashProbe segment={segment} />
              {outlet}
            </ErrorBoundary>
          </motion.div>
        </main>
      </div>
      <div className="md:hidden">{!fullBleed && <Fab variant="floating" />}</div>
      <NavBar />
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} onImport={() => { bump(); useAccountStore.getState().fetchAccounts(); }} />
      <ConfirmHost />
      <FetchProgressPanel />
    </div>
  );
}
