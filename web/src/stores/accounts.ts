import { create } from 'zustand';
import type { Account, ImportRequest, ImportResult, ExportRequest, RefreshResult, BatchRefreshResult } from '../types';
import { toast } from 'sonner';
import { accountApi, isAbortError, isAuthError } from '../lib/api';

/** 列表请求序号：快速输入搜索 / 翻页时，只接受最后一次请求的响应（旧响应晚到会覆盖新结果） */
let listSeq = 0;

interface AccountStore {
  accounts: Account[];
  loading: boolean;
  selectedIds: number[];
  searchQuery: string;
  providerFilter: string;
  statusFilter: string;
  pagination: { page: number; pageSize: number; total: number };
  fetchAccounts: () => Promise<void>;
  refreshAccountsSilent: () => Promise<void>;
  createAccount: (data: Partial<Account>) => Promise<void>;
  updateAccount: (id: number, data: Partial<Account>) => Promise<void>;
  deleteAccount: (id: number) => Promise<void>;
  batchDelete: (ids: number[]) => Promise<void>;
  importAccounts: (req: ImportRequest) => Promise<ImportResult>;
  exportAccounts: (req: ExportRequest) => Promise<string>;
  setSelectedIds: (ids: number[]) => void;
  setSearchQuery: (q: string) => void;
  setProviderFilter: (p: string) => void;
  setStatusFilter: (s: string) => void;
  refreshToken: (id: number) => Promise<RefreshResult>;
  refreshTokens: (ids?: number[]) => Promise<BatchRefreshResult>;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
}

export const useAccountStore = create<AccountStore>((set, get) => ({
  accounts: [],
  loading: false,
  selectedIds: [],
  searchQuery: '',
  providerFilter: '',
  statusFilter: '',
  pagination: { page: 1, pageSize: 20, total: 0 },

  fetchAccounts: async () => {
    const seq = ++listSeq;
    set({ loading: true });
    try {
      const { page, pageSize } = get().pagination;
      const q = { search: get().searchQuery, provider: get().providerFilter, status: get().statusFilter };
      let data = await accountApi.list({ page, pageSize, ...q });
      if (seq !== listSeq) return;
      // 删除最后一页的最后几条后页码越界：回到最后一个有数据的页
      const last = Math.max(1, Math.ceil(data.total / pageSize));
      if (!data.list.length && data.total > 0 && page > last) {
        data = await accountApi.list({ page: last, pageSize, ...q });
        if (seq !== listSeq) return;
      }
      const ids = new Set(data.list.map(a => a.id));
      set(s => ({
        accounts: data.list,
        pagination: { page: data.page, pageSize: data.pageSize, total: data.total },
        // 已删除 / 不在当前页的账户不再算作「已选」
        selectedIds: s.selectedIds.filter(id => ids.has(id)),
      }));
    } catch (e) {
      // 保留上次数据，只提示错误，避免未处理的 Promise 拒绝
      if (seq === listSeq && !isAbortError(e) && !isAuthError(e)) toast.error(`加载账户失败：${(e as Error)?.message || e}`, { id: 'load-accounts' });
    } finally {
      if (seq === listSeq) set({ loading: false });
    }
  },

  refreshAccountsSilent: async () => {
    try {
      const { page, pageSize } = get().pagination;
      const data = await accountApi.list({ page, pageSize, search: get().searchQuery, provider: get().providerFilter, status: get().statusFilter });
      set(state => ({
        accounts: state.accounts.map(acc => {
          const fresh = data.list.find(a => a.id === acc.id);
          return fresh ?? acc;
        }),
      }));
    } catch {
      // 静默失败，不影响用户操作
    }
  },

  createAccount: async (data) => {
    await accountApi.create(data);
    await get().fetchAccounts();
  },

  updateAccount: async (id, data) => {
    const updated = await accountApi.update(id, data);
    set(state => ({
      accounts: state.accounts.map(acc => acc.id === id ? updated : acc),
    }));
  },

  deleteAccount: async (id) => {
    await accountApi.delete(id);
    await get().fetchAccounts();
  },

  batchDelete: async (ids) => {
    await accountApi.batchDelete(ids);
    set({ selectedIds: [] });
    await get().fetchAccounts();
  },

  importAccounts: async (req) => {
    const result = await accountApi.import(req);
    await get().fetchAccounts();
    return result;
  },

  exportAccounts: async (req) => {
    const result = await accountApi.export(req);
    return result.content;
  },

  setSelectedIds: (ids) => set({ selectedIds: ids }),
  // 换筛选 / 翻页都清空选择：「已选 N 项」只针对眼前这一页，避免批量删除 / 导出看不见的账户
  setSearchQuery: (q) => { set(s => ({ searchQuery: q, selectedIds: [], pagination: { ...s.pagination, page: 1 } })); get().fetchAccounts(); },
  setProviderFilter: (p) => { set(s => ({ providerFilter: p, selectedIds: [], pagination: { ...s.pagination, page: 1 } })); get().fetchAccounts(); },
  setStatusFilter: (st) => { set(s => ({ statusFilter: st, selectedIds: [], pagination: { ...s.pagination, page: 1 } })); get().fetchAccounts(); },
  refreshToken: async (id) => {
    const r = await accountApi.refreshToken(id);
    await get().refreshAccountsSilent();
    return r;
  },
  refreshTokens: async (ids) => {
    const r = await accountApi.refreshTokens(ids);
    await get().refreshAccountsSilent();
    return r;
  },
  setPage: (page) => { set(s => ({ selectedIds: [], pagination: { ...s.pagination, page: Math.max(1, page) } })); get().fetchAccounts(); },
  setPageSize: (size) => { set(s => ({ selectedIds: [], pagination: { ...s.pagination, pageSize: size, page: 1 } })); get().fetchAccounts(); },
}));
