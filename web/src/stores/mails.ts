import { create } from 'zustand';
import type { MailMessage } from '../types';
import { mailApi } from '../lib/api';
import { useAccountStore } from './accounts';
import type { Box } from '../lib/mailRoute';

/**
 * 邮件状态。账户 / 文件夹 / 选中的邮件以 URL 为准（见 pages/Mail.tsx 与 lib/mailRoute.ts），
 * 这里只缓存数据并由页面根据 URL 调用 openFolder / selectMailById 同步。
 */
interface MailStore {
  currentAccountId: number | null;
  currentMailbox: Box;
  mails: MailMessage[];
  selectedMail: MailMessage | null;
  /** URL 中请求的邮件 id（详情尚未返回时 selectedMail 可能为空） */
  wantedMailId: number | null;
  detailLoading: boolean;
  loading: boolean;
  // 「收取」的状态与结果都在 stores/fetchQueue（唯一的收取引擎）；任务结束时它调用 fetchCachedMails 刷新正在显示的列表
  /** 当前文件夹本地缓存的邮件总数（列表底部「加载更多」） */
  mailsTotal: number;
  loadingMore: boolean;
  loadMoreMails: () => Promise<void>;
  /** 切换到某账户的某文件夹：同一文件夹只在后台刷新缓存列表，不清空 */
  openFolder: (accountId: number | null, box: Box) => void;
  fetchCachedMails: (accountId: number, mailbox: string) => Promise<void>;
  clearMailbox: (accountId: number, mailbox: string, proxyId?: number) => Promise<void>;
  /** 选中后立即展示缓存内容，再按通道/ID 模式拉取详情与附件列表；返回 false 表示邮件不存在 */
  selectMailById: (id: number | null) => Promise<boolean>;
}

const PAGE = 100;

export const useMailStore = create<MailStore>((set, get) => ({
  currentAccountId: null,
  currentMailbox: 'INBOX',
  mails: [],
  selectedMail: null,
  wantedMailId: null,
  detailLoading: false,
  loading: false,
  mailsTotal: 0,
  loadingMore: false,

  openFolder: (accountId, box) => {
    const s = get();
    if (!accountId) {
      if (s.currentAccountId || s.loading) set({ currentAccountId: null, mails: [], mailsTotal: 0, selectedMail: null, wantedMailId: null, loading: false });
      return;
    }
    if (s.currentAccountId !== accountId || s.currentMailbox !== box) {
      set({ currentAccountId: accountId, currentMailbox: box, mails: [], mailsTotal: 0, selectedMail: null, wantedMailId: null, loading: true });
    }
    get().fetchCachedMails(accountId, box).catch(() => { /* 页面显示空列表 */ });
  },

  fetchCachedMails: async (accountId, mailbox) => {
    if (!get().mails.length) set({ loading: true });
    try {
      // 已经「加载更多」过：刷新时保持已加载的数量
      const data = await mailApi.cached({ account_id: accountId, mailbox, pageSize: Math.max(PAGE, Math.ceil(get().mails.length / PAGE) * PAGE) });
      // 只接受仍是当前账户 + 当前文件夹的响应，避免快速切换时旧响应覆盖新列表
      if (get().currentAccountId !== accountId || get().currentMailbox !== mailbox) return;
      const { wantedMailId, selectedMail } = get();
      const list = wantedMailId ? data.list.map(m => (m.id === wantedMailId && !m.is_read ? { ...m, is_read: true } : m)) : data.list;
      const patch: Partial<MailStore> = { mails: list, mailsTotal: data.total };
      if (wantedMailId && !selectedMail) patch.selectedMail = list.find(m => m.id === wantedMailId) || null;
      set(patch);
    } finally {
      // 切换账户 / 文件夹后旧请求结束时不要关掉新请求的加载状态
      if (get().currentAccountId === accountId && get().currentMailbox === mailbox) set({ loading: false });
    }
  },

  loadMoreMails: async () => {
    const { currentAccountId: accountId, currentMailbox: mailbox, mails, loadingMore, mailsTotal } = get();
    if (!accountId || loadingMore || mails.length >= mailsTotal) return;
    set({ loadingMore: true });
    try {
      const data = await mailApi.cached({ account_id: accountId, mailbox, pageSize: mails.length + PAGE });
      if (get().currentAccountId !== accountId || get().currentMailbox !== mailbox) return;
      const read = new Set(get().mails.filter(m => m.is_read).map(m => m.id));
      set({ mails: data.list.map(m => (read.has(m.id) && !m.is_read ? { ...m, is_read: true } : m)), mailsTotal: data.total });
    } finally {
      set({ loadingMore: false });
    }
  },

  clearMailbox: async (accountId, mailbox, proxyId) => {
    await mailApi.clear({ account_id: accountId, mailbox, proxy_id: proxyId });
    // 清空期间用户可能已切到别的账户 / 文件夹：只清空仍在显示的那个列表
    if (get().currentAccountId === accountId && get().currentMailbox === mailbox) set({ mails: [], mailsTotal: 0, selectedMail: null, wantedMailId: null });
    useAccountStore.getState().refreshAccountsSilent();
  },

  selectMailById: async id => {
    if (!id) {
      set({ selectedMail: null, wantedMailId: null, detailLoading: false });
      return true;
    }
    if (get().wantedMailId === id && get().selectedMail?.id === id) return true;
    const cached = get().mails.find(m => m.id === id) || null;
    // 打开即标记已读（本地列表 + 未读计数立即更新；服务端在详情接口里同步写入缓存）
    set(s => ({ wantedMailId: id, selectedMail: cached ? { ...cached, is_read: true } : null, detailLoading: true, mails: s.mails.map(m => (m.id === id && !m.is_read ? { ...m, is_read: true } : m)) }));
    try {
      const detail = await mailApi.detail(id);
      if (get().wantedMailId !== id) return true;
      set(s => ({
        selectedMail: { ...detail, is_read: true },
        mails: s.mails.map(m => (m.id === detail.id ? { ...m, ...detail, is_read: true } : m)),
      }));
      return true;
    } catch {
      // 详情失败：有缓存则保留缓存内容；连缓存都没有说明邮件不存在
      return get().wantedMailId !== id || !!get().selectedMail;
    } finally {
      if (get().wantedMailId === id) set({ detailLoading: false });
    }
  },
}));
