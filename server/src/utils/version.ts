/**
 * 版本诊断：VERSION（应用/服务端源码版本）与 web/dist/.version（已构建前端的版本）。
 * 两者不一致 = 前端没有随升级重新构建，浏览器拿到的是旧界面。
 */
import fs from 'fs';
import path from 'path';

export const ROOT_DIR = path.resolve(__dirname, '../../..');
export const WEB_DIST_DIR = path.join(ROOT_DIR, 'web', 'dist');

function readTrim(file: string): string | null {
  try { return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim().split(/\s+/)[0] || null; } catch { return null; }
}

export function getVersionInfo() {
  const version = readTrim(path.join(ROOT_DIR, 'VERSION'));
  const webBuildVersion = readTrim(path.join(WEB_DIST_DIR, '.version'));
  return {
    version,
    webBuildVersion,
    match: !!version && version === webBuildVersion,
    root: ROOT_DIR,
    node: process.version,
    pid: process.pid,
    startedAt: STARTED_AT,
  };
}

const STARTED_AT = new Date().toISOString();
