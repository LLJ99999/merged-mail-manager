import { useCallback, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

interface R { id: number; x: number; y: number; size: number }
let seq = 0;

/** M3 风格波纹：在按下位置扩散的圆（仅 transform/opacity 动画）。父元素需 relative + overflow-hidden */
export function useRipple() {
  const [ripples, setRipples] = useState<R[]>([]);
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const el = e.currentTarget.getBoundingClientRect();
    const size = Math.hypot(el.width, el.height) * 2;
    const r = { id: ++seq, x: e.clientX - el.left - size / 2, y: e.clientY - el.top - size / 2, size };
    setRipples(rs => [...rs.slice(-3), r]);
  }, []);
  const node = (
    <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
      <AnimatePresence>
        {ripples.map(r => (
          <motion.span
            key={r.id}
            className="absolute rounded-full bg-current"
            style={{ left: r.x, top: r.y, width: r.size, height: r.size }}
            initial={{ scale: 0, opacity: 0.14 }}
            animate={{ scale: 1, opacity: 0 }}
            transition={{ scale: { duration: 0.55, ease: [0.2, 0, 0, 1] }, opacity: { duration: 0.6, ease: 'easeOut', delay: 0.1 } }}
            onAnimationComplete={() => setRipples(rs => rs.filter(x => x.id !== r.id))}
          />
        ))}
      </AnimatePresence>
    </span>
  );
  return { onPointerDown, ripple: node };
}
