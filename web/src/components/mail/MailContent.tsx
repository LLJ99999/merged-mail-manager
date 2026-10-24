import { useRef, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Mail, Paperclip, Download, AlertTriangle, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import type { MailMessage } from '../../types';
import { downloadBlob, formatBytes, parseDate } from '../../lib/utils';
import { sanitizeMailHtml, splitLinks } from '../../lib/mailHtml';
import { mailApi } from '../../lib/api';
import { ChannelBadge } from '../common/ChannelBadge';
import { EmptyState, Spinner } from '../common/Misc';
import { IconButton } from '../common/Button';
import { SenderAvatar } from '../common/ProviderIcon';
import { useAppearance } from '../../stores/appearance';
import { spring } from '../../lib/motion';

async function downloadAttachment(mailId: number, attId: string, name: string) {
  const token = localStorage.getItem('auth_token');
  const res = await fetch(mailApi.attachmentUrl(mailId, attId), { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok || res.headers.get('content-type')?.includes('application/json')) {
    let msg = '下载失败';
    try { msg = (await res.json()).message || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  downloadBlob(await res.blob(), name || 'attachment');
}

/** 阅读面板：选中邮件的卡片通过 layoutId 从列表项展开（M3 container transform） */
export function MailContent({ mail, loading, pending, onBack }: { mail: MailMessage | null; loading?: boolean; pending?: boolean; onBack?: () => void }) {
  return (
    <div className="relative h-full">
      <AnimatePresence mode="popLayout" initial={false}>
        {mail ? (
          <motion.article
            key={mail.id}
            layoutId={`mail-card-${mail.id}`}
            transition={spring}
            exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.12 } }}
            className="sf-lowest absolute inset-0 flex flex-col overflow-hidden rounded-[28px]"
          >
            <ReaderBody mail={mail} loading={loading} onBack={onBack} />
          </motion.article>
        ) : pending ? (
          // 深链接 / 刷新：邮件详情尚未返回
          <motion.div key="pending" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="sf-lowest absolute inset-0 flex flex-col rounded-[28px]">
            {onBack && <IconButton className="ml-4 mt-5 lg:hidden" onClick={onBack} aria-label="返回列表"><ArrowLeft /></IconButton>}
            <div className="flex flex-1 items-center justify-center"><Spinner className="size-6" /></div>
          </motion.div>
        ) : (
          <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="sf-low absolute inset-0 flex items-center justify-center rounded-[28px]">
            <EmptyState icon={Mail} title="未选择邮件" description="从列表选择一封邮件查看内容" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ReaderBody({ mail, loading, onBack }: { mail: MailMessage; loading?: boolean; onBack?: () => void }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const isDark = useAppearance(s => s.isDark);

  useEffect(() => {
    if (!mail?.html_content || !iframeRef.current) return;
    // 亮色下让邮件正文透出卡片的色调/玻璃表面；暗色下保留白色纸张以兼容邮件自带的浅色样式
    const bg = isDark ? '#fff' : 'transparent';
    const doc = iframeRef.current.contentDocument;
    if (!doc) return;
    const { head, body } = sanitizeMailHtml(mail.html_content);
    doc.open();
    doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><base target="_blank"/>${head}
      <style>
        html{color-scheme:light}
        body{font-family:'Roboto Flex Variable',Roboto,-apple-system,'Segoe UI','PingFang SC','Noto Sans CJK SC',sans-serif;font-size:14px;line-height:1.65;color:#1f1f23;margin:0;padding:24px 28px;word-wrap:break-word;overflow-wrap:break-word;background:${bg}}
        img{max-width:100%;height:auto} a{color:#0b57d0} pre{overflow-x:auto;white-space:pre-wrap} table{max-width:100%}
      </style></head><body>${body}</body></html>`);
    doc.close();
  }, [mail?.html_content, mail?.id, isDark]);

  const attachments = (mail.attachments || []).filter(a => !a.is_inline || !mail.html_content);
  // parseDate：SQLite 的「YYYY-MM-DD HH:MM:SS」是 UTC，new Date() 会当作本地时间（差 8 小时）；不是今年的邮件显示年份
  const d = mail.mail_date ? parseDate(mail.mail_date) : null;
  const date = d && !Number.isNaN(d.getTime())
    ? d.toLocaleString('zh-CN', { hour12: false, ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}), month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    // 容器变换（卡片从列表项展开）期间内容保持透明，展开基本完成后再淡入，避免缩放中的文字错位/裁切
    <motion.div className="flex h-full min-h-0 flex-col" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { delay: 0.14, duration: 0.2 } }}>
      <div className="px-6 pb-4 pt-5">
        {onBack && <IconButton className="-ml-2 mb-2 lg:hidden" onClick={onBack} aria-label="返回列表"><ArrowLeft /></IconButton>}
        <div className="flex items-start justify-between gap-4">
          {/* 超长主题最多 3 行（完整内容见悬停提示），不再把正文挤出可视区域；超长无空格字符串可换行 */}
          <h2 className="line-clamp-3 min-w-0 break-words text-headline-s text-on-surface [overflow-wrap:anywhere]" title={mail.subject || undefined}>{mail.subject || '(无主题)'}</h2>
          <div className="flex shrink-0 items-center gap-2 pt-1">
            {loading && <Spinner className="size-4" />}
            <ChannelBadge channel={mail.detail_channel || mail.channel} />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <SenderAvatar name={mail.sender_name || mail.sender} seedKey={mail.sender || ''} size={44} />
          <div className="min-w-0 flex-1">
            <p className="flex min-w-0 items-baseline gap-2 text-title-s text-on-surface" title={mail.sender_name ? `${mail.sender_name} <${mail.sender}>` : mail.sender}>
              <span className="min-w-0 max-w-[60%] shrink-0 truncate">{mail.sender_name || mail.sender || '未知发件人'}</span>
              {mail.sender_name && mail.sender && <span className="min-w-0 truncate font-normal text-on-surface-variant">{mail.sender}</span>}
            </p>
            <p className="truncate text-body-s text-on-surface-variant">{mail.to_addr ? `发送至 ${mail.to_addr}` : ' '}</p>
          </div>
          <span className="tabular shrink-0 text-label-m text-on-surface-variant">{date}</span>
        </div>
        {mail.detail_error && (
          <p className="mt-4 flex items-center gap-2 rounded-full bg-warning-container/70 py-1.5 pl-3 pr-4 text-body-s text-on-warning-container" title={mail.detail_error}>
            <AlertTriangle className="size-4 shrink-0" /><span className="shrink-0">详情获取失败，显示本地缓存</span><span className="truncate opacity-70">· {mail.detail_error.slice(0, 160)}</span>
          </p>
        )}
        {attachments.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {attachments.map(a => (
              <motion.button
                key={a.id}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                disabled={downloading === a.id}
                onClick={async () => {
                  setDownloading(a.id);
                  try { await downloadAttachment(mail.id, a.id, a.name); } catch (e: any) { toast.error(e.message); } finally { setDownloading(null); }
                }}
                className="group inline-flex h-9 max-w-[280px] items-center gap-2 rounded-xl bg-surface-container-high pl-2.5 pr-3 text-label-l text-on-surface transition-colors hover:bg-surface-container-highest disabled:opacity-60"
                title={`${a.name} · ${a.content_type}${a.size ? ` · ${formatBytes(a.size)}` : ''}`}
                aria-label={`下载附件 ${a.name}`}
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-tertiary-container text-on-tertiary-container"><Paperclip className="size-3.5" /></span>
                <span className="min-w-0 truncate">{a.name}</span>
                {a.size > 0 && <span className="tabular shrink-0 whitespace-nowrap text-body-s text-on-surface-variant">{formatBytes(a.size)}</span>}
                {downloading === a.id ? <Spinner className="size-4 shrink-0" /> : <Download className="size-4 shrink-0 text-on-surface-variant" />}
              </motion.button>
            ))}
          </div>
        )}
      </div>
      <div className={`min-h-0 flex-1 overflow-hidden ${isDark && mail.html_content ? 'px-3 pb-3' : ''}`}>
        {mail.html_content ? (
          <iframe ref={iframeRef} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" title="邮件内容" className={`h-full w-full border-0 ${isDark ? 'rounded-[20px] bg-white' : 'bg-transparent'}`} />
        ) : (
          <div className="h-full overflow-y-auto px-6 pb-6">
            {/* 长 URL / 无空格长串在窄面板中换行，而不是被裁掉；URL 可点击 */}
            <pre className="whitespace-pre-wrap break-words font-sans text-body-l leading-relaxed text-on-surface [overflow-wrap:anywhere]">
              {mail.text_content
                ? splitLinks(mail.text_content).map((p, i) => p.href
                  ? <a key={i} href={p.href} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline">{p.text}</a>
                  : <span key={i}>{p.text}</span>)
                : '(无内容)'}
            </pre>
          </div>
        )}
      </div>
    </motion.div>
  );
}
