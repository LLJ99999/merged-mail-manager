import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Inbox, Pencil, Trash2, KeyRound, Users, ChevronUp, ChevronDown, Copy } from 'lucide-react';
import { toast } from 'sonner';
import type { Account, Tag } from '../../types';
import { cn, maskText, timeAgo, parseDate, copyText } from '../../lib/utils';
import { Checkbox } from '../common/Input';
import { Badge } from '../common/Badge';
import { ProviderIcon, ProviderBadge } from '../common/ProviderIcon';
import { ChannelBadge } from '../common/ChannelBadge';
import { EmptyState, Skeleton } from '../common/Misc';
import { listContainer, listItem } from '../../lib/motion';
import ContextMenu from './ContextMenu';
import { useAccountBadge } from '../../stores/fetchQueue';
import { AccountFetchBadge } from '../mail/FetchProgressPanel';

type SortKey = 'email' | 'provider' | 'status' | 'token_refreshed_at' | 'last_channel';
type SortDir = 'asc' | 'desc' | null;

export const ALL_COLUMNS = [
  { key: 'index', label: '#', defaultVisible: false },
  { key: 'email', label: '邮箱', defaultVisible: true },
  { key: 'provider', label: '服务商', defaultVisible: true },
  { key: 'password', label: '密码 / 授权码', defaultVisible: true },
  { key: 'tags', label: '标签', defaultVisible: true },
  { key: 'client_id', label: 'Client ID / 主机', defaultVisible: false },
  { key: 'refresh_token', label: 'Refresh Token', defaultVisible: false },
  { key: 'channel', label: '通道', defaultVisible: true },
  { key: 'status', label: '状态', defaultVisible: true },
  { key: 'token_status', label: 'Token', defaultVisible: true },
  { key: 'actions', label: '操作', defaultVisible: true },
] as const;

export const COLUMN_STORAGE_KEY = 'account-visible-columns-v2';

export function getDefaultVisibleColumns(): string[] {
  const saved = localStorage.getItem(COLUMN_STORAGE_KEY);
  if (saved) {
    try { return JSON.parse(saved); } catch { /* ignore */ }
  }
  return ALL_COLUMNS.filter(c => c.defaultVisible).map(c => c.key);
}

interface Props {
  accounts: Account[];
  selectedIds: number[];
  onSelectIds: (ids: number[]) => void;
  onEdit: (account: Account) => void;
  onDelete: (id: number) => void;
  onViewMail: (account: Account, mailbox: 'INBOX' | 'Junk') => void;
  onRefreshToken: (account: Account) => void;
  refreshingIds: number[];
  /** 批量收取状态（账户行邮箱旁显示进度/结果徽标） */
  loading: boolean;
  visibleColumns: string[];
  tags: Tag[];
  onToggleTag: (accountId: number, tagId: number) => void;
  /** 当前页第一行的序号偏移（(page-1) * pageSize），# 列显示全局序号 */
  indexOffset?: number;
}

function Th({ label, sortKey, current, dir, onSort, className }: { label: string; sortKey?: SortKey; current: SortKey | null; dir: SortDir; onSort: (k: SortKey) => void; className?: string }) {
  const active = sortKey && current === sortKey;
  return (
    <th className={cn('h-12 whitespace-nowrap px-3 text-left text-label-m text-on-surface-variant', sortKey && 'cursor-pointer select-none hover:text-on-surface', className)} onClick={() => sortKey && onSort(sortKey)}>
      <span className="inline-flex items-center gap-0.5">
        {label}
        {active && (dir === 'asc' ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />)}
      </span>
    </th>
  );
}

function CopyText({ text, children, className }: { text: string; children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      className={cn('group/copy inline-flex max-w-full items-center gap-1 rounded-md text-left hover:text-primary', className)}
      onClick={async e => { e.stopPropagation(); if (!text) return; (await copyText(text)) ? toast.success('已复制') : toast.error('复制失败：浏览器不允许访问剪贴板'); }}
      title="点击复制"
    >
      <span className="truncate">{children}</span>
      {text && <Copy className="size-3 shrink-0 opacity-0 transition-opacity group-hover/copy:opacity-60" />}
    </button>
  );
}

