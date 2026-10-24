import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import serve from 'koa-static';
import path from 'path';
import fs from 'fs';
import { loggerMiddleware } from './middlewares/logger';
import { errorHandler } from './middlewares/errorHandler';
import { authMiddleware } from './middlewares/auth';
import router from './routes';

const app = new Koa();

// 中间件
app.use(errorHandler);
app.use(loggerMiddleware);
// 数据库恢复以 base64 JSON 上传（体积约为 .db 的 1.34 倍），单独放宽上限；其他接口保持 10mb
const restoreBody = bodyParser({ jsonLimit: '512mb' });
const defaultBody = bodyParser({ jsonLimit: '10mb' });
app.use((ctx, next) => (ctx.path === '/api/backup/restore' ? restoreBody(ctx, next) : defaultBody(ctx, next)));
app.use(authMiddleware);

// API 路由
app.use(router.routes());
app.use(router.allowedMethods());

// 前端静态资源
const distPath = path.resolve(__dirname, '../../web/dist');
if (fs.existsSync(distPath)) {
  // 带 hash 的 /assets/* 长缓存；index.html 必须每次重新验证，否则升级后浏览器仍加载旧入口，
  // 引用已被删除的旧 chunk → 白屏 / 页面异常
  app.use(serve(distPath, {
    maxage: 365 * 24 * 60 * 60 * 1000,
    immutable: true,
    gzip: true,
    setHeaders: (res, filePath) => {
      if (!filePath.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'no-cache');
    },
  }));

  // SPA fallback：/mail/3/12 等前端路由刷新时返回 index.html（不缓存）
  app.use(async (ctx) => {
    if ((ctx.method === 'GET' || ctx.method === 'HEAD') && !ctx.path.startsWith('/api') && !path.extname(ctx.path)) {
      const indexPath = path.join(distPath, 'index.html');
      if (fs.existsSync(indexPath)) {
        ctx.type = 'html';
        ctx.set('Cache-Control', 'no-cache');
        ctx.body = fs.createReadStream(indexPath);
      }
    }
  });
}

export default app;
