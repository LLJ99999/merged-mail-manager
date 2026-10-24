import db from '../database';
import { MailMessage, MailAttachmentMeta } from '../types';

export interface CachedMailInput extends Partial<Omit<MailMessage, 'attachments'>> {
  attachments?: MailAttachmentMeta[];
}

function hydrate(row: any): MailMessage {
  if (!row) return row;
  let attachments: MailAttachmentMeta[] = [];
  try { attachments = JSON.parse(row.attachments || '[]'); } catch { attachments = []; }
  return { ...row, attachments, has_attachments: !!row.has_attachments, is_read: !!row.is_read };
}

export class MailCacheModel {
  getByAccount(accountId: number, mailbox: string, page = 1, pageSize = 50) {
    const offset = (page - 1) * pageSize;
    const total = (db.prepare('SELECT COUNT(*) as c FROM mail_cache WHERE account_id = ? AND mailbox = ?').get(accountId, mailbox) as any).c;
    const list = (db.prepare('SELECT * FROM mail_cache WHERE account_id = ? AND mailbox = ? ORDER BY mail_date DESC, id DESC LIMIT ? OFFSET ?')
      .all(accountId, mailbox, pageSize, offset) as any[]).map(hydrate);
    return { list, total, page, pageSize };
  }

  getById(id: number): MailMessage | undefined {
    const row = db.prepare('SELECT * FROM mail_cache WHERE id = ?').get(id);
    return row ? hydrate(row) : undefined;
  }

  /**
   * 按 (account_id, mailbox, mail_id) 去重写入。
   * 当本次抓取使用的 ID 模式（graph / uid）与缓存不同，先清理旧模式的行，避免同一封邮件以两种 ID 重复出现。
   */
  upsert(accountId: number, mailbox: string, mails: CachedMailInput[], opts: { replaceOtherIdModes?: boolean } = {}): MailMessage[] {
    const insert = db.prepare(`
      INSERT INTO mail_cache (account_id, mailbox, mail_id, sender, sender_name, subject, text_content, html_content, mail_date,
                              is_read, to_addr, id_mode, channel, has_attachments, attachments)
      VALUES (@account_id, @mailbox, @mail_id, @sender, @sender_name, @subject, @text_content, @html_content, @mail_date,
              @is_read, @to_addr, @id_mode, @channel, @has_attachments, @attachments)
      ON CONFLICT(account_id, mailbox, mail_id) WHERE mail_id <> '' DO UPDATE SET
        sender = excluded.sender,
        sender_name = excluded.sender_name,
        subject = excluded.subject,
        text_content = CASE WHEN excluded.text_content <> '' THEN excluded.text_content ELSE mail_cache.text_content END,
        html_content = CASE WHEN excluded.html_content <> '' THEN excluded.html_content ELSE mail_cache.html_content END,
        mail_date = excluded.mail_date,
        -- 在本应用里打开过的邮件保持已读（Graph 读取详情不会改远端已读标志，重新收取不应把它变回未读）
        is_read = MAX(mail_cache.is_read, excluded.is_read),
        to_addr = excluded.to_addr,
        id_mode = excluded.id_mode,
        channel = excluded.channel,
        has_attachments = excluded.has_attachments,
        attachments = CASE WHEN excluded.attachments <> '[]' THEN excluded.attachments ELSE mail_cache.attachments END,
        cached_at = CURRENT_TIMESTAMP
    `);
    const select = db.prepare('SELECT * FROM mail_cache WHERE account_id = ? AND mailbox = ? AND mail_id = ?');
    const insertNoId = db.prepare(`
      INSERT INTO mail_cache (account_id, mailbox, mail_id, sender, sender_name, subject, text_content, html_content, mail_date,
                              is_read, to_addr, id_mode, channel, has_attachments, attachments)
      VALUES (@account_id, @mailbox, @mail_id, @sender, @sender_name, @subject, @text_content, @html_content, @mail_date,
              @is_read, @to_addr, @id_mode, @channel, @has_attachments, @attachments)`);
    const saved: MailMessage[] = [];

    db.transaction(() => {
      const idModes = new Set(mails.map(m => m.id_mode || '').filter(Boolean));
      if (opts.replaceOtherIdModes && idModes.size === 1) {
        const mode = [...idModes][0];
        const family = mode === 'graph' ? ['graph'] : ['uid', 'sequence'];
        db.prepare(`DELETE FROM mail_cache WHERE account_id = ? AND mailbox = ? AND id_mode NOT IN (${family.map(() => '?').join(',')})`)
          .run(accountId, mailbox, ...family);
      }
      for (const m of mails) {
        const params = {
          account_id: accountId,
          mailbox,
          mail_id: m.mail_id || '',
          sender: m.sender || '',
          sender_name: m.sender_name || '',
          subject: m.subject || '',
          text_content: m.text_content || '',
          html_content: m.html_content || '',
          mail_date: m.mail_date || null,
          is_read: m.is_read ? 1 : 0,
          to_addr: m.to_addr || '',
          id_mode: m.id_mode || '',
          channel: m.channel || '',
          has_attachments: m.has_attachments ? 1 : 0,
          attachments: JSON.stringify(m.attachments || []),
        };
        if (params.mail_id) {
          insert.run(params);
          saved.push(hydrate(select.get(accountId, mailbox, params.mail_id)));
        } else {
          const r = insertNoId.run(params);
          saved.push(hydrate(db.prepare('SELECT * FROM mail_cache WHERE id = ?').get(r.lastInsertRowid)));
        }
      }
    })();
    return saved;
  }

  updateDetail(id: number, patch: { html_content?: string; text_content?: string; attachments?: MailAttachmentMeta[]; has_attachments?: boolean; to_addr?: string }) {
    const row = this.getById(id);
    if (!row) return;
    db.prepare(`UPDATE mail_cache SET html_content = ?, text_content = ?, attachments = ?, has_attachments = ?, to_addr = ?, cached_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(
        patch.html_content ?? row.html_content,
        patch.text_content ?? row.text_content,
        JSON.stringify(patch.attachments ?? row.attachments ?? []),
        (patch.has_attachments ?? row.has_attachments) ? 1 : 0,
        patch.to_addr ?? row.to_addr ?? '',
        id,
      );
  }

  markRead(id: number) {
    db.prepare('UPDATE mail_cache SET is_read = 1 WHERE id = ? AND is_read = 0').run(id);
  }

  clearByAccount(accountId: number, mailbox: string) {
    db.prepare('DELETE FROM mail_cache WHERE account_id = ? AND mailbox = ?').run(accountId, mailbox);
  }

  getRecent(limit = 5): MailMessage[] {
    return (db.prepare('SELECT mc.*, a.email as account_email, a.provider as account_provider FROM mail_cache mc JOIN accounts a ON mc.account_id = a.id ORDER BY mc.mail_date DESC LIMIT ?')
      .all(limit) as any[]).map(hydrate);
  }

  countByAccount(accountId: number, mailbox: string): number {
    return (db.prepare('SELECT COUNT(*) as c FROM mail_cache WHERE account_id = ? AND mailbox = ?').get(accountId, mailbox) as any).c;
  }

  countAll(mailbox: string): number {
    return (db.prepare('SELECT COUNT(*) as c FROM mail_cache WHERE mailbox = ?').get(mailbox) as any).c;
  }
}
