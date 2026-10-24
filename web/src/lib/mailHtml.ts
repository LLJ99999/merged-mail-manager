/**
 * 邮件 HTML 预处理（写入 sandbox iframe 之前）。
 *
 * iframe 本身没有 allow-scripts，脚本不会执行；这里额外：
 *  - 移除 <script>/<noscript>/<object>/<embed>/<applet>/<frame*>、<meta http-equiv="refresh">、<base>、<link rel=import|preload|prefetch>：
 *    否则浏览器控制台会刷出「Blocked script execution … sandboxed」之类的错误，邮件里的 <base href> 还会改写
 *    所有相对链接 / 我们自己的 <base target="_blank">；
 *  - 去掉 on* 事件属性与 javascript:/vbscript: 链接；
 *  - 所有链接在新标签页打开（rel=noopener noreferrer）。
 * 只做净化，不改变邮件排版。
 */
const DROP = 'script,noscript,object,embed,applet,frame,frameset,iframe,base,meta[http-equiv],link[rel~="import" i],link[rel~="preload" i],link[rel~="prefetch" i]';

export function sanitizeMailHtml(html: string): { head: string; body: string } {
  if (!html) return { head: '', body: '' };
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return { head: '', body: html };
  }
  doc.querySelectorAll(DROP).forEach(el => el.remove());
  doc.querySelectorAll('*').forEach(el => {
    for (const attr of Array.from(el.attributes)) {
      const n = attr.name.toLowerCase();
      if (n.startsWith('on')) el.removeAttribute(attr.name);
      else if ((n === 'href' || n === 'src' || n === 'action' || n === 'formaction' || n === 'xlink:href') && /^\s*(javascript|vbscript):/i.test(attr.value)) el.removeAttribute(attr.name);
    }
  });
  doc.querySelectorAll('a[href]').forEach(a => {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  });
  // <head> 里的 <style> 保留（很多营销邮件把样式写在 head）
  const head = Array.from(doc.head?.querySelectorAll('style') || []).map(s => s.outerHTML).join('');
  return { head, body: doc.body?.innerHTML ?? '' };
}

/** 纯文本邮件：把 URL 切成 [文本, 链接, 文本, …]，由组件渲染为可点击链接 */
const URL_RE = /\bhttps?:\/\/[^\s<>"'，。；！？）】」]+/gi;
export function splitLinks(text: string): { text: string; href?: string }[] {
  const out: { text: string; href?: string }[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const i = m.index ?? 0;
    let url = m[0];
    // 去掉句末标点
    const trail = url.match(/[).,;:!?\]]+$/)?.[0] || '';
    if (trail) url = url.slice(0, -trail.length);
    if (i > last) out.push({ text: text.slice(last, i) });
    out.push({ text: url, href: url });
    last = i + url.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
