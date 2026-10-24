import { useEffect, useState } from 'react';
import { mailPath } from '../lib/mailRoute';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Plus, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAccountStore } from '../stores/accounts';
import { useTagStore } from '../stores/tags';
import type { Account } from '../types';
import AccountToolbar from '../components/accounts/AccountToolbar';
import AccountTable, { getDefaultVisibleColumns, COLUMN_STORAGE_KEY } from '../components/accounts/AccountTable';
import EditAccountDialog from '../components/accounts/EditAccountDialog';
import BackupRestore from '../components/accounts/BackupRestore';
import { PageHeader } from '../components/common/Misc';
import { Button, IconButton } from '../components/common/Button';
import { confirmDialog, useUi } from '../stores/ui';
import { Select } from '../components/common/Input';
import { accountApi } from '../lib/api';
import { downloadBlob } from '../lib/utils';
import { fetchMany } from '../stores/fetchQueue';

export default function Accounts() {
  const {
    accounts, loading, selectedIds, searchQuery, providerFilter, statusFilter, pagination,
    fetchAccounts, createAccount, updateAccount, deleteAccount, batchDelete, exportAccounts,
    setSelectedIds, setSearchQuery, setProviderFilter, setStatusFilter, setPage, setPageSize, refreshToken, refreshTokens,
  } = useAccountStore();
  const { tags, fetchTags, createTag, deleteTag, setAccountTags } = useTagStore();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [editOpen, setEditOpen] = useState(false);
  const [editAccount, setEditAccount] = useState<Account | null>(null);
  const setImportOpen = useUi(s => s.setImportOpen);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(getDefaultVisibleColumns);
  const [refreshingIds, setRefreshingIds] = useState<number[]>([]);
  const [batchRefreshing, setBatchRefreshing] = useState(false);

  /**
   * 账户页唯一的收取入口：有选中时「收取选中 (n)」，否则「收取全部 (n)」（当前搜索 / 服务商 / 状态筛选下的全部账户，不限于当前页）。
   * 两种都交给收取引擎；运行中再点击 = 追加，已在队列中的账户不会重复。
   */
  const handleFetchScope = async () => {
    if (selectedIds.length) {
      const picked = selectedIds.map(id => accounts.find(a => a.id === id)).filter((a): a is Account => !!a);
      await fetchMany(picked.map(a => ({ id: a.id, email: a.email, provider: a.provider })));
      return;
    }
    try {
      const all = await accountApi.list({ page: 1, pageSize: 10000, search: searchQuery, provider: providerFilter, status: statusFilter });
      await fetchMany(all.list.map(a => ({ id: a.id, email: a.email, provider: a.provider })));
    } catch (e: any) {
      toast.error(e?.message || '加载账户失败');
    }
  };

  useEffect(() => {
    const st = params.get('status');
    if (st && st !== statusFilter) setStatusFilter(st);
    else fetchAccounts();
    fetchTags();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (editAccount) {
      const fresh = accounts.find(a => a.id === editAccount.id);
      if (fresh && fresh !== editAccount) setEditAccount(fresh);
    }
  }, [accounts]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleColumnsChange = (cols: string[]) => {
    setVisibleColumns(cols);
    localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(cols));
  };

  const handleSave = async (data: Partial<Account>) => {
    try {
      if (editAccount) { await updateAccount(editAccount.id, data); toast.success('账户已更新'); }
      else { await createAccount(data); toast.success('账户已添加'); }
    } catch (e: any) {
      toast.error(e.message || '操作失败');
      throw e;
    }
  };

  const handleDelete = async (id: number) => {
    if (!(await confirmDialog({ title: '删除该账户？', message: '其缓存邮件也会一并删除。', confirmText: '删除', danger: true }))) return;
    try { await deleteAccount(id); toast.success('已删除'); } catch (e: any) { toast.error(e.message || '删除失败'); }
  };

  const handleDeleteSelected = async () => {
    if (!(await confirmDialog({ title: `删除选中的 ${selectedIds.length} 个账户？`, message: '其缓存邮件也会一并删除，此操作不可撤销。', confirmText: '删除', danger: true }))) return;
    try { await batchDelete(selectedIds); toast.success(`已删除 ${selectedIds.length} 个账户`); } catch (e: any) { toast.error(e.message || '批量删除失败'); }
  };

  const handleExport = async (ids?: number[]) => {
    try {
      const content = await exportAccounts({ ids });
      if (!content.trim()) { toast.message('没有可导出的账户'); return; }
      downloadBlob(new Blob([content], { type: 'text/plain;charset=utf-8' }), `accounts_${new Date().toISOString().slice(0, 10)}.txt`);
      toast.success('已导出（每种账户使用其原生导入格式）');
    } catch (e: any) {
      toast.error(e.message || '导出失败');
    }
  };

  const handleRefreshToken = async (account: Account) => {
    setRefreshingIds(ids => [...ids, account.id]);
    try {
      const r = await refreshToken(account.id);
      if (r.success) toast.success(`${account.email} ${account.account_type === 'imap' ? '登录校验通过' : `Token 已刷新（${r.channel === 'graph' ? 'Graph' : 'IMAP'}${r.rotated ? '，已保存新 refresh_token' : ''}）`}`);
      else toast.error(`${account.email}: ${r.error}`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setRefreshingIds(ids => ids.filter(i => i !== account.id));
    }
  };

  const handleRefreshSelected = async () => {
    setBatchRefreshing(true);
    setRefreshingIds(selectedIds);
    try {
      const r = await refreshTokens(selectedIds);
      toast[r.failed ? 'warning' : 'success'](`Token 刷新：成功 ${r.success} / 失败 ${r.failed}`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBatchRefreshing(false);
      setRefreshingIds([]);
    }
  };

  const handleToggleTag = async (accountId: number, tagId: number) => {
    const account = accounts.find(a => a.id === accountId);
    if (!account) return;
    const current = (account.tags || []).map(t => t.id);
    const next = current.includes(tagId) ? current.filter(id => id !== tagId) : [...current, tagId];
    try { await setAccountTags(accountId, next); await fetchAccounts(); } catch (e: any) { toast.error(e.message || '标签操作失败'); }
  };

  const totalPages = Math.max(1, Math.ceil(pagination.total / pagination.pageSize));

  return (
    <div>
      <PageHeader
        title="账户"
        description={`${pagination.total} 个邮箱账户 · Outlook OAuth 与 IMAP 混合管理`}
        actions={
          <>
            <BackupRestore />
            <Button variant="filled" onClick={() => { setEditAccount(null); setEditOpen(true); }}><Plus />新增账户</Button>
          </>
        }
      />

      <div className="card sf-low overflow-visible">
        <AccountToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          providerFilter={providerFilter}
          onProviderChange={setProviderFilter}
          statusFilter={statusFilter}
          onStatusChange={setStatusFilter}
          selectedCount={selectedIds.length}
          onClearSelection={() => setSelectedIds([])}
          onImport={() => setImportOpen(true)}
          onExportSelected={() => handleExport(selectedIds)}
          onExportAll={() => handleExport()}
          onRefreshSelected={handleRefreshSelected}
          onDeleteSelected={handleDeleteSelected}
          batchRefreshing={batchRefreshing}
          onFetchScope={handleFetchScope}
          filteredTotal={pagination.total}
          visibleColumns={visibleColumns}
          onColumnsChange={handleColumnsChange}
        />
        <AccountTable
          accounts={accounts}
          selectedIds={selectedIds}
          onSelectIds={setSelectedIds}
          onEdit={a => { setEditAccount(a); setEditOpen(true); }}
          onDelete={handleDelete}
          onViewMail={(a, box) => navigate(mailPath(a.id, null, box))}
          onRefreshToken={handleRefreshToken}
          refreshingIds={refreshingIds}
          loading={loading}
          visibleColumns={visibleColumns}
          tags={tags}
          onToggleTag={handleToggleTag}
          indexOffset={(pagination.page - 1) * pagination.pageSize}
        />
        <div className="flex items-center justify-between px-5 pb-4 pt-1 text-body-m text-on-surface-variant">
          <div className="flex items-center gap-2">
            <span>每页</span>
            <Select value={pagination.pageSize} onChange={e => setPageSize(Number(e.target.value))} className="h-9 w-[76px] rounded-full">
              {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
            </Select>
            <span className="hidden sm:inline">共 {pagination.total} 条</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="tabular mr-2">{pagination.page} / {totalPages}</span>
            <IconButton variant="outlined" onClick={() => setPage(pagination.page - 1)} disabled={pagination.page <= 1} aria-label="上一页"><ChevronLeft /></IconButton>
            <IconButton variant="outlined" onClick={() => setPage(pagination.page + 1)} disabled={pagination.page >= totalPages} aria-label="下一页"><ChevronRight /></IconButton>
          </div>
        </div>
      </div>

      <EditAccountDialog
        open={editOpen}
        account={editAccount}
        onClose={() => setEditOpen(false)}
        onSave={handleSave}
        tags={tags}
        accountTagIds={editAccount ? ((accounts.find(a => a.id === editAccount.id) || editAccount).tags || []).map(t => t.id) : []}
        onTagToggle={editAccount ? tagId => handleToggleTag(editAccount.id, tagId) : undefined}
        onCreateTag={async name => { try { await createTag(name); } catch (e: any) { toast.error(e.message || '创建标签失败'); } }}
        onDeleteTag={async id => { try { await deleteTag(id); await fetchAccounts(); } catch (e: any) { toast.error(e.message || '删除标签失败'); } }}
      />
    </div>
  );
}