export function tokenState(account: Account): { tone: 'neutral' | 'success' | 'warning' | 'danger'; label: string; title?: string } {
  if (account.status === 'error') return { tone: 'danger', label: '异常', title: account.last_error };
  if (!account.token_refreshed_at) return { tone: 'neutral', label: '未使用' };
  const days = Math.floor((Date.now() - parseDate(account.token_refreshed_at).getTime()) / 86400000);
  if (days > 80) return { tone: 'danger', label: `${days} 天`, title: '超过 80 天未刷新，refresh_token 可能即将失效' };
  if (days > 60) return { tone: 'warning', label: `${days} 天`, title: '超过 60 天未刷新' };
  return { tone: 'success', label: days === 0 ? '今天' : `${days} 天`, title: `${days} 天前刷新` };
}

export default function AccountTable({ accounts, selectedIds, onSelectIds, onEdit, onDelete, onViewMail, onRefreshToken, refreshingIds, loading, visibleColumns, tags, onToggleTag, indexOffset = 0 }: Props) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [contextMenuRaw, setContextMenu] = useState<{ x: number; y: number; account: Account } | null>(null);
  // 右键菜单读取最新的账户数据（切换标签后勾选状态要立即更新，而不是停留在打开菜单时的快照）
  const contextMenu = contextMenuRaw ? { ...contextMenuRaw, account: accounts.find(a => a.id === contextMenuRaw.account.id) || contextMenuRaw.account } : null;

  const handleSort = (key: SortKey) => {
    if (sortKey !== key) { setSortKey(key); setSortDir('asc'); }
    else if (sortDir === 'asc') setSortDir('desc');
    else { setSortKey(null); setSortDir(null); }
  };

  const sorted = useMemo(() => {
    if (!sortKey || !sortDir) return accounts;
    return [...accounts].sort((a, b) => {
      const cmp = String((a as any)[sortKey] ?? '').localeCompare(String((b as any)[sortKey] ?? ''));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [accounts, sortKey, sortDir]);

  const show = (k: string) => visibleColumns.includes(k);
  // 按成员关系判断（而不是数量），避免选中项与当前页不一致时表头复选框状态错误
  const pageIds = accounts.map(a => a.id);
  const selectedOnPage = pageIds.filter(id => selectedIds.includes(id)).length;
  const allSelected = pageIds.length > 0 && selectedOnPage === pageIds.length;
  const someSelected = selectedOnPage > 0 && !allSelected;
  const toggleAll = () => onSelectIds(allSelected ? selectedIds.filter(id => !pageIds.includes(id)) : [...new Set([...selectedIds, ...pageIds])]);
  const toggleOne = (id: number) => onSelectIds(selectedIds.includes(id) ? selectedIds.filter(i => i !== id) : [...selectedIds, id]);

  if (loading && accounts.length === 0) return <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-2xl" />)}</div>;
  if (accounts.length === 0) return <EmptyState icon={Users} title="暂无账户" description="点击「新增账户」或「导入」添加 Outlook / Gmail / QQ / 163 等邮箱" />;

  const thProps = { current: sortKey, dir: sortDir, onSort: handleSort };

  return (
    <div className="overflow-x-auto px-2 pb-2">
      <table className="w-full min-w-[880px] border-separate border-spacing-0 text-body-m">
        <thead>
          <tr>
            <th className="h-12 w-12 pl-2 pr-0"><Checkbox checked={allSelected} indeterminate={someSelected} onChange={toggleAll} aria-label="全选" /></th>
            {show('index') && <Th label="#" {...thProps} className="w-10" />}
            {show('email') && <Th label="邮箱" sortKey="email" {...thProps} />}
            {show('provider') && <Th label="服务商" sortKey="provider" {...thProps} />}
            {show('password') && <Th label="密码 / 授权码" {...thProps} />}
            {show('tags') && <Th label="标签" {...thProps} />}
            {show('client_id') && <Th label="Client ID / 主机" {...thProps} />}
            {show('refresh_token') && <Th label="Refresh Token" {...thProps} />}
            {show('channel') && <Th label="通道" sortKey="last_channel" {...thProps} />}
            {show('status') && <Th label="状态" sortKey="status" {...thProps} />}
            {show('token_status') && <Th label="Token" sortKey="token_refreshed_at" {...thProps} />}
            {show('actions') && <th className="h-12 w-[156px] pr-3" />}
          </tr>
        </thead>
        <motion.tbody key={accounts.map(a => a.id).join(',')} variants={listContainer} custom={accounts.length} initial="hidden" animate="show">
          {sorted.map((account, index) => {
            const selected = selectedIds.includes(account.id);
            const secret = account.account_type === 'imap' ? account.imap_password : account.password;
            const ts = tokenState(account);
            const refreshing = refreshingIds.includes(account.id);
            return (
              <motion.tr
                key={account.id}
                variants={listItem}
                className={cn('group transition-colors duration-200 [&>td:first-child]:rounded-l-2xl [&>td:last-child]:rounded-r-2xl', selected ? 'bg-secondary-container/70' : 'hover:bg-on-surface/[0.05]')}
                onContextMenu={e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, account }); }}
              >
                <td className="py-2.5 pl-2 pr-0"><Checkbox checked={selected} onChange={() => toggleOne(account.id)} aria-label="选择" /></td>
                {show('index') && <td className="tabular px-3 py-2.5 text-body-s text-on-surface-variant">{indexOffset + index + 1}</td>}
                {show('email') && (
                  <td className="max-w-[280px] px-3 py-2.5">
                    <div className="flex items-center gap-3">
                      <span className="relative">
                        <ProviderIcon provider={account.provider} />
                        <RowFetchBadge id={account.id} />
                      </span>
                      <div className="min-w-0">
                        <CopyText text={account.email} className="font-medium text-on-surface">{account.email}</CopyText>
                        {account.remark && <p className="truncate text-body-s text-on-surface-variant">{account.remark}</p>}
                      </div>
                    </div>
                  </td>
                )}
                {show('provider') && <td className="px-3 py-2.5"><ProviderBadge provider={account.provider} /></td>}
                {show('password') && (
                  <td className="tabular px-3 py-2.5 text-body-m text-on-surface-variant">
                    {secret ? (
                      <span className="group/pwd relative inline-flex">
                        <CopyText text={secret}>
                          <span className="group-hover/pwd:hidden">{maskText(secret, 3)}</span>
                          <span className="hidden text-on-surface group-hover/pwd:inline">{secret}</span>
                        </CopyText>
                      </span>
                    ) : <span className="text-on-surface-variant/50">—</span>}
                  </td>
                )}
                {show('tags') && (
                  <td className="px-3 py-2.5">
                    <div className="flex max-w-[140px] flex-wrap gap-1">
                      {(account.tags || []).map(tag => (
                        <span key={tag.id} title={tag.name} className="inline-flex h-6 max-w-[128px] items-center gap-1.5 whitespace-nowrap rounded-lg bg-surface-container-highest px-2 text-label-m text-on-surface-variant">
                          <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
                          <span className="truncate">{tag.name}</span>
                        </span>
                      ))}
                      {(!account.tags || account.tags.length === 0) && <span className="text-body-s text-on-surface-variant/50">—</span>}
                    </div>
                  </td>
                )}
                {show('client_id') && (
                  <td className="max-w-[200px] px-3 py-2.5 text-body-s text-on-surface-variant">
                    {account.account_type === 'imap'
                      ? <span>{account.imap_host}:{account.imap_port}</span>
                      : <CopyText text={account.client_id}>{account.client_id}</CopyText>}
                  </td>
                )}
                {show('refresh_token') && (
                  <td className="max-w-[200px] px-3 py-2.5 text-body-s text-on-surface-variant">
                    {account.refresh_token ? <CopyText text={account.refresh_token}>{account.refresh_token}</CopyText> : '—'}
                  </td>
                )}
                {show('channel') && (
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col items-start gap-1">
                      <ChannelBadge channel={account.last_channel} />
                      {account.last_channel_at && <span className="px-1 text-label-s text-on-surface-variant">{timeAgo(account.last_channel_at)}</span>}
                    </div>
                  </td>
                )}
                {show('status') && (
                  <td className="px-3 py-2.5">
                    {account.status === 'error'
                      ? <Badge tone="danger" dot title={account.last_error}>异常</Badge>
                      : account.status === 'inactive' ? <Badge dot>停用</Badge> : <Badge tone="success" dot>正常</Badge>}
                  </td>
                )}
                {show('token_status') && (
                  <td className="px-3 py-2.5">
                    <Badge tone={ts.tone} title={ts.title} className="tabular">{ts.label}</Badge>
                  </td>
                )}
                {show('actions') && (
                  <td className="py-2 pr-3">
                    <div className="flex items-center justify-end gap-0.5 opacity-70 transition-opacity group-hover:opacity-100">
                      <IconBtn title="查看邮件" onClick={() => onViewMail(account, 'INBOX')}><Inbox /></IconBtn>
                      <IconBtn title={account.account_type === 'imap' ? '校验登录' : '刷新 Token'} onClick={() => onRefreshToken(account)} disabled={refreshing}>
                        <KeyRound className={cn(refreshing && 'animate-pulse text-primary')} />
                      </IconBtn>
                      <IconBtn title="编辑" onClick={() => onEdit(account)}><Pencil /></IconBtn>
                      <IconBtn title="删除" danger onClick={() => onDelete(account.id)}><Trash2 /></IconBtn>
                    </div>
                  </td>
                )}
              </motion.tr>
            );
          })}
        </motion.tbody>
      </table>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          account={contextMenu.account}
          tags={tags}
          onClose={() => setContextMenu(null)}
          onCopyEmail={() => copyWithToast(contextMenu.account.email, '邮箱已复制')}
          onCopyPassword={() => copyWithToast(contextMenu.account.account_type === 'imap' ? contextMenu.account.imap_password : contextMenu.account.password, '已复制', '该账户没有保存密码')}
          onCopyToken={() => copyWithToast(contextMenu.account.refresh_token, 'Token 已复制', '该账户没有 Refresh Token')}
          onEdit={() => onEdit(contextMenu.account)}
          onRefreshToken={() => onRefreshToken(contextMenu.account)}
          onToggleTag={tagId => onToggleTag(contextMenu.account.id, tagId)}
          onViewMail={mailbox => onViewMail(contextMenu.account, mailbox)}
          onDelete={() => onDelete(contextMenu.account.id)}
        />
      )}
    </div>
  );
}

async function copyWithToast(text: string, ok: string, empty = '没有可复制的内容') {
  if (!text) { toast.message(empty); return; }
  (await copyText(text)) ? toast.success(ok) : toast.error('复制失败：浏览器不允许访问剪贴板');
}

function IconBtn({ children, title, onClick, danger, disabled }: { children: React.ReactNode; title: string; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <motion.button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.88 }}
      className={cn(
        'flex size-9 items-center justify-center rounded-full text-on-surface-variant transition-colors disabled:opacity-60 [&_svg]:size-[18px]',
        danger ? 'hover:bg-error/10 hover:text-error' : 'hover:bg-on-surface/[0.08] hover:text-on-surface',
      )}
    >
      {children}
    </motion.button>
  );
}

/** 收取状态徽标（与邮件页账户栏、列表头部读同一个收取引擎） */
function RowFetchBadge({ id }: { id: number }) {
  return <AccountFetchBadge it={useAccountBadge(id)} />;
}
