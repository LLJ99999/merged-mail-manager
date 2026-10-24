import { forwardRef } from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';
import { useRipple } from './Ripple';

export const buttonVariants = cva(
  'relative isolate inline-flex select-none items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-full font-medium transition-[background-color,color,box-shadow] duration-200 ease-emphasized disabled:pointer-events-none disabled:opacity-[0.38] [&_svg]:size-[18px] [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        filled: 'bg-primary text-on-primary shadow-none hover:shadow-elev-1 hover:bg-[color-mix(in_srgb,rgb(var(--primary)),rgb(var(--on-primary))_8%)]',
        tonal: 'bg-secondary-container text-on-secondary-container hover:shadow-elev-1 hover:bg-[color-mix(in_srgb,rgb(var(--secondary-container)),rgb(var(--on-secondary-container))_8%)]',
        outlined: 'text-primary ring-1 ring-inset ring-outline-variant hover:bg-primary/[0.08]',
        text: 'text-primary hover:bg-primary/[0.08]',
        elevated: 'sf-low text-primary shadow-elev-1 hover:shadow-elev-2',
        ghost: 'text-on-surface-variant hover:bg-on-surface/[0.08] hover:text-on-surface',
        danger: 'bg-error-container text-on-error-container hover:bg-[color-mix(in_srgb,rgb(var(--error-container)),rgb(var(--on-error-container))_8%)]',
        // 兼容旧名
        primary: 'bg-primary text-on-primary hover:shadow-elev-1',
        accent: 'bg-primary text-on-primary hover:shadow-elev-1',
        secondary: 'bg-secondary-container text-on-secondary-container hover:shadow-elev-1',
      },
      size: {
        sm: 'h-8 px-3.5 text-label-l [&_svg]:size-4',
        md: 'h-10 px-5 text-label-l',
        lg: 'h-12 px-6 text-title-s',
        icon: 'size-10',
        'icon-sm': 'size-8 [&_svg]:size-[18px]',
      },
    },
    defaultVariants: { variant: 'tonal', size: 'md' },
  },
);

export type ButtonProps = HTMLMotionProps<'button'> & VariantProps<typeof buttonVariants>;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, onPointerDown, children, ...props }, ref) => {
  const { onPointerDown: rp, ripple } = useRipple();
  return (
    <motion.button
      ref={ref}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 600, damping: 30 }}
      className={cn(buttonVariants({ variant, size }), className)}
      onPointerDown={e => { rp(e); onPointerDown?.(e); }}
      {...props}
    >
      {ripple}
      {children as React.ReactNode}
    </motion.button>
  );
});
Button.displayName = 'Button';

/** 标准图标按钮（M3 standard icon button） */
export const IconButton = forwardRef<HTMLButtonElement, ButtonProps & { active?: boolean }>(({ className, active, size = 'icon', variant = 'ghost', ...props }, ref) => (
  <Button ref={ref} size={size} variant={variant} className={cn(active && 'bg-secondary-container text-on-secondary-container', className)} {...props} />
));
IconButton.displayName = 'IconButton';
