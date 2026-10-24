import db from '../database';
import { Account, PaginatedResponse, ImportResult } from '../types';
import { TagModel } from './Tag';
import { ParsedAccount, ParseOptions, OutlookTokenOrder, parseAccountLine, formatAccountForExport } from '../services/ImportParser';
import { getProviderMeta, IMAP_SERVER_NEW } from '../providers/presets';

const tagModel = new TagModel();

const UPDATABLE_FIELDS = [
  'email', 'password', 'client_id', 'refresh_token', 'remark', 'status', 'token_refreshed_at',
  'provider', 'account_type', 'imap_host', 'imap_port', 'imap_password', 'preferred_channel',
];

export interface AccountImportRequest {
  content: string;
  separator?: string;
  /** 旧版：自定义字段顺序（仅 Outlook）。若提供且 provider 未指定，则按旧逻辑解析 */
  format?: string[];
  provider?: string;
  account_format?: OutlookTokenOrder;
  imap_host?: string;
  imap_port?: number;
}

export interface ListFilter {
  search?: string;
  provider?: string;
  status?: string;
}

export class AccountModel {
  list(page = 1, pageSize = 20, filter: ListFilter | string = ''): PaginatedResponse<Account> {
    const f: ListFilter = typeof filter === 'string' ? { search: filter } : filter;
    const offset = (page - 1) * pageSize;
    const where: string[] = [];
    const params: any[] = [];
    if (f.search) {
      where.push('(email LIKE ? OR remark LIKE ?)');
      params.push(`%${f.search}%`, `%${f.search}%`);
    }
    if (f.provider) {
      where.push('provider = ?');
      params.push(f.provider);
    }
    if (f.status) {
      where.push('status = ?');
      params.push(f.status);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (db.prepare(`SELECT COUNT(*) as c FROM accounts ${whereSql}`).get(...params) as any).c;
    const list = db.prepare(`SELECT * FROM accounts ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, pageSize, offset) as Account[];
    const listWithTags = list.map(acc => ({ ...acc, tags: tagModel.getTagsByAccountId(acc.id) }));
    return { list: listWithTags, total, page, pageSize };
  }

  getById(id: number): Account | undefined {
    const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as Account | undefined;
    if (!acc) return undefined;
    return { ...acc, tags: tagModel.getTagsByAccountId(acc.id) } as any;
  }

  getByEmail(email: string): Account | undefined {
    return db.prepare('SELECT * FROM accounts WHERE email = ?').get(email) as Account | undefined;
  }

  /** 规范化新建/编辑时传入的字段：推断 provider/account_type 并补全 IMAP host/port */
  normalizeInput(data: Partial<Account>): Partial<Account> {
    const out: Partial<Account> = { ...data };
    const email = String(out.email || '');
    let provider = String(out.provider || '').toLowerCase();
    if (!provider) provider = out.client_id || out.refresh_token ? 'outlook' : getProviderMeta('auto', email).key;
    const meta = getProviderMeta(provider, email);
    out.provider = provider === 'outlook' ? 'outlook' : meta.key;
    out.account_type = out.provider === 'outlook' ? 'outlook' : 'imap';
    if (out.account_type === 'outlook') {
      out.imap_host = IMAP_SERVER_NEW;
      out.imap_port = 993;
    } else {
      if (out.provider !== 'custom') {
        out.imap_host = meta.imap_host;
        out.imap_port = meta.imap_port;
      } else {
        out.imap_port = Number(out.imap_port) || 993;
      }
      // 兼容：只填了 password 时视为 IMAP 授权码
      if (!out.imap_password && out.password) out.imap_password = out.password;
    }
    return out;
  }

  validate(data: Partial<Account>): string | null {
    if (!data.email) return 'email is required';
    if (data.account_type === 'outlook') {
      if (!data.client_id || !data.refresh_token) return 'Outlook 账户需要 client_id 与 refresh_token';
    } else {
      if (!data.imap_password) return 'IMAP 账户需要授权码/密码 (imap_password)';
      if (!data.imap_host) return '自定义 IMAP 需要 imap_host';
    }
    return null;
  }

  create(data: Partial<Account>): Account {
    const d = this.normalizeInput(data);
    const stmt = db.prepare(`INSERT INTO accounts
      (email, password, client_id, refresh_token, remark, provider, account_type, imap_host, imap_port, imap_password)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const result = stmt.run(
      d.email, d.password || '', d.client_id || '', d.refresh_token || '', d.remark || '',
      d.provider, d.account_type, d.imap_host || '', d.imap_port || 993, d.imap_password || '',
    );
    return this.getById(result.lastInsertRowid as number)!;
  }

  update(id: number, data: Partial<Account>): Account | undefined {
    const current = this.getById(id);
    if (!current) return undefined;
    let patch: Partial<Account> = { ...data };
    if ('provider' in data || 'imap_host' in data || 'imap_port' in data) {
      const merged = this.normalizeInput({ ...current, ...data });
      patch = { ...patch, provider: merged.provider, account_type: merged.account_type, imap_host: merged.imap_host, imap_port: merged.imap_port };
    }
    const fields: string[] = [];
    const values: any[] = [];
    for (const [key, val] of Object.entries(patch)) {
      if (UPDATABLE_FIELDS.includes(key)) {
        fields.push(`${key} = ?`);
        values.push(val ?? '');
      }
    }
    if (fields.length === 0) return current;
    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);
    db.prepare(`UPDATE accounts SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getById(id);
  }

  delete(id: number): boolean {
    return db.prepare('DELETE FROM accounts WHERE id = ?').run(id).changes > 0;
  }

  batchDelete(ids: number[]): number {
    const placeholders = ids.map(() => '?').join(',');
    return db.prepare(`DELETE FROM accounts WHERE id IN (${placeholders})`).run(...ids).changes;
  }

  // ---------------- 导入 ----------------

  /** 解析导入内容为账户记录；兼容旧版 format 字段顺序（仅 Outlook） */
  parseImport(req: AccountImportRequest): { items: (ParsedAccount & { line: number })[]; errors: string[] } {
    const separator = req.separator || '----';
    const lines = String(req.content || '').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    const items: (ParsedAccount & { line: number })[] = [];
    const errors: string[] = [];
    const legacyFormat = !req.provider && Array.isArray(req.format) && req.format.length > 0
      && req.format.join(',') !== 'email,password,client_id,refresh_token';

    lines.forEach((line, i) => {
      if (legacyFormat) {
        const parts = line.split(separator);
        const rec: Record<string, string> = {};
        req.format!.forEach((field, idx) => { if (field) rec[field] = (parts[idx] || '').trim(); });
        if (!rec.email || !rec.client_id || !rec.refresh_token) {
          errors.push(`Line ${i + 1}: missing required fields`);
          return;
        }
        items.push({
          line: i + 1, email: rec.email, password: rec.password || '', client_id: rec.client_id, refresh_token: rec.refresh_token,
          provider: 'outlook', account_type: 'outlook', imap_host: IMAP_SERVER_NEW, imap_port: 993, imap_password: '',
        });
        return;
      }
      const opts: ParseOptions = {
        provider: req.provider || 'auto',
        separator,
        accountFormat: req.account_format,
        imapHost: req.imap_host,
        imapPort: req.imap_port,
      };
      const { account, error } = parseAccountLine(line, opts);
      if (!account) {
        errors.push(`Line ${i + 1}: ${error || '无法解析'}`);
        return;
      }
      items.push({ line: i + 1, ...account });
    });
    return { items, errors };
  }

  importPreview(req: AccountImportRequest): { newItems: any[]; duplicates: any[]; errors: string[] } {
    const { items, errors } = this.parseImport(req);
    const newItems: any[] = [];
    const duplicates: any[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      const key = item.email.toLowerCase();
      const summary = { line: item.line, email: item.email, provider: item.provider, account_type: item.account_type, imap_host: item.imap_host };
      if (seen.has(key)) {
        errors.push(`Line ${item.line}: 与上文重复的邮箱 ${item.email}`);
        continue;
      }
      seen.add(key);
      if (this.getByEmail(item.email)) duplicates.push(summary);
      else newItems.push(summary);
    }
    return { newItems, duplicates, errors };
  }

  importConfirm(req: AccountImportRequest & { mode: 'skip' | 'overwrite' }): ImportResult {
    const { items, errors } = this.parseImport(req);
    let imported = 0, skipped = 0;
    const insertStmt = db.prepare(`INSERT OR IGNORE INTO accounts
      (email, password, client_id, refresh_token, provider, account_type, imap_host, imap_port, imap_password)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const updateStmt = db.prepare(`UPDATE accounts SET password = ?, client_id = ?, refresh_token = ?, provider = ?, account_type = ?,
      imap_host = ?, imap_port = ?, imap_password = ?, status = 'active', last_error = '', updated_at = CURRENT_TIMESTAMP WHERE email = ?`);

    db.transaction(() => {
      for (const r of items) {
        const existing = this.getByEmail(r.email);
        if (existing) {
          if (req.mode === 'overwrite') {
            updateStmt.run(r.password, r.client_id, r.refresh_token, r.provider, r.account_type, r.imap_host, r.imap_port, r.imap_password, r.email);
            imported++;
          } else {
            skipped++;
          }
        } else {
          const res = insertStmt.run(r.email, r.password, r.client_id, r.refresh_token, r.provider, r.account_type, r.imap_host, r.imap_port, r.imap_password);
          if (res.changes > 0) imported++;
          else skipped++;
        }
      }
    })();
    return { imported, skipped, errors };
  }

  /** 旧版直接导入接口（跳过重复） */
  import(req: AccountImportRequest): ImportResult {
    return this.importConfirm({ ...req, mode: 'skip' });
  }

  /**
   * 导出。未指定 format 时按账户类型输出原生格式（可直接再导入）；
   * 指定 format 时按旧版字段顺序输出。
   */
  export(ids?: number[], separator = '----', format?: string[]): string {
    let accounts: Account[];
    if (ids && ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',');
      accounts = db.prepare(`SELECT * FROM accounts WHERE id IN (${placeholders})`).all(...ids) as Account[];
    } else {
      accounts = db.prepare('SELECT * FROM accounts').all() as Account[];
    }
    if (format && format.length > 0) {
      return accounts.map(acc => format.map(f => (acc as any)[f] ?? '').join(separator)).join('\n');
    }
    return accounts.map(acc => formatAccountForExport(acc, separator)).join('\n');
  }

  // ---------------- 状态写回 ----------------

  updateSyncTime(id: number) {
    db.prepare('UPDATE accounts SET last_synced_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  }

  /** 保存微软返回的轮换 refresh_token（对应源项目 persist_rotated_refresh_token） */
  persistRotatedRefreshToken(id: number, newRefreshToken?: string): boolean {
    const token = String(newRefreshToken || '').trim();
    if (!token) return false;
    db.prepare('UPDATE accounts SET refresh_token = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(token, id);
    return true;
  }

  updateTokenRefreshTime(id: number, newRefreshToken?: string) {
    this.persistRotatedRefreshToken(id, newRefreshToken);
    db.prepare(`UPDATE accounts SET token_refreshed_at = CURRENT_TIMESTAMP, status = 'active', last_error = '', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
  }

  /** 记录实际成功的网络通道（对应源项目 record_account_authorization_type，粒度细化到 graph/imap_new/imap_old） */
  recordPreferredChannel(id: number, channel: string) {
    db.prepare('UPDATE accounts SET preferred_channel = ? WHERE id = ?').run(channel, id);
  }

  /** 记录本次服务取信的通道（含 cache） */
  recordLastChannel(id: number, channel: string, error = '') {
    db.prepare('UPDATE accounts SET last_channel = ?, last_channel_at = CURRENT_TIMESTAMP, last_error = ? WHERE id = ?').run(channel, error.slice(0, 1000), id);
  }

  markError(id: number, error = '') {
    db.prepare(`UPDATE accounts SET status = 'error', last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(error.slice(0, 1000), id);
  }

  markActive(id: number) {
    db.prepare(`UPDATE accounts SET status = 'active', last_error = '', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
  }

  getAll(): Account[] {
    return db.prepare('SELECT * FROM accounts ORDER BY id DESC').all() as Account[];
  }

  getByIds(ids: number[]): Account[] {
    if (!ids.length) return [];
    const placeholders = ids.map(() => '?').join(',');
    return db.prepare(`SELECT * FROM accounts WHERE id IN (${placeholders}) ORDER BY id DESC`).all(...ids) as Account[];
  }
}
