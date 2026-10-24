import { LayoutDashboard, Inbox, Users, Globe, Settings2 } from 'lucide-react';

export const NAV_ITEMS = [
  { to: '/dashboard', icon: LayoutDashboard, label: '概览' },
  { to: '/mail', icon: Inbox, label: '邮件' },
  { to: '/accounts', icon: Users, label: '账户' },
  { to: '/proxy', icon: Globe, label: '代理' },
  { to: '/settings', icon: Settings2, label: '设置' },
];
