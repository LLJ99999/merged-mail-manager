import { useState, useRef, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Search, Upload, Download, Trash2, KeyRound, Columns3, X, Check } from 'lucide-react';
import { FetchScopeButton } from '../mail/FetchButton';
import { ALL_COLUMNS } from './AccountTable';
import { Button, IconButton } from '../common/Button';
import { Input, Select, Checkbox } from '../common/Input';
import { PROVIDERS, cn } from '../../lib/utils';
import { spring } from '../../lib/motion';

interface Props {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  providerFilter: string;
  onProviderChange: (p: string) => void;
  statusFilter: string;
  onStatusChange: (s: string) => void;
  selectedCount: number;
  onClearSelection: () => void;
  onImport: () => void;
  onExportSelected: () => void;
  onExportAll: () => void;
  onRefreshSelected: () => void;
  onDeleteSelected: () => void;
  batchRefreshing: boolean;
  /** 收取：有选中时作用于选中的账户，否则作用于当前筛选下的全部账户（同一个按钮，见 FetchScopeButton） */
  onFetchScope: () => void;
  filteredTotal: number;
  visibleColumns: string[];
  onColumnsChange: (cols: string[]) => void;
}

function ColumnSettings({ visibleColumns, onColumnsChange }: { visibleColumns: string[]; onColumnsChange: (cols: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const toggle = (key: string) => onColumnsChange(visibleColumns.includes(key) ? visibleColumns.filter(k => k !== key) : [...visibleColumns, key]);
  return (
    <div className="relative" ref={ref}>
      <IconButton variant="outlined" onClick={() => setOpen(!open)} title="显示列" aria-label="显示列" active={open}><Columns3 /></IconButton>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4, transition: { duration: 0.12 } }}
            transition={spring}
            style={{ transformOrigin: 'top right' }}
            className="sf-high absolute right-0 top-full z-50 mt-2 w-56 rounded-2xl p-2 shadow-elev-2"
          >
            <p className="px-3 pb-1 pt-1.5 text-label-m text-on-surface-variant">显示列</p>
            {ALL_COLUMNS.map(col => (
              <label key={col.key} className="flex h-10 cursor-pointer items-center gap-1 rounded-xl pr-3 text-body-m hover:bg-on-surface/[0.06]">
                <Checkbox checked={visibleColumns.includes(col.key)} onChange={() => toggle(col.key)} />
                {col.label}
              </label>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const STATUS = [
  { value: '', label: '全部' },
  { value: 'active', label: '正常' },
  { value: 'error', label: '异常' },
  { value: 'inactive', label: '停用' },
];

export default function AccountToolbar(p: Props) {
  const [q, setQ] = useState(p.searchQuery);
  useEffect(() => {
    const t = setTimeout(() => { if (q !== p.searchQuery) p.onSearchChange(q); }, 250);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative min-h-[64px] px-4 pb-2 pt-4">
      <AnimatePresence mode="popLayout" initial={false}>
        {p.selectedCount > 0 ? (
          <motion.div
            key="sel"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={spring}
            className="flex min-h-12 flex-wrap items-center gap-2 rounded-2xl bg-secondary-container py-1.5 pl-1.5 pr-2 text-on-secondary-container"
          >
            <IconButton size="icon-sm" onClick={p.onClearSelection} title="取消选择" aria-label="取消选择" className="text-on-secondary-container"><X /></IconButton>
            <span className="text-title-s">已选 {p.selectedCount} 项</span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <FetchScopeButton variant="filled" size="sm" label="收取选中" count={p.selectedCount} onClick={p.onFetchScope} testId="batch-fetch-selected" />
              <Button size="sm" variant="elevated" onClick={p.onRefreshSelected} disabled={p.batchRefreshing}>
                <KeyRound className={p.batchRefreshing ? 'animate-pulse' : ''} />{p.batchRefreshing ? '刷新中…' : '刷新 Token'}
              </Button>
              <Button size="sm" variant="elevated" onClick={p.onExportSelected}><Download />导出</Button>
              <Button size="sm" variant="danger" onClick={p.onDeleteSelected}><Trash2 />删除</Button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="filters"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={spring}
            className="flex flex-wrap items-center gap-2"
          >
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-on-surface-variant" />
              <Input value={q} onChange={e => setQ(e.target.value)} placeholder="搜索邮箱或备注" className="h-10 rounded-full pl-10" />
            </div>
            <Select value={p.providerFilter} onChange={e => p.onProviderChange(e.target.value)} className="h-10 w-auto min-w-[136px] rounded-full">
              <option value="">全部服务商</option>
              {PROVIDERS.map(pr => <option key={pr.key} value={pr.key}>{pr.label}</option>)}
            </Select>
            <div className="flex items-center gap-1.5">
              {STATUS.map(s => {
                const on = p.statusFilter === s.value;
                return (
                  <motion.button
                    key={s.value}
                    layout
                    whileTap={{ scale: 0.94 }}
                    onClick={() => p.onStatusChange(s.value)}
                    className={cn(
                      'inline-flex h-8 items-center gap-1 rounded-lg px-3 text-label-l transition-colors',
                      on ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface-variant shadow-[inset_0_0_0_1px_rgb(var(--outline-variant))] hover:bg-on-surface/[0.06]',
                    )}
                  >
                    {on && <Check className="size-4" />}
                    {s.label}
                  </motion.button>
                );
              })}
            </div>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              <FetchScopeButton label="收取全部" count={p.filteredTotal} onClick={p.onFetchScope} disabled={!p.filteredTotal} testId="batch-fetch-all" />
              <Button variant="tonal" onClick={p.onImport}><Upload />导入</Button>
              <Button variant="outlined" onClick={p.onExportAll} disabled={!p.filteredTotal} title="导出全部账户（原生导入格式）"><Download />导出</Button>
              <ColumnSettings visibleColumns={p.visibleColumns} onColumnsChange={p.onColumnsChange} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
