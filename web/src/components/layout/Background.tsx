import { motion } from 'framer-motion';
import { useAppearance } from '../../stores/appearance';

/** 应用背景：壁纸（可选）或由调色板生成的柔和流动色斑 */
export function Background() {
  const wallpaper = useAppearance(s => s.wallpaper);
  const show = useAppearance(s => s.showWallpaper);
  const drift = (dx: number, dy: number, d: number) => ({
    animate: { x: [0, dx, 0], y: [0, dy, 0] },
    transition: { duration: d, repeat: Infinity, ease: 'easeInOut' as const },
  });
  return (
    <div className="app-bg" aria-hidden>
      {wallpaper && show ? (
        <>
          <div className="wall" style={{ backgroundImage: `url(${wallpaper})` }} />
          <div className="wall-scrim" />
        </>
      ) : (
        <>
          <motion.div className="blob" style={{ left: '-8%', top: '-14%', width: '46vw', height: '46vw', background: 'rgb(var(--primary-container))' }} {...drift(40, 30, 26)} />
          <motion.div className="blob" style={{ right: '-10%', bottom: '-18%', width: '50vw', height: '50vw', background: 'rgb(var(--tertiary-container))' }} {...drift(-50, -30, 30)} />
          <motion.div className="blob" style={{ left: '38%', top: '30%', width: '30vw', height: '30vw', background: 'rgb(var(--secondary-container))', opacity: 0.35 }} {...drift(30, -40, 34)} />
        </>
      )}
    </div>
  );
}
