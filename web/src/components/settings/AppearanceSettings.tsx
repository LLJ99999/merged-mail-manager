import { useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Sun, Moon, SunMoon, Check, ImagePlus, Trash2, Pipette, RotateCcw, Sparkles, Image as ImageIcon, Inbox, RefreshCw, Star } from 'lucide-react';
import { toast } from 'sonner';
import { useAppearance } from '../../stores/appearance';
import { PRESET_SEEDS, SCHEME_VARIANTS, buildPalettes, compressWallpaper, extractSeeds, loadImage, seedSwatch, PALETTE_TONES } from '../../lib/monet';
import { cn } from '../../lib/utils';
import { springBouncy, spring } from '../../lib/motion';
import { Segmented, Spinner } from '../common/Misc';
import { Switch, Input } from '../common/Input';
import { Button } from '../common/Button';
import { ChannelBadge } from '../common/ChannelBadge';
import { ProviderIcon } from '../common/ProviderIcon';

/** Android 壁纸取色器风格的三分色圆形色样 */
function SeedSwatch({ hex, selected, onClick, title, size = 52 }: { hex: string; selected: boolean; onClick: () => void; title: string; size?: number }) {
  const dark = useAppearance(s => s.isDark);
  const variant = useAppearance(s => s.variant);
  const sw = useMemo(() => seedSwatch(hex, dark, variant), [hex, dark, variant]);
  return (
    <motion.button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={selected}
      onClick={onClick}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.9 }}
      transition={springBouncy}
      className={cn('relative shrink-0 overflow-hidden rounded-full transition-shadow duration-300', selected ? 'shadow-[0_0_0_3px_rgb(var(--surface-container-low)),0_0_0_5px_rgb(var(--primary))]' : '')}
      style={{ width: size, height: size }}
    >
      <span className="absolute inset-x-0 top-0 h-1/2" style={{ background: sw.p }} />
      <span className="absolute bottom-0 left-0 h-1/2 w-1/2" style={{ background: sw.s }} />
      <span className="absolute bottom-0 right-0 h-1/2 w-1/2" style={{ background: sw.t }} />
      <AnimatePresence>
        {selected && (
          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={springBouncy} className="absolute inset-0 m-auto flex size-6 items-center justify-center rounded-full bg-primary-container text-on-primary-container">
            <Check className="size-4" strokeWidth={3} />
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

function Row({ title, desc, children, className }: { title: string; desc?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('py-4 first:pt-0', className)}>
      <div className="mb-3">
        <p className="text-title-s text-on-surface">{title}</p>
        {desc && <p className="mt-0.5 text-body-s text-on-surface-variant">{desc}</p>}
      </div>
      {children}
    </div>
  );
}

export function AppearanceSettings() {
  const a = useAppearance();
  const fileRef = useRef<HTMLInputElement>(null);
  const colorRef = useRef<HTMLInputElement>(null);
  const [hexDraft, setHexDraft] = useState('');
  const [extracting, setExtracting] = useState(false);
  const isPreset = a.source === 'preset' && PRESET_SEEDS.some(p => p.hex.toLowerCase() === a.seed.toLowerCase());

  const onWallpaper = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setExtracting(true);
    try {
      const dataUrl = await compressWallpaper(file);
      const img = await loadImage(dataUrl);
      const seeds = extractSeeds(img, 5);
      if (!a.setWallpaper(dataUrl, seeds)) toast.error('壁纸过大，无法保存到本地存储');
      else toast.success(`已从壁纸提取 ${seeds.length} 个种子色`);
    } catch {
      toast.error('无法读取该图片');
    } finally {
      setExtracting(false);
    }
  };

  const commitHex = () => {
    const v = hexDraft.trim().replace(/^#?/, '#');
    if (/^#[0-9a-f]{6}$/i.test(v)) { a.setSeed(v.toUpperCase(), 'custom'); setHexDraft(''); }
    else if (hexDraft) toast.error('请输入 6 位十六进制颜色，如 #3F51B5');
  };

  return (
    <div className="divide-y divide-outline-variant/40">
      <Row title="主题模式" desc="亮色、暗色均由同一种子色推导">
        <Segmented
          value={a.mode}
          onChange={a.setMode}
          options={[
            { value: 'light', label: <><Sun />亮色</> },
            { value: 'dark', label: <><Moon />暗色</> },
            { value: 'system', label: <><SunMoon />跟随系统</> },
          ]}
        />
      </Row>

      <Row title="种子色" desc="选择预设、自定义颜色，或从壁纸中提取">
        <div className="flex flex-wrap items-center gap-3">
          {PRESET_SEEDS.map(p => (
            <SeedSwatch key={p.hex} hex={p.hex} title={p.name} selected={isPreset && a.seed.toLowerCase() === p.hex.toLowerCase()} onClick={() => a.setSeed(p.hex, 'preset')} />
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <motion.button
            type="button"
            whileTap={{ scale: 0.95 }}
            onClick={() => colorRef.current?.click()}
            className={cn('relative inline-flex h-10 items-center gap-2 rounded-full pl-1.5 pr-4 text-label-l transition-colors', a.source === 'custom' ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface shadow-[inset_0_0_0_1px_rgb(var(--outline-variant))] hover:bg-on-surface/[0.06]')}
          >
            <span className="size-7 rounded-full shadow-[inset_0_0_0_2px_rgb(255_255_255/0.5)]" style={{ background: a.seed }} />
            <Pipette className="size-4" />自定义颜色
            <input ref={colorRef} type="color" value={a.seed} onChange={e => a.setSeed(e.target.value.toUpperCase(), 'custom')} className="pointer-events-none absolute inset-0 opacity-0" tabIndex={-1} aria-hidden />
          </motion.button>
          <Input
            value={hexDraft}
            onChange={e => setHexDraft(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && commitHex()}
            onBlur={commitHex}
            placeholder={a.seed}
            className="tabular h-10 w-32 rounded-full text-center uppercase"
            aria-label="十六进制颜色"
          />
          <span className="text-body-s text-on-surface-variant">当前 <span className="tabular text-on-surface">{a.seed.toUpperCase()}</span> · 来源 {a.source === 'wallpaper' ? '壁纸' : a.source === 'custom' ? '自定义' : '预设'}</span>
        </div>
      </Row>

      <Row title="壁纸取色" desc="上传图片，使用 Celebi 量化 + Score 评分提取种子色（与 Android 12 相同算法），并可作为应用背景">
        <div className="flex flex-col gap-4 sm:flex-row">
          <motion.button
            type="button"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => fileRef.current?.click()}
            className="group relative flex aspect-[16/10] w-full shrink-0 items-center justify-center overflow-hidden rounded-[20px] bg-surface-container-highest sm:w-56"
          >
            {a.wallpaper ? (
              <>
                <img src={a.wallpaper} alt="当前壁纸" className="absolute inset-0 size-full object-cover" />
                <span className="absolute inset-x-2 bottom-2 flex items-center justify-center gap-1.5 rounded-full bg-scrim/45 py-1.5 text-label-m text-white opacity-0 backdrop-blur-md transition-opacity group-hover:opacity-100"><ImagePlus className="size-3.5" />更换壁纸</span>
              </>
            ) : (
              <span className="flex flex-col items-center gap-2 text-on-surface-variant">
                <span className="flex size-11 items-center justify-center rounded-2xl bg-primary-container text-on-primary-container"><ImagePlus className="size-5" /></span>
                <span className="text-label-l">上传壁纸</span>
              </span>
            )}
            {extracting && <span className="absolute inset-0 flex items-center justify-center bg-surface/60"><Spinner /></span>}
          </motion.button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onWallpaper} data-testid="wallpaper-input" />
          <div className="min-w-0 flex-1 space-y-3">
            {a.wallpaperSeeds.length > 0 ? (
              <>
                <p className="text-label-m text-on-surface-variant">从壁纸提取的种子色</p>
                <div className="flex flex-wrap gap-3">
                  {a.wallpaperSeeds.map((h, i) => (
                    <SeedSwatch key={h + i} hex={h} size={44} title={`壁纸色 ${i + 1} · ${h}`} selected={a.source === 'wallpaper' && a.seed.toLowerCase() === h.toLowerCase()} onClick={() => a.setSeed(h, 'wallpaper')} />
                  ))}
                </div>
              </>
            ) : (
              <p className="text-body-s text-on-surface-variant">尚未设置壁纸。推荐使用柔和的渐变或风景图片，Liquid Glass 模式在壁纸上效果最佳。</p>
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <label className="flex items-center gap-3 text-body-m text-on-surface">
                <Switch checked={!!a.wallpaper && a.showWallpaper} onChange={a.setShowWallpaper} disabled={!a.wallpaper} label="显示为背景" />
                显示为应用背景
              </label>
              {a.wallpaper && <Button size="sm" variant="text" onClick={() => a.setWallpaper(null)}><Trash2 />移除壁纸</Button>}
            </div>
          </div>
        </div>
      </Row>

      <Row title="配色风格" desc="同一种子色的不同 Material 方案">
        <div className="flex flex-wrap gap-2">
          {SCHEME_VARIANTS.map(v => {
            const on = a.variant === v.value;
            return (
              <motion.button
                key={v.value}
                type="button"
                whileTap={{ scale: 0.94 }}
                title={v.hint}
                onClick={() => a.setVariant(v.value)}
                className={cn('inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-label-l transition-colors', on ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface-variant shadow-[inset_0_0_0_1px_rgb(var(--outline-variant))] hover:bg-on-surface/[0.06]')}
              >
                {on && <motion.span initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={springBouncy}><Check className="size-4" /></motion.span>}
                {v.label}
              </motion.button>
            );
          })}
        </div>
      </Row>

      <Row title="Liquid Glass" desc="iOS 风格半透明玻璃：背景模糊 + 饱和度增强 + 边缘高光，玻璃色调随 Monet 调色板变化；不支持 backdrop-filter 的浏览器自动退化为实心色调表面">
        <div className="flex items-center justify-between gap-4 rounded-2xl bg-surface-container-highest/60 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-tertiary-container text-on-tertiary-container"><Sparkles className="size-5" /></span>
            <div>
              <p className="text-body-l text-on-surface">启用玻璃效果</p>
              <p className="text-body-s text-on-surface-variant">{a.wallpaper && a.showWallpaper ? '已有壁纸背景，效果最佳' : '建议同时设置壁纸背景'}</p>
            </div>
          </div>
          <Switch checked={a.glass} onChange={a.setGlass} label="Liquid Glass" />
        </div>
      </Row>

      <Row title="色调板" desc="由种子色生成的 5 组 M3 色调板（0 → 100）">
        <Palettes />
        <div className="mt-4">
          <Button size="sm" variant="outlined" onClick={a.reset}><RotateCcw />恢复默认外观</Button>
        </div>
      </Row>
    </div>
  );
}

function Palettes() {
  const seed = useAppearance(s => s.seed);
  const variant = useAppearance(s => s.variant);
  const palettes = useMemo(() => buildPalettes(seed, variant), [seed, variant]);
  return (
    <div className="space-y-2">
      {palettes.map(p => (
        <div key={p.key} className="flex items-center gap-3">
          <span className="w-28 shrink-0 text-label-m text-on-surface-variant">{p.label}</span>
          <div className="flex h-8 flex-1 overflow-hidden rounded-xl">
            {p.tones.map((hex, i) => (
              <span key={i} title={`${p.label} T${PALETTE_TONES[i]} · ${hex}`} className="flex-1" style={{ backgroundColor: hex }} />
            ))}
          </div>
        </div>
      ))}
      <div className="flex gap-3 pl-[124px] text-label-s text-on-surface-variant">
        <div className="flex flex-1 justify-between">{PALETTE_TONES.map(t => <span key={t} className="tabular w-0 flex-1 text-center">{t}</span>)}</div>
      </div>
    </div>
  );
}

/** 实时预览：用当前配色渲染一组典型组件 */
export function ThemePreview() {
  const a = useAppearance();
  const roles = [
    ['Primary', 'bg-primary text-on-primary'],
    ['Secondary', 'bg-secondary text-on-secondary'],
    ['Tertiary', 'bg-tertiary text-on-tertiary'],
    ['Error', 'bg-error text-on-error'],
    ['P-Container', 'bg-primary-container text-on-primary-container'],
    ['S-Container', 'bg-secondary-container text-on-secondary-container'],
    ['T-Container', 'bg-tertiary-container text-on-tertiary-container'],
    ['Surface High', 'bg-surface-container-highest text-on-surface'],
  ];
  return (
    <div className="card sf-low overflow-hidden p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-title-l text-on-surface">实时预览</h2>
        <span className="tabular rounded-full bg-surface-container-highest px-3 py-1 text-label-m text-on-surface-variant">{a.isDark ? '暗色' : '亮色'} · {a.seed.toUpperCase()}</span>
      </div>

      <div className="relative overflow-hidden rounded-[24px] bg-surface p-4">
        {a.wallpaper && a.showWallpaper && <img src={a.wallpaper} alt="" className="absolute inset-0 size-full object-cover opacity-90" />}
        <div className="sf-lowest relative rounded-[20px] p-4">
          <div className="flex items-center gap-3">
            <ProviderIcon provider="outlook" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-title-s text-on-surface">alice.chen@outlook.com</p>
              <div className="mt-1 flex gap-1.5"><ChannelBadge channel="graph" size="sm" /><ChannelBadge channel="cache" size="sm" /></div>
            </div>
            <span className="flex size-12 items-center justify-center rounded-2xl bg-primary-container text-on-primary-container shadow-elev-2"><RefreshCw className="size-5" /></span>
          </div>
          <div className="mt-4 flex items-center gap-2 rounded-2xl bg-secondary-container px-3 py-2.5 text-on-secondary-container">
            <Inbox className="size-4" /><span className="flex-1 text-label-l">收件箱</span><span className="tabular rounded-full bg-primary px-2 text-label-s text-on-primary">3</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="inline-flex h-9 items-center rounded-full bg-primary px-4 text-label-l text-on-primary">Filled</span>
            <span className="inline-flex h-9 items-center rounded-full bg-secondary-container px-4 text-label-l text-on-secondary-container">Tonal</span>
            <span className="inline-flex h-9 items-center rounded-full px-4 text-label-l text-primary shadow-[inset_0_0_0_1px_rgb(var(--outline-variant))]">Outlined</span>
            <span className="inline-flex h-9 items-center gap-1 rounded-lg bg-tertiary-container px-3 text-label-l text-on-tertiary-container"><Star className="size-4" />Chip</span>
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        {roles.map(([name, cls]) => (
          <motion.div key={name} layout transition={spring} className={cn('flex h-14 items-end rounded-2xl px-3 pb-2 text-label-m transition-colors duration-300', cls)}>
            {name}
          </motion.div>
        ))}
      </div>
      <p className="mt-4 flex items-center gap-2 text-body-s text-on-surface-variant"><ImageIcon className="size-4" />所有颜色均以 CSS 变量注入，切换时以 View Transition 交叉淡入。</p>
    </div>
  );
}
