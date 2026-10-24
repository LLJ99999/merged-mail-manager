import { motion } from 'framer-motion';
import { Paperclip } from 'lucide-react';
import type { MailMessage } from '../../types';
import { cn, shortTime } from '../../lib/utils';
import { listItem, spring } from '../../lib/motion';
import { SenderAvatar } from '../common/ProviderIcon';
import { Skeleton } from '../common/Misc';
import { useRipple } from '../common/Ripple';

export function MailRow({ mail, selected, onClick }: { mail: MailMessage; selected: boolean; onClick: () => void }) {
  const preview = (mail.text_content || '').replace(/\s+/g, ' ').trim().slice(0, 140);
  const { onPointerDown, ripple } = useRipple();
  return (
    <motion.button
      variants={listItem}
      onClick={onClick}
      onPointerDown={onPointerDown}
      whileTap={{ scale: 0.985 }}
      className={cn('group relative flex w-full gap-3 overflow-hidden rounded-[20px] px-3 py-3 text-left', !selected && 'hover:bg-on-surface/[0.06]')}
    >
      {/* 选中指示：在列表项之间平滑滑动 */}
      {selected && <motion.span layoutId="mail-row-indicator" transition={spring} className="absolute inset-0 rounded-[20px] bg-secondary-container" />}
      {/* 共享布局锚点：阅读面板卡片从这里展开（容器变换） */}
      <motion.span layoutId={`mail-card-${mail.id}`} className="pointer-events-none absolute inset-0 rounded-[20px]" style={{ opacity: 0 }} />
      {ripple}
      <SenderAvatar name={mail.sender_name || mail.sender} seedKey={mail.sender || ''} size={40} className="relative" />
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn('flex-1 truncate text-body-l', !mail.is_read ? 'font-semibold text-on-surface' : 'text-on-surface', selected && 'text-on-secondary-container')}>{mail.sender_name || mail.sender || '未知发件人'}</span>
          {mail.has_attachments && <Paperclip className="size-3.5 shrink-0 text-on-surface-variant" />}
          <span className={cn('tabular shrink-0 text-label-m', !mail.is_read ? 'text-primary' : 'text-on-surface-variant')}>{shortTime(mail.mail_date)}</span>
        </div>
        <div className="flex items-center gap-2">
          <p className={cn('flex-1 truncate text-body-m', !mail.is_read ? 'font-medium text-on-surface' : 'text-on-surface-variant')}>{mail.subject || '(无主题)'}</p>
          {!mail.is_read && <span className="size-2 shrink-0 rounded-full bg-primary" />}
        </div>
        <p className="line-clamp-1 text-body-s text-on-surface-variant/90">{preview || '(无内容)'}</p>
      </div>
    </motion.button>
  );
}

export function MailListSkeleton() {
  return (
    <div className="space-y-1 px-2">
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="flex gap-3 px-3 py-3">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <div className="flex justify-between"><Skeleton className="h-3.5 w-1/3" /><Skeleton className="h-3 w-10" /></div>
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-2.5 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
