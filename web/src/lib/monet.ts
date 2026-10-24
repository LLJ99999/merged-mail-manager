/**
 * Material You「Monet」动态取色引擎
 *
 * 种子色 → HCT → DynamicScheme（TonalSpot / Vibrant / Expressive / Content / Neutral）
 *        → 全量 M3 角色色（primary / secondary / tertiary / error / surface-container-* / on-* …）
 *        → 以 "R G B" 通道写入 CSS 变量，供 Tailwind 的 rgb(var(--x) / <alpha>) 使用。
 * 额外生成与种子色「协调（harmonize）」过的 success / warning 自定义色，以及完整的 13 阶色调板。
 */
import {
  argbFromHex,
  hexFromArgb,
  Hct,
  MaterialDynamicColors as MDC,
  SchemeTonalSpot,
  SchemeVibrant,
  SchemeExpressive,
  SchemeContent,
  SchemeNeutral,
  TonalPalette,
  QuantizerCelebi,
  Score,
  Blend,
  type DynamicScheme,
  type DynamicColor,
} from '@material/material-color-utilities';

export type SchemeVariant = 'tonal' | 'vibrant' | 'expressive' | 'content' | 'neutral';

export const SCHEME_VARIANTS: { value: SchemeVariant; label: string; hint: string }[] = [
  { value: 'tonal', label: '柔和', hint: 'Tonal Spot · Android 12 默认' },
  { value: 'vibrant', label: '鲜艳', hint: 'Vibrant · 高饱和' },
  { value: 'expressive', label: '表现', hint: 'Expressive · 色相偏移' },
  { value: 'content', label: '贴近原色', hint: 'Content · 忠于种子色' },
  { value: 'neutral', label: '中性', hint: 'Neutral · 近乎灰阶' },
];

export const PRESET_SEEDS: { hex: string; name: string }[] = [
  { hex: '#4285F4', name: '湛蓝' },
  { hex: '#00897B', name: '青碧' },
  { hex: '#6750A4', name: '紫罗兰' },
  { hex: '#B3261E', name: '朱砂' },
  { hex: '#E8710A', name: '琥珀' },
  { hex: '#386A20', name: '苔绿' },
  { hex: '#C2185B', name: '莓红' },
  { hex: '#00ACC1', name: '天青' },
];

const ROLES: [string, DynamicColor][] = [
  ['primary', MDC.primary],
  ['on-primary', MDC.onPrimary],
  ['primary-container', MDC.primaryContainer],
  ['on-primary-container', MDC.onPrimaryContainer],
  ['inverse-primary', MDC.inversePrimary],
  ['secondary', MDC.secondary],
  ['on-secondary', MDC.onSecondary],
  ['secondary-container', MDC.secondaryContainer],
  ['on-secondary-container', MDC.onSecondaryContainer],
  ['tertiary', MDC.tertiary],
  ['on-tertiary', MDC.onTertiary],
  ['tertiary-container', MDC.tertiaryContainer],
  ['on-tertiary-container', MDC.onTertiaryContainer],
  ['error', MDC.error],
  ['on-error', MDC.onError],
  ['error-container', MDC.errorContainer],
  ['on-error-container', MDC.onErrorContainer],
  ['surface', MDC.surface],
  ['surface-dim', MDC.surfaceDim],
  ['surface-bright', MDC.surfaceBright],
  ['surface-container-lowest', MDC.surfaceContainerLowest],
  ['surface-container-low', MDC.surfaceContainerLow],
  ['surface-container', MDC.surfaceContainer],
  ['surface-container-high', MDC.surfaceContainerHigh],
  ['surface-container-highest', MDC.surfaceContainerHighest],
  ['surface-variant', MDC.surfaceVariant],
  ['on-surface', MDC.onSurface],
  ['on-surface-variant', MDC.onSurfaceVariant],
  ['inverse-surface', MDC.inverseSurface],
  ['inverse-on-surface', MDC.inverseOnSurface],
  ['outline', MDC.outline],
  ['outline-variant', MDC.outlineVariant],
  ['surface-tint', MDC.surfaceTint],
  ['scrim', MDC.scrim],
  ['shadow', MDC.shadow],
];

export const PALETTE_TONES = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99, 100];

function makeScheme(seed: number, dark: boolean, variant: SchemeVariant, contrast = 0): DynamicScheme {
  const hct = Hct.fromInt(seed);
  switch (variant) {
    case 'vibrant': return new SchemeVibrant(hct, dark, contrast);
    case 'expressive': return new SchemeExpressive(hct, dark, contrast);
    case 'content': return new SchemeContent(hct, dark, contrast);
    case 'neutral': return new SchemeNeutral(hct, dark, contrast);
    default: return new SchemeTonalSpot(hct, dark, contrast);
  }
}

const rgb = (argb: number) => `${(argb >> 16) & 255} ${(argb >> 8) & 255} ${argb & 255}`;

/** 自定义语义色（成功/警告）：与种子色协调后取 M3 容器色阶 */
function customColor(name: string, baseHex: string, seed: number, dark: boolean): Record<string, string> {
  const harmonized = Blend.harmonize(argbFromHex(baseHex), seed);
  const p = TonalPalette.fromInt(harmonized);
  return dark
    ? { [name]: rgb(p.tone(80)), [`on-${name}`]: rgb(p.tone(20)), [`${name}-container`]: rgb(p.tone(30)), [`on-${name}-container`]: rgb(p.tone(90)) }
    : { [name]: rgb(p.tone(40)), [`on-${name}`]: rgb(p.tone(100)), [`${name}-container`]: rgb(p.tone(90)), [`on-${name}-container`]: rgb(p.tone(10)) };
}

export type Tokens = Record<string, string>;

