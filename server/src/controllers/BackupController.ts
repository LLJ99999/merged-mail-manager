import { Context } from 'koa';
import fs from 'fs';
import path from 'path';
import { success, fail } from '../utils/response';
import { config } from '../config';
import db from '../database';

// 修正：原项目写死 data/database.db，与实际 DB_PATH (data/outlook.db) 不一致
const DB_PATH = config.dbPath;

export class BackupController {
  async download(ctx: Context) {
    if (!fs.existsSync(DB_PATH)) {
      return fail(ctx, 'Database file not found', 404);
    }

    // 先把 WAL 合并进主库，保证下载到的是完整数据
    try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ }
    const fileName = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
    ctx.set('Content-Type', 'application/octet-stream');
    ctx.set('Content-Disposition', `attachment; filename="${fileName}"`);
    ctx.body = fs.createReadStream(DB_PATH);
  }

  async restore(ctx: Context) {
    const body = ctx.request.body as any;

    if (!body.fileContent) {
      return fail(ctx, 'fileContent is required', 400);
    }

    try {
      // Decode base64 content
      const buffer = Buffer.from(body.fileContent, 'base64');

      // Validate it's a SQLite database (magic number check)
      const magic = buffer.toString('utf8', 0, 15);
      if (!magic.startsWith('SQLite format 3')) {
        return fail(ctx, 'Invalid SQLite database file', 400);
      }

      // 写入待恢复文件，下次启动时（打开数据库之前）替换，见 database/index.ts applyPendingRestore
      const pendingPath = `${DB_PATH}.restore`;
      fs.writeFileSync(pendingPath, buffer);

      success(ctx, {
        message: 'Database restore scheduled; restart the server to apply',
        pending: pendingPath,
        restartRequired: true,
      });
    } catch (err: any) {
      return fail(ctx, `Restore failed: ${err.message}`, 500);
    }
  }
}
