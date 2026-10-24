import { create } from 'zustand';

export interface FabAction {
  label: string;
  icon: 'fetch' | 'import' | 'add';
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
}

interface ConfirmRequest {
  title: string;
  message?: string;
  confirmText?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

interface UiStore {
  importOpen: boolean;
  setImportOpen: (v: boolean) => void;
  /** 页面可覆盖全局 FAB（如代理页改为「添加代理」）。邮件页不覆盖：收取入口只在页面内，FAB 保持「导入」 */
  fab: FabAction | null;
  setFab: (f: FabAction | null) => void;
  confirmReq: ConfirmRequest | null;
  setConfirmReq: (r: ConfirmRequest | null) => void;
  /** 账户数据被导入/修改后递增，供各页面重新加载 */
  accountsVersion: number;
  bumpAccounts: () => void;
  /** 最后访问的邮件页地址（含账户/邮件/文件夹），导航栏「邮件」回到这里 */
  lastMailPath: string;
  setLastMailPath: (p: string) => void;
}

export const useUi = create<UiStore>(set => ({
  importOpen: false,
  setImportOpen: importOpen => set({ importOpen }),
  fab: null,
  setFab: fab => set({ fab }),
  confirmReq: null,
  setConfirmReq: confirmReq => set({ confirmReq }),
  accountsVersion: 0,
  bumpAccounts: () => set(s => ({ accountsVersion: s.accountsVersion + 1 })),
  lastMailPath: '/mail',
  setLastMailPath: lastMailPath => set({ lastMailPath }),
}));

/** Promise 风格的 M3 确认对话框，替代 window.confirm */
export function confirmDialog(opts: Omit<ConfirmRequest, 'resolve'> | string): Promise<boolean> {
  const o = typeof opts === 'string' ? { title: opts } : opts;
  return new Promise(resolve => useUi.getState().setConfirmReq({ ...o, resolve }));
}
