import { AnimatePresence, motion } from 'framer-motion';
import { RefreshCw, Upload, Plus } from 'lucide-react';
import { useUi, type FabAction } from '../../stores/ui';
import { cn } from '../../lib/utils';
import { useRipple } from '../common/Ripple';
import { springBouncy } from '../../lib/motion';

const ICONS = { fetch: RefreshCw, import: Upload, add: Plus };

export function useFabAction(): FabAction {
  const fab = useUi(s => s.fab);
  const setImportOpen = useUi(s => s.setImportOpen);
  return fab ?? { label: '导入', icon: 'import', onClick: () => setImportOpen(true) };
}

/** M3 FAB：rail 中为 56px 图标 FAB + 标签；移动端为浮动的 extended FAB */
export function Fab({ variant }: { variant: 'rail' | 'floating' }) {
  const a = useFabAction();
  const Icon = ICONS[a.icon];
  const { onPointerDown, ripple } = useRipple();
  const icon = (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={a.icon + (a.busy ? 'b' : '')}
        initial={{ scale: 0.4, opacity: 0, rotate: -90 }}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        exit={{ scale: 0.4, opacity: 0, rotate: 90 }}
        transition={springBouncy}
        className="flex"
      >
        <Icon className={cn('size-6', a.busy && 'animate-[spin_0.9s_linear_infinite]')} />
      </motion.span>
    </AnimatePresence>
  );

  if (variant === 'rail') {
    return (
      <div className="flex flex-col items-center gap-1">
        <motion.button
          type="button"
          title={a.label}
          aria-label={a.label}
          onClick={a.onClick}
          disabled={a.disabled || a.busy}
          onPointerDown={onPointerDown}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.92 }}
          transition={springBouncy}
          className="relative flex size-14 items-center justify-center overflow-hidden rounded-2xl bg-primary-container text-on-primary-container shadow-elev-3 transition-shadow hover:shadow-elev-3 disabled:opacity-80"
        >
          {ripple}
          {icon}
        </motion.button>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={a.label} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} transition={{ duration: 0.15 }} className="text-label-m text-on-surface-variant">
            {a.busy ? '处理中' : a.label}
          </motion.span>
        </AnimatePresence>
      </div>
    );
  }
  return (
    <motion.button
      type="button"
      layout
      onClick={a.onClick}
      disabled={a.disabled || a.busy}
      onPointerDown={onPointerDown}
      whileTap={{ scale: 0.94 }}
      transition={springBouncy}
      className="fixed bottom-[96px] right-4 z-30 flex h-14 items-center gap-3 overflow-hidden rounded-2xl bg-primary-container pl-4 pr-5 text-label-l text-on-primary-container shadow-elev-3"
    >
      {ripple}
      {icon}
      <motion.span layout="position">{a.busy ? '处理中…' : a.label}</motion.span>
    </motion.button>
  );
}
