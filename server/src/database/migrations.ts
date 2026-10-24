import db from './index';

export function runMigrations() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      password TEXT DEFAULT '',
      client_id TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      status TEXT DEFAULT 'active' CHECK(status IN ('active','inactive','error')),
      last_synced_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email);

    CREATE TABLE IF NOT EXISTS proxies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL CHECK(type IN ('socks5','http')),
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      username TEXT DEFAULT '',
      password TEXT DEFAULT '',
      is_default INTEGER DEFAULT 0,
      last_tested_at DATETIME,
      last_test_ip TEXT DEFAULT '',
      status TEXT DEFAULT 'untested' CHECK(status IN ('untested','active','failed')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS mail_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      mailbox TEXT NOT NULL DEFAULT 'INBOX' CHECK(mailbox IN ('INBOX','Junk')),
      mail_id TEXT DEFAULT '',
      sender TEXT DEFAULT '',
      sender_name TEXT DEFAULT '',
      subject TEXT DEFAULT '',
      text_content TEXT DEFAULT '',
      html_content TEXT DEFAULT '',
      mail_date DATETIME,
      is_read INTEGER DEFAULT 0,
      cached_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_mail_cache_account ON mail_cache(account_id, mailbox);
    CREATE INDEX IF NOT EXISTS idx_mail_cache_date ON mail_cache(mail_date DESC);
  `);

  // 新增 token_refreshed_at 字段（兼容已有数据库）
  try {
    db.exec(`ALTER TABLE accounts ADD COLUMN token_refreshed_at DATETIME`);
  } catch {
    // 字段已存在则忽略
  }

  // 新增 remark 备注字段
  try {
    db.exec(`ALTER TABLE accounts ADD COLUMN remark TEXT DEFAULT ''`);
  } catch {
    // 字段已存在则忽略
  }

  // 标签系统
  db.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '#3B82F6',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS account_tags (
      account_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (account_id, tag_id),
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    )
  `);

  migrateMultiProvider();
}

function columnExists(table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some(c => c.name === column);
}

function addColumn(table: string, column: string, ddl: string) {
  if (!columnExists(table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

/**
 * v2 迁移：多服务商 + 通道记录 + 邮件缓存去重。
 * 只做 ADD COLUMN / CREATE INDEX，已有数据全部保留：
 * 旧账户自动视为 provider='outlook'、account_type='outlook'。
 */
export function migrateMultiProvider() {
  const tx = db.transaction(() => {
    // ---- accounts ----
    addColumn('accounts', 'provider', "TEXT NOT NULL DEFAULT 'outlook'");
    addColumn('accounts', 'account_type', "TEXT NOT NULL DEFAULT 'outlook'");
    addColumn('accounts', 'imap_host', "TEXT DEFAULT ''");
    addColumn('accounts', 'imap_port', 'INTEGER DEFAULT 993');
    addColumn('accounts', 'imap_password', "TEXT DEFAULT ''");
    addColumn('accounts', 'preferred_channel', "TEXT DEFAULT ''");
    addColumn('accounts', 'last_channel', "TEXT DEFAULT ''");
    addColumn('accounts', 'last_channel_at', 'DATETIME');
    addColumn('accounts', 'last_error', "TEXT DEFAULT ''");
    db.exec(`UPDATE accounts SET provider = 'outlook' WHERE provider IS NULL OR provider = ''`);
    db.exec(`UPDATE accounts SET account_type = 'outlook' WHERE account_type IS NULL OR account_type = ''`);
    db.exec(`UPDATE accounts SET imap_host = 'outlook.live.com', imap_port = 993 WHERE account_type = 'outlook' AND (imap_host IS NULL OR imap_host = '')`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_accounts_provider ON accounts(provider)`);

    // ---- mail_cache ----
    addColumn('mail_cache', 'to_addr', "TEXT DEFAULT ''");
    addColumn('mail_cache', 'id_mode', "TEXT DEFAULT ''");
    addColumn('mail_cache', 'channel', "TEXT DEFAULT ''");
    addColumn('mail_cache', 'has_attachments', 'INTEGER DEFAULT 0');
    addColumn('mail_cache', 'attachments', "TEXT DEFAULT '[]'");

    // 旧版 upsert 使用 ON CONFLICT(id) 导致重复行，这里先去重再建唯一索引
    db.exec(`
      DELETE FROM mail_cache
      WHERE mail_id <> '' AND id NOT IN (
        SELECT MAX(id) FROM mail_cache WHERE mail_id <> '' GROUP BY account_id, mailbox, mail_id
      )
    `);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_mail_cache_msg ON mail_cache(account_id, mailbox, mail_id) WHERE mail_id <> ''`);

    db.exec(`CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT)`);
    db.prepare(`INSERT INTO schema_meta (key, value) VALUES ('version', '2') ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run();
  });
  tx();
}
