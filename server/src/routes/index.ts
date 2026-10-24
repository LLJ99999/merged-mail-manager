import Router from 'koa-router';
import { accountRoutes } from './accounts';
import { mailRoutes } from './mails';
import { proxyRoutes } from './proxies';
import { dashboardRoutes } from './dashboard';
import { authRoutes } from './auth';
import { tagRoutes } from './tags';
import { backupRoutes } from './backup';
import logger from '../utils/logger';
import { success } from '../utils/response';
import { getVersionInfo } from '../utils/version';

const router = new Router({ prefix: '/api' });

router.use('/accounts', accountRoutes.routes(), accountRoutes.allowedMethods());
router.use('/mails', mailRoutes.routes(), mailRoutes.allowedMethods());
router.use('/proxies', proxyRoutes.routes(), proxyRoutes.allowedMethods());
router.use('/dashboard', dashboardRoutes.routes(), dashboardRoutes.allowedMethods());
router.use('/auth', authRoutes.routes(), authRoutes.allowedMethods());
router.use('/tags', tagRoutes.routes(), tagRoutes.allowedMethods());
router.use('/backup', backupRoutes.routes(), backupRoutes.allowedMethods());

// 版本诊断：前端用它判断自己是否与服务端版本一致（不一致时提示重新运行 start.bat rebuild）
router.get('/version', ctx => {
  const { version, webBuildVersion, match, node, startedAt } = getVersionInfo();
  ctx.set('Cache-Control', 'no-store');
  success(ctx, { version, webBuildVersion, match, node, startedAt });
});

// 前端渲染错误上报（ErrorBoundary）：写入服务端日志，便于排查「页面空白」类问题
router.post('/client-log', ctx => {
  const b = (ctx.request.body || {}) as Record<string, unknown>;
  const clip = (v: unknown, n: number) => String(v ?? '').slice(0, n);
  logger.warn(`[client] ${clip(b.scope, 16)} error at ${clip(b.path, 200)}: ${clip(b.message, 500)}\n${clip(b.stack, 2000)}${b.componentStack ? `\n  component:${clip(b.componentStack, 1500)}` : ''}`);
  success(ctx, { logged: true });
});

export default router;
