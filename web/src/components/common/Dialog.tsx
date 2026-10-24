import { useEffect, useRef, useState } from 'react';
import * as RD from '@radix-ui/react-dialog';
import { motion, PresenceContext, useDragControls, type PanInfo } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { spring } from '../../lib/motion';
import { dialogHistory } from '../../lib/overlayGuard';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ElementType;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  /** 移动端显示为 M3 底部动作面板（默认开启） */
  sheet?: boolean;
}

/** 退出动画最长时长；超过即强制卸载（动画被打断 / 标签页在后台 / 动画库异常时也不会残留遮罩） */
const EXIT_MS = 320;

/**
 * 桌面：M3 基础对话框（缩放淡入）；移动：底部面板（弹簧滑入，可下拉关闭）
 *
 * 挂载/卸载由组件自己的状态机控制，而不是 <AnimatePresence>：
 * framer-motion 11 的 usePresence() 注册后不会在卸载时注销，若对话框内容里有 layout/layoutId
 * 元素（例如 Segmented）在关闭前被卸载（导入对话框「输入 → 预览」就是如此），AnimatePresence
 * 会永远等待它的退出回调——透明的 Radix 遮罩和 body 上的 pointer-events:none / 滚动锁定就一直留着，
 * 整个页面无法点击。这里：
 *   1. open=false 后进入 closing 阶段播放退出动画，onAnimationComplete 或 EXIT_MS 兜底计时器二者
 *      先到者卸载 Portal，保证一定卸载；
 *   2. 内容包在 PresenceContext=null 中，内部的 motion 元素不再向任何外层 AnimatePresence 注册；
 *   3. closing 期间遮罩与面板 pointer-events:none，点击会穿透到下面的页面（body 的锁由
 *      lib/overlayGuard 在没有打开的对话框时立即清理）。
 */
export function Dialog(props: Props) {
  const { open, onOpenChange, className, bodyClassName, sheet = true } = props;
  // 关闭（退出动画）期间冻结内容：调用方常在关闭的同时重置表单状态（如导入对话框回到第一步），
  // 不冻结的话退出动画中会闪现另一套内容
  const snap = useRef(props);
  if (open) snap.current = props;
  const { title, description, icon: Icon, children, footer } = open ? props : snap.current;
  const mobile = useIsMobile();
  const asSheet = sheet && mobile;
  const drag = useDragControls();
  const [mounted, setMounted] = useState(open);
  const closing = mounted && !open;
  useCloseOnBack(open, () => onOpenChange(false));

  useEffect(() => {
    if (open) { setMounted(true); return; }
    if (!mounted) return;
    const t = window.setTimeout(() => setMounted(false), EXIT_MS);
    return () => window.clearTimeout(t);
  }, [open, mounted]);

  const onExitDone = () => { if (!open) setMounted(false); };
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 120 || info.velocity.y > 600) onOpenChange(false);
  };

  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      {mounted && (
        <PresenceContext.Provider value={null}>
          <RD.Portal forceMount>
            <RD.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-50 bg-scrim/40"
                style={closing ? { pointerEvents: 'none' } : undefined}
                initial={{ opacity: 0 }}
                animate={{ opacity: open ? 1 : 0 }}
                transition={{ duration: open ? 0.2 : 0.15 }}
              />
            </RD.Overlay>
            <RD.Content asChild forceMount aria-describedby={undefined} data-closing={closing || undefined}>
              {asSheet ? (
                <motion.div
                  className={cn('sf-low fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-[28px] pb-[env(safe-area-inset-bottom)] shadow-elev-3 outline-none')}
                  style={closing ? { pointerEvents: 'none' } : undefined}
                  initial={{ y: '100%' }}
                  animate={{ y: open ? 0 : '100%' }}
                  transition={open ? { type: 'spring', stiffness: 380, damping: 40 } : { duration: 0.22, ease: [0.3, 0, 0.8, 0.15] }}
                  onAnimationComplete={onExitDone}
                  drag={open ? 'y' : false}
                  dragControls={drag}
                  dragListener={false}
                  dragConstraints={{ top: 0, bottom: 0 }}
                  dragElastic={{ top: 0, bottom: 0.6 }}
                  onDragEnd={onDragEnd}
                >
                  <div className="flex cursor-grab touch-none justify-center pb-1 pt-3 active:cursor-grabbing" onPointerDown={e => drag.start(e)}>
                    <span className="h-1 w-8 rounded-full bg-on-surface-variant/40" />
                  </div>
                  <Header title={title} description={description} icon={Icon} />
                  <div className={cn('flex-1 overflow-y-auto px-5 pb-4', bodyClassName)}>{children}</div>
                  {footer && <div className="flex flex-wrap items-center justify-end gap-2 px-5 pb-5 pt-2">{footer}</div>}
                </motion.div>
              ) : (
                <motion.div
                  className={cn('sf-high fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[calc(100vw-32px)] max-w-lg flex-col rounded-[28px] shadow-elev-3 outline-none', className)}
                  style={closing ? { x: '-50%', y: '-50%', pointerEvents: 'none' } : { x: '-50%', y: '-50%' }}
                  initial={{ opacity: 0, scale: 0.92 }}
                  animate={open ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.95 }}
                  transition={open ? spring : { duration: 0.15 }}
                  onAnimationComplete={onExitDone}
                >
                  <Header title={title} description={description} icon={Icon} closable />
                  <div className={cn('flex-1 overflow-y-auto px-6 pb-4', bodyClassName)}>{children}</div>
                  {footer && <div className="flex flex-wrap items-center justify-end gap-2 px-6 pb-6 pt-2">{footer}</div>}
                </motion.div>
              )}
            </RD.Content>
          </RD.Portal>
        </PresenceContext.Provider>
      )}
    </RD.Root>
  );
}

/**
 * 浏览器/系统「返回」关闭对话框而不是离开页面：打开时压入一条同地址的历史记录，
 * 返回键弹出它时关闭对话框；以按钮/Esc/代码关闭时再把这条记录退掉，保持历史干净。
 * 历史记录的压入/退回统一由 lib/overlayGuard 的 dialogHistory 管理，
 * 能正确处理多个叠加的对话框、以及「关闭对话框后立即 navigate()」的竞态。
 */
function useCloseOnBack(open: boolean, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    return dialogHistory.open(() => closeRef.current());
  }, [open]);
}

function Header({ title, description, icon: Icon, closable }: { title: React.ReactNode; description?: React.ReactNode; icon?: React.ElementType; closable?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 px-6 pb-4 pt-6 max-md:px-5 max-md:pt-2">
      <div className="min-w-0">
        {Icon && <Icon className="mb-3 size-6 text-secondary" />}
        <RD.Title className="text-headline-s text-on-surface">{title}</RD.Title>
        {description ? (
          <RD.Description className="mt-1.5 text-body-m text-on-surface-variant">{description}</RD.Description>
        ) : (
          <RD.Description className="sr-only">{typeof title === 'string' ? title : 'dialog'}</RD.Description>
        )}
      </div>
      {closable && (
        <RD.Close className="-mr-2 -mt-1 flex size-10 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-on-surface/[0.08]" aria-label="关闭">
          <X className="size-5" />
        </RD.Close>
      )}
    </div>
  );
}
