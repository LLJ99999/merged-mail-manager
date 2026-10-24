import { create } from 'zustand';
import { applyTokens, buildTokens, tokensToCss, type SchemeVariant } from '../lib/monet';

/** 外观设置：全部保存在 localStorage，不依赖后端 */
export type ThemeMode = 'light' | 'dark' | 'system';
export type SeedSource = 'preset' | 'custom' | 'wallpaper';

interface Persisted {
  mode: ThemeMode;
  seed: string;
  source: SeedSource;
  variant: SchemeVariant;
  showWallpaper: boolean;
  glass: boolean;
  wallpaperSeeds: string[];
}

interface AppearanceStore extends Persisted {
  wallpaper: string | null;
  isDark: boolean;
  setMode: (m: ThemeMode) => void;
  setSeed: (hex: string, source?: SeedSource) => void;
  setVariant: (v: SchemeVariant) => void;
  setWallpaper: (dataUrl: string | null, seeds?: string[]) => boolean;
  setShowWallpaper: (v: boolean) => void;
  setGlass: (v: boolean) => void;
  reset: () => void;
}

const KEY = 'mm-appearance';
const WP_KEY = 'mm-wallpaper';
const CSS_KEY = 'mm-theme-css';

const DEFAULTS: Persisted = {
  mode: 'system',
  seed: '#4285F4',
  source: 'preset',
  variant: 'tonal',
  showWallpaper: true,
  glass: false,
  wallpaperSeeds: [],
};

function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
    // 兼容旧版：theme = light | dark | system
    const legacy = localStorage.getItem('theme') as ThemeMode | null;
    if (legacy) return { ...DEFAULTS, mode: legacy };
  } catch { /* ignore */ }
  return DEFAULTS;
}

const mq = window.matchMedia('(prefers-color-scheme: dark)');
const resolveDark = (mode: ThemeMode) => mode === 'dark' || (mode === 'system' && mq.matches);

function persist(s: Persisted) {
  const { mode, seed, source, variant, showWallpaper, glass, wallpaperSeeds } = s;
  localStorage.setItem(KEY, JSON.stringify({ mode, seed, source, variant, showWallpaper, glass, wallpaperSeeds }));
}

/** 应用到 DOM：dark 类、glass 类、CSS 变量；并缓存亮/暗两套变量供 index.html 首帧使用（无闪烁） */
function apply(s: Persisted & { wallpaper: string | null }, animate: boolean) {
  const dark = resolveDark(s.mode);
  const root = document.documentElement;
  const tokens = buildTokens(s.seed, dark, s.variant);
  applyTokens(tokens, animate, () => {
    root.classList.toggle('dark', dark);
    root.classList.toggle('glass', s.glass);
    root.classList.toggle('has-wallpaper', !!s.wallpaper && s.showWallpaper);
    root.style.colorScheme = dark ? 'dark' : 'light';
  });
  try {
    localStorage.setItem(CSS_KEY, JSON.stringify({
      light: tokensToCss(buildTokens(s.seed, false, s.variant)),
      dark: tokensToCss(buildTokens(s.seed, true, s.variant)),
    }));
  } catch { /* ignore */ }
  return dark;
}

const initial = load();
const initialWallpaper = (() => { try { return localStorage.getItem(WP_KEY); } catch { return null; } })();

export const useAppearance = create<AppearanceStore>((set, get) => {
  const commit = (patch: Partial<AppearanceStore>, animate = true) => {
    const next = { ...get(), ...patch };
    const isDark = apply(next, animate);
    persist(next);
    set({ ...patch, isDark });
  };
  return {
    ...initial,
    wallpaper: initialWallpaper,
    isDark: apply({ ...initial, wallpaper: initialWallpaper }, false),
    setMode: mode => commit({ mode }),
    setSeed: (seed, source = 'custom') => commit({ seed, source }),
    setVariant: variant => commit({ variant }),
    setWallpaper: (dataUrl, seeds) => {
      try {
        if (dataUrl) localStorage.setItem(WP_KEY, dataUrl);
        else localStorage.removeItem(WP_KEY);
      } catch {
        return false;
      }
      const patch: Partial<AppearanceStore> = { wallpaper: dataUrl, wallpaperSeeds: seeds ?? [] };
      if (dataUrl && seeds?.length) Object.assign(patch, { seed: seeds[0], source: 'wallpaper', showWallpaper: true });
      if (!dataUrl && get().source === 'wallpaper') Object.assign(patch, { source: 'preset' });
      commit(patch);
      return true;
    },
    setShowWallpaper: showWallpaper => commit({ showWallpaper }, false),
    setGlass: glass => commit({ glass }, false),
    reset: () => {
      localStorage.removeItem(WP_KEY);
      commit({ ...DEFAULTS, wallpaper: null });
    },
  };
});

mq.addEventListener('change', () => {
  const s = useAppearance.getState();
  if (s.mode === 'system') s.setMode('system');
});