export function buildTokens(seedHex: string, dark: boolean, variant: SchemeVariant = 'tonal'): Tokens {
  const seed = argbFromHex(seedHex);
  const scheme = makeScheme(seed, dark, variant);
  const t: Tokens = {};
  for (const [name, role] of ROLES) t[name] = rgb(role.getArgb(scheme));
  Object.assign(t, customColor('success', '#2E7D32', seed, dark), customColor('warning', '#B26A00', seed, dark));
  return t;
}

/** 完整色调板（用于设置页展示） */
export function buildPalettes(seedHex: string, variant: SchemeVariant = 'tonal') {
  const s = makeScheme(argbFromHex(seedHex), false, variant);
  const pick = (p: TonalPalette) => PALETTE_TONES.map(tone => hexFromArgb(p.tone(tone)));
  return [
    { key: 'primary', label: 'Primary', tones: pick(s.primaryPalette) },
    { key: 'secondary', label: 'Secondary', tones: pick(s.secondaryPalette) },
    { key: 'tertiary', label: 'Tertiary', tones: pick(s.tertiaryPalette) },
    { key: 'neutral', label: 'Neutral', tones: pick(s.neutralPalette) },
    { key: 'neutral-variant', label: 'Neutral Variant', tones: pick(s.neutralVariantPalette) },
  ];
}

/** 将品牌色与当前种子色协调，并返回 M3 容器式前景/背景（用于服务商图块） */
export function harmonizedTile(brandHex: string, seedHex: string, dark: boolean) {
  const p = TonalPalette.fromInt(Blend.harmonize(argbFromHex(brandHex), argbFromHex(seedHex)));
  return dark
    ? { bg: hexFromArgb(p.tone(30)), fg: hexFromArgb(p.tone(90)) }
    : { bg: hexFromArgb(p.tone(90)), fg: hexFromArgb(p.tone(30)) };
}

export function tokensToCss(t: Tokens): string {
  return Object.entries(t).map(([k, v]) => `--${k}:${v}`).join(';');
}

// ------------------------------------------------------------------
// 写入与过渡
// ------------------------------------------------------------------

let current: Tokens | null = null;
let raf = 0;

function write(t: Tokens) {
  const s = document.documentElement.style;
  for (const k in t) s.setProperty(`--${k}`, t[k]);
}

const parse = (v: string) => v.split(' ').map(Number);

/**
 * 应用新配色。优先使用 View Transitions 交叉淡入（合成层完成，零重排）；
 * 不支持时退化为 rAF 在 RGB 空间插值 CSS 变量；prefers-reduced-motion 时直接替换。
 */
let lastApply = 0;

export function applyTokens(next: Tokens, animate = true, mutate?: () => void) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const prev = current;
  current = next;
  cancelAnimationFrame(raf);
  // 连续变化（拖动取色器、快速点选）时不再逐次启动 View Transition：每次都会中断上一次并冻结页面交互，
  // 表现为闪烁/卡顿。此时直接写入，只有间隔较大的离散变化才做交叉淡入。
  const now = performance.now();
  const burst = now - lastApply < 600;
  lastApply = now;
  if (!animate || reduce || !prev || burst) { write(next); mutate?.(); return; }

  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (typeof doc.startViewTransition === 'function') {
    document.documentElement.classList.add('theme-vt');
    const vt = doc.startViewTransition(() => { write(next); mutate?.(); }) as { finished?: Promise<void> };
    vt?.finished?.finally(() => document.documentElement.classList.remove('theme-vt'));
    return;
  }
  mutate?.();
  const from = Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, parse(v)]));
  const to = Object.fromEntries(Object.entries(next).map(([k, v]) => [k, parse(v)]));
  const start = performance.now();
  const dur = 420;
  const step = (now: number) => {
    const x = Math.min(1, (now - start) / dur);
    const e = 1 - Math.pow(1 - x, 3);
    const frame: Tokens = {};
    for (const k in to) {
      const a = from[k] || to[k];
      const b = to[k];
      frame[k] = `${Math.round(a[0] + (b[0] - a[0]) * e)} ${Math.round(a[1] + (b[1] - a[1]) * e)} ${Math.round(a[2] + (b[2] - a[2]) * e)}`;
    }
    write(frame);
    if (x < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}

// ------------------------------------------------------------------
// 壁纸取色：Celebi 量化（Wu + WSMeans）→ Score 排序，取首选种子色
// ------------------------------------------------------------------

export async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  await img.decode();
  return img;
}

/** 与 sourceColorFromImage 相同的算法，但先缩放到 ≤128px 以免在大图上卡顿主线程 */
export function extractSeeds(img: HTMLImageElement, count = 5): string[] {
  const max = 128;
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const pixels: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 255) continue;
    pixels.push(((255 << 24) | (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]) >>> 0);
  }
  const quantized = QuantizerCelebi.quantize(pixels, 128);
  const ranked = Score.score(quantized, { desired: count, fallbackColorARGB: 0xff4285f4, filter: true });
  return ranked.map(c => hexFromArgb(c));
}

/** 将上传的壁纸压缩为 ≤1920px 的 JPEG dataURL，便于存入 localStorage */
export async function compressWallpaper(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const max = 1920;
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export { hexFromArgb, argbFromHex };

/** Android 壁纸取色器式三分色样：primary / secondary / tertiary */
export function seedSwatch(seedHex: string, dark: boolean, variant: SchemeVariant = 'tonal') {
  const s = makeScheme(argbFromHex(seedHex), dark, variant);
  return {
    p: hexFromArgb(s.primaryPalette.tone(dark ? 80 : 40)),
    s: hexFromArgb(s.secondaryPalette.tone(dark ? 70 : 80)),
    t: hexFromArgb(s.tertiaryPalette.tone(dark ? 60 : 70)),
  };
}
