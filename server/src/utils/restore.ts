import fs from 'fs';

/**
 * 数据库恢复在下次启动时生效：POST /api/backup/restore 只把上传的文件写到 `<db>.restore`。
 * 直接覆盖正在使用的 WAL 数据库文件会与残留的 -wal/-shm 混在一起（重启后 SQLite 把旧 WAL 回放到新库 → 数据错乱/损坏）。
 * 这里在打开数据库之前完成替换：旧库连同 -wal/-shm 移到 `.backup-<时间>`，再把恢复文件移到原位置。
 */
export function applyPendingRestore(dbPath: string): boolean {
  const pending = `${dbPath}.restore`;
  if (!fs.existsSync(pending)) return false;
  const stamp = Date.now();
  for (const suffix of ['', '-wal', '-shm']) {
    const f = dbPath + suffix;
    if (fs.existsSync(f)) fs.renameSync(f, `${dbPath}.backup-${stamp}${suffix}`);
  }
  fs.renameSync(pending, dbPath);
  return true;
}
