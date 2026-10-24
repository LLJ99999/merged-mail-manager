import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Copy, Pencil, Inbox, ShieldAlert, Trash2, KeyRound, Check } from 'lucide-react';
import type { Account, Tag } from '../../types';
import { cn } from '../../lib/utils';
import { spring } from '../../lib/motion';

interface Props {
  x: number;
  y: number;
  account: Account;
  tags: Tag[];
  onClose: () => void;
  onCopyEmail: () => void;
  onCopyPassword: () => void;
  onCopyToken: () => void;
  onEdit: () => void;
  onRefreshToken: () => void;
  onToggleTag: (tagId: number) => void;
  onViewMail: (mailbox: 'INBOX' | 'Junk') => void;
  onDelete: () => void;
}

export default function ContextMenu({ x, y, account, tags, onClose, onCopyEmail, onCopyPassword, onCopyToken, onEdit, onRefreshToken, onToggleTag, onViewMail, onDelete }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const accountTagIds = (account.tags || []).map(t => t.id);

  useEffect(() => {
    const close = () => onClose();
    const onScroll = (e: Event) => { if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return; onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('click', close);
    document.addEventListener('keydown', key);
    // 滚动 / 改变窗口大小 / 切到别的窗口时关闭，避免菜单悬浮在错位的位置
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      document.removeEventListener('click', close); document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', close); window.removeEventListener('blur', close);
    };
  }, [onClose]);

  useEffect(() => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    if (r.right > window.innerWidth) ref.current.style.left = `${x - r.width}px`;
    if (r.bottom > window.innerHeight) ref.current.style.top = `${Math.max(8, y - r.height)}px`;
  }, [x, y]);

  const isImap = account.account_type === 'imap';
  const groups: { label: string; icon: React.ElementType; onClick: () => void; danger?: boolean; hidden?: boolean }[][] = [
    [
      { label: '复制邮箱', icon: Copy, onClick: onCopyEmail },
      { label: isImap ? '复制授权码' : '复制密码', icon: Copy, onClick: onCopyPassword },
      { label: '复制 Refresh Token', icon: Copy, onClick: onCopyToken, hidden: isImap },
    ],
    [
      { label: '查看收件箱', icon: Inbox, onClick: () => onViewMail('INBOX') },
      { label: '查看垃圾箱', icon: ShieldAlert, onClick: () => onViewMail('Junk') },
      { label: isImap ? '校验登录' : '刷新 Token', icon: KeyRound, onClick: onRefreshToken },
      { label: '编辑', icon: Pencil, onClick: onEdit },
    ],
    [{ label: '删除', icon: Trash2, onClick: onDelete, danger: true }],
  ];

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.88 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={spring}
      role="menu"
      className="sf-high fixed z-[80] max-h-[calc(100vh-16px)] min-w-[212px] origin-top-left overflow-y-auto rounded-2xl py-2 shadow-elev-2"
      style={{ left: x, top: y }}
      onClick={e => e.stopPropagation()}
    >
      {groups.map((g, gi) => (
        <div key={gi} className={cn(gi > 0 && 'mt-1 pt-1 shadow-[inset_0_1px_0_rgb(var(--outline-variant)/0.6)]')}>
          {g.filter(i => !i.hidden).map(item => (
            <button
              key={item.label}
              onClick={() => { item.onClick(); onClose(); }}
              className={cn('flex h-10 w-full items-center gap-3 px-4 text-left text-body-m transition-colors', item.danger ? 'text-error hover:bg-error/10' : 'text-on-surface hover:bg-on-surface/[0.08]')}
            >
              <item.icon className="size-[18px] text-on-surface-variant" />
              {item.label}
            </button>
          ))}
        </div>
      ))}
      {tags.length > 0 && (
        <div className="mt-1 pt-1 shadow-[inset_0_1px_0_rgb(var(--outline-variant)/0.6)]">
          <p className="px-4 py-1.5 text-label-m text-on-surface-variant">标签</p>
          {tags.map(tag => (
            <button key={tag.id} onClick={() => onToggleTag(tag.id)} className="flex h-10 w-full items-center gap-3 px-4 text-left text-body-m hover:bg-on-surface/[0.08]">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: tag.color }} />
              <span className="max-w-[200px] flex-1 truncate">{tag.name}</span>
              {accountTagIds.includes(tag.id) && <Check className="size-4 text-primary" />}
            </button>
          ))}
        </div>
      )}
    </motion.div>
  );
}
