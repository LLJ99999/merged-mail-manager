import Database, { Database as DatabaseType } from 'better-sqlite3';
import { config } from '../config';
import path from 'path';
import fs from 'fs';
import { applyPendingRestore } from '../utils/restore';

const dir = path.dirname(config.dbPath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

const restored = applyPendingRestore(config.dbPath);
if (restored) console.log(`[db] 已应用待恢复的数据库备份 → ${config.dbPath}`);

const db: DatabaseType = new Database(config.dbPath);

// 启用 WAL 模式和外键约束
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export default db;
