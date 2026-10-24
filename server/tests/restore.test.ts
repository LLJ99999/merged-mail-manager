import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { applyPendingRestore } from '../src/utils/restore';

test('applyPendingRestore swaps in <db>.restore and moves db + wal/shm aside', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-restore-'));
  const db = path.join(dir, 'x.db');
  fs.writeFileSync(db, 'OLD');
  fs.writeFileSync(db + '-wal', 'OLDWAL');
  fs.writeFileSync(db + '-shm', 'OLDSHM');
  assert.equal(applyPendingRestore(db), false, 'no pending file → no-op');
  fs.writeFileSync(db + '.restore', 'NEW');
  assert.equal(applyPendingRestore(db), true);
  assert.equal(fs.readFileSync(db, 'utf8'), 'NEW');
  assert.equal(fs.existsSync(db + '-wal'), false, 'stale WAL must not be replayed onto the restored db');
  assert.equal(fs.existsSync(db + '.restore'), false);
  const backups = fs.readdirSync(dir).filter(f => f.includes('.backup-'));
  assert.equal(backups.length, 3);
});
