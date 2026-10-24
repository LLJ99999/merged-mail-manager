/**
 * 邮件页的 URL 约定：选中的账户 / 邮件 / 文件夹都写在地址里，浏览器的后退/前进与刷新都能还原。
 *
 *   /mail                       账户列表（移动端：账户面板）
 *   /mail/:accountId            该账户收件箱（移动端：列表面板）
 *   /mail/:accountId/:mailId    阅读（移动端：阅读面板）
 *   ...?box=Junk                垃圾箱
 */
export type Box = 'INBOX' | 'Junk';

export function mailPath(accountId?: number | null, mailId?: number | null, box: Box | string = 'INBOX'): string {
  let p = '/mail';
  if (accountId) {
    p += `/${accountId}`;
    if (mailId) p += `/${mailId}`;
    if (box === 'Junk') p += '?box=Junk';
  }
  return p;
}

export function parseBox(v: string | null | undefined): Box {
  return v === 'Junk' || v === 'junk' ? 'Junk' : 'INBOX';
}

/** 推入子面板时写入 history state：记录来源地址，应用内「返回」可据此用 history.back() 而非再推一条记录 */
export interface MailNavState { mmFrom?: string }
