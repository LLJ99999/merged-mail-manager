/** @type {import('tailwindcss').Config} */
const c = name => `rgb(var(--${name}) / <alpha-value>)`;

// Material 3 角色色（由 src/lib/monet.ts 依据种子色生成并写入 CSS 变量）
const roles = [
  'primary', 'on-primary', 'primary-container', 'on-primary-container', 'inverse-primary',
  'secondary', 'on-secondary', 'secondary-container', 'on-secondary-container',
  'tertiary', 'on-tertiary', 'tertiary-container', 'on-tertiary-container',
  'error', 'on-error', 'error-container', 'on-error-container',
  'success', 'on-success', 'success-container', 'on-success-container',
  'warning', 'on-warning', 'warning-container', 'on-warning-container',
  'surface', 'surface-dim', 'surface-bright', 'surface-variant',
  'surface-container-lowest', 'surface-container-low', 'surface-container', 'surface-container-high', 'surface-container-highest',
  'on-surface', 'on-surface-variant', 'inverse-surface', 'inverse-on-surface',
  'outline', 'outline-variant', 'surface-tint', 'scrim', 'shadow',
];

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ...Object.fromEntries(roles.map(r => [r, c(r)])),
        // 语义别名（保持与旧代码兼容）
        background: c('surface'),
        foreground: c('on-surface'),
        border: c('outline-variant'),
        muted: { DEFAULT: c('surface-container-high'), foreground: c('on-surface-variant') },
        accent: { DEFAULT: c('primary'), foreground: c('on-primary') },
        danger: c('error'),
        ring: c('primary'),
      },
      fontFamily: {
        sans: ['"Roboto Flex Variable"', 'Roboto', '"Noto Sans SC"', '"PingFang SC"', '"Microsoft YaHei"', '"Noto Sans CJK SC"', 'system-ui', 'sans-serif'],
        mono: ['"Roboto Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      // M3 type scale
      fontSize: {
        'display-s': ['36px', { lineHeight: '44px', fontWeight: '400' }],
        'headline-l': ['32px', { lineHeight: '40px', fontWeight: '400' }],
        'headline-m': ['28px', { lineHeight: '36px', fontWeight: '400' }],
        'headline-s': ['24px', { lineHeight: '32px', fontWeight: '400' }],
        'title-l': ['22px', { lineHeight: '28px', fontWeight: '400' }],
        'title-m': ['16px', { lineHeight: '24px', fontWeight: '500', letterSpacing: '0.15px' }],
        'title-s': ['14px', { lineHeight: '20px', fontWeight: '500', letterSpacing: '0.1px' }],
        'body-l': ['16px', { lineHeight: '24px', letterSpacing: '0.5px' }],
        'body-m': ['14px', { lineHeight: '20px', letterSpacing: '0.25px' }],
        'body-s': ['12px', { lineHeight: '16px', letterSpacing: '0.4px' }],
        'label-l': ['14px', { lineHeight: '20px', fontWeight: '500', letterSpacing: '0.1px' }],
        'label-m': ['12px', { lineHeight: '16px', fontWeight: '500', letterSpacing: '0.5px' }],
        'label-s': ['11px', { lineHeight: '16px', fontWeight: '500', letterSpacing: '0.5px' }],
      },
      borderRadius: {
        xs: '4px', sm: '8px', md: '12px', lg: '16px', xl: '20px', '2xl': '24px', '3xl': '28px',
      },
      boxShadow: {
        'elev-1': '0 1px 2px rgb(var(--shadow) / 0.18), 0 1px 3px 1px rgb(var(--shadow) / 0.08)',
        'elev-2': '0 1px 2px rgb(var(--shadow) / 0.18), 0 2px 6px 2px rgb(var(--shadow) / 0.10)',
        'elev-3': '0 4px 8px 3px rgb(var(--shadow) / 0.10), 0 1px 3px rgb(var(--shadow) / 0.18)',
      },
      transitionTimingFunction: {
        emphasized: 'cubic-bezier(0.2, 0, 0, 1)',
      },
    },
  },
  plugins: [],
};
