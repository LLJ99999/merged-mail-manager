import app from './app';
import { config } from './config';
import { runMigrations } from './database/migrations';
import logger from './utils/logger';
import { getVersionInfo } from './utils/version';
import { FETCH_TIMEOUT_MS } from './utils/deadline';
import { HTTP_REQUEST_TIMEOUT_MS } from './utils/http';
import { IMAP_TIMEOUT_MS } from './services/ImapService';

// 初始化数据库
runMigrations();
logger.info('Database migrations completed');

const v = getVersionInfo();
logger.info(`Mail Manager v${v.version ?? '?'} | frontend build: ${v.webBuildVersion ?? 'NOT BUILT'} | node ${process.version} | ${v.root}`);
if (!v.match) {
  logger.warn('!! 前端构建版本与服务端不一致 (web/dist/.version != VERSION)：浏览器会看到旧界面。请关闭所有命令窗口后运行 "start.bat rebuild"（macOS/Linux: ./start.sh rebuild）');
}
logger.info(`Timeouts: fetch ${FETCH_TIMEOUT_MS / 1000}s per account/mailbox, HTTP ${HTTP_REQUEST_TIMEOUT_MS / 1000}s, IMAP connect ${IMAP_TIMEOUT_MS / 1000}s`);

// 浏览器中途断开（关闭页面 / 取消请求）产生的流错误属正常情况，不打印堆栈
app.on('error', (err: any) => {
  if (['ERR_STREAM_PREMATURE_CLOSE', 'ECONNRESET', 'EPIPE', 'ECONNABORTED'].includes(err?.code)) return;
  logger.error(`Unhandled app error: ${err?.stack || err}`);
});

// 启动服务
const server = app.listen(config.port, () => {
  logger.info(`Server is running on http://localhost:${config.port}`);
});
server.on('error', (err: any) => {
  if (err?.code === 'EADDRINUSE') {
    logger.error(`端口 ${config.port} 已被占用：很可能旧版本仍在后台运行（浏览器会继续显示旧界面）。请关闭所有 Mail Manager 命令窗口 / 结束 node.exe 后重试，或在 .env 中修改 PORT。`);
  } else {
    logger.error(`Server failed to start: ${err?.stack || err}`);
  }
  process.exit(1);
});
// HTTP 层面的兜底：任何请求最长 5 分钟（收取本身有 FETCH_TIMEOUT，这里只防止异常情况下连接永久占用）
server.requestTimeout = 5 * 60 * 1000;
