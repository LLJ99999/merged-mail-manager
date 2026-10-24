import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/** 让 tailwind-merge 认识 M3 字号与阴影 token，避免 text-title-m 与 text-on-surface 被误判为冲突 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['display-s', 'headline-l', 'headline-m', 'headline-s', 'title-l', 'title-m', 'title-s', 'body-l', 'body-m', 'body-s', 'label-l', 'label-m', 'label-s'] }],
      shadow: [{ shadow: ['elev-1', 'elev-2', 'elev-3'] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function maskText(text: string, visibleChars = 3): string {
  if (!text) return text;
  // 短密码（≤ visibleChars 位）也必须遮挡，否则直接以明文显示
  const keep = text.length <= visibleChars ? Math.min(1, text.length - 1) : visibleChars;
  return text.slice(0, Math.max(0, keep)) + '***';
}

/** 首个字素（emoji / 代理对 / 组合字符不会被截成半个字符显示为 �） */
export function firstGrapheme(s: string): string {
  const t = (s || '').trim();
  if (!t) return '';
  try {
    const Seg = (Intl as any).Segmenter;
    if (Seg) { const it = new Seg(undefined, { granularity: 'grapheme' }).segment(t)[Symbol.iterator]().next(); if (!it.done) return it.value.segment; }
  } catch { /* ignore */ }
  return Array.from(t)[0] || '';
}

/**
 * 复制到剪贴板：navigator.clipboard 只在安全上下文（https / localhost）可用，
 * 通过局域网 IP 以 http 访问时它是 undefined —— 回退到 execCommand('copy')。
 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* 回退 */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** 触发浏览器下载；URL 延迟释放（立即 revoke 在部分浏览器 / 大文件下会导致下载失败） */
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function timeAgo(dateStr: string): string {
  if (!dateStr) return '—';
  const date = parseDate(dateStr);
  if (Number.isNaN(date.getTime())) return '—';
  const now = new Date();
  // 服务器 / 本机时钟偏差可能得到负数：不显示「-5秒前」
  const diff = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
  if (diff < 10) return '刚刚';
  if (diff < 60) return `${diff}秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}天前`;
  return date.toLocaleDateString('zh-CN');
}

export function getInitials(name: string): string {
  if (!name) return '?';
  const parts = name.split(/[@\s]/);
  return firstGrapheme(parts[0] || '').toUpperCase() || '?';
}

export function getAvatarColor(str: string): string {
  const colors = ['#52525B', '#4F46E5', '#0F766E', '#9333EA', '#B45309', '#BE123C', '#0369A1', '#4D7C0F'];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

// ---------------- 服务商 / 通道 元数据 ----------------

export const PROVIDERS: { key: string; label: string; short: string; color: string; host?: string }[] = [
  { key: 'outlook', label: 'Outlook', short: 'O', color: '#0A64D6', host: 'Graph / IMAP' },
  { key: 'gmail', label: 'Gmail', short: 'G', color: '#EA4335', host: 'imap.gmail.com' },
  { key: 'qq', label: 'QQ 邮箱', short: 'QQ', color: '#12B7F5', host: 'imap.qq.com' },
  { key: '163', label: '163 邮箱', short: '163', color: '#D43C33', host: 'imap.163.com' },
  { key: '126', label: '126 邮箱', short: '126', color: '#2E8B57', host: 'imap.126.com' },
  { key: 'yahoo', label: 'Yahoo', short: 'Y!', color: '#6001D2', host: 'imap.mail.yahoo.com' },
  { key: 'aliyun', label: '阿里邮箱', short: 'Ali', color: '#FF6A00', host: 'imap.aliyun.com' },
  { key: '2925', label: '2925 邮箱', short: '29', color: '#0EA5E9', host: 'imap.2925.com' },
  { key: 'custom', label: '自定义 IMAP', short: 'IM', color: '#71717A' },
];

export function providerMeta(key?: string) {
  return PROVIDERS.find(p => p.key === key) || PROVIDERS[PROVIDERS.length - 1];
}

export const CHANNELS: Record<string, { label: string; short: string; hint: string; tone: 'accent' | 'neutral' | 'warning' }> = {
  graph: { label: 'Graph API', short: 'Graph', hint: 'Microsoft Graph REST', tone: 'accent' },
  imap_new: { label: 'IMAP · New', short: 'IMAP-new', hint: 'outlook.live.com:993', tone: 'neutral' },
  imap_old: { label: 'IMAP · Old', short: 'IMAP-old', hint: 'outlook.office365.com:993', tone: 'neutral' },
  imap: { label: 'IMAP', short: 'IMAP', hint: '标准 IMAP', tone: 'neutral' },
  cache: { label: '本地缓存', short: 'Cache', hint: '所有网络通道失败，展示本地缓存', tone: 'warning' },
};

export function formatBytes(n?: number): string {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

export function formatDateTime(s?: string | null): string {
  if (!s) return '—';
  const d = parseDate(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString('zh-CN', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** SQLite CURRENT_TIMESTAMP 为 UTC 且不带时区，需补 Z */
export function parseDate(s: string): Date {
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return new Date(s.replace(' ', 'T') + 'Z');
  return new Date(s);
}

export function shortTime(s?: string | null): string {
  if (!s) return '';
  const d = parseDate(s);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return d.toLocaleDateString('zh-CN');
}
