import type { Transition, Variants } from 'framer-motion';

/** M3 Expressive 风格弹簧：快速、无过冲（spatial）与轻微过冲（指示器） */
export const spring: Transition = { type: 'spring', stiffness: 520, damping: 42, mass: 0.9 };
export const springSoft: Transition = { type: 'spring', stiffness: 300, damping: 32, mass: 1 };
export const springBouncy: Transition = { type: 'spring', stiffness: 600, damping: 30, mass: 0.8 };

/**
 * 列表错峰入场。长列表（100 封邮件 / 235 个账户）按固定 35ms 错峰时最后一行要 3–8 秒才出现，
 * 快速滚动到底部看到的是一片空白：容器传入 custom={条目数} 时把总错峰时长限制在 ~0.45 秒。
 */
export const listContainer: Variants = {
  hidden: {},
  show: (count?: number) => ({
    transition: { staggerChildren: count && count > 12 ? Math.max(0.002, 0.45 / count) : 0.035, delayChildren: 0.02 },
  }),
};

export const listItem: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: springSoft },
};

/** 页面进入（无退出阶段，见 AppLayout）：M3 emphasized-decelerate 淡入 + 轻微上移 */
export const pageVariants: Variants = {
  initial: { opacity: 0, y: 12 },
  enter: { opacity: 1, y: 0, transition: { y: springSoft, opacity: { duration: 0.2, ease: [0.05, 0.7, 0.1, 1] } } },
};
