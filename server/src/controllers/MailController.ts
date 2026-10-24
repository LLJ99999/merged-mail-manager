import { Context } from 'koa';
import { MailService } from '../services/MailService';
import { MailCacheModel } from '../models/MailCache';
import { success, fail } from '../utils/response';

const mailService = new MailService();
const cacheModel = new MailCacheModel();

function contentDisposition(filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export class MailController {
  async fetch(ctx: Context) {
    const { account_id, mailbox = 'INBOX', proxy_id, top } = ctx.request.body as any;
    if (!account_id) return fail(ctx, 'account_id is required', 400);
    try {
      const result = await mailService.fetchMails(account_id, mailbox, proxy_id, Math.min(Number(top) || 50, 100));
      success(ctx, result);
    } catch (err: any) {
      fail(ctx, `收取失败：${err.message}`);
    }
  }

  async fetchNew(ctx: Context) {
    const { account_id, mailbox = 'INBOX', proxy_id } = ctx.request.body as any;
    if (!account_id) return fail(ctx, 'account_id is required', 400);
    try {
      const result = await mailService.fetchMails(account_id, mailbox, proxy_id, 1);
      success(ctx, result.mails[0] ? { ...result.mails[0], channel: result.channel } : null);
    } catch (err: any) {
      fail(ctx, `收取失败：${err.message}`);
    }
  }

  async detail(ctx: Context) {
    const id = parseInt(ctx.params.id);
    const proxyId = ctx.query.proxy_id ? Number(ctx.query.proxy_id) : undefined;
    try {
      success(ctx, await mailService.getMailDetail(id, proxyId));
    } catch (err: any) {
      fail(ctx, err.message, err.message === 'Mail not found' ? 404 : 500);
    }
  }

  async attachment(ctx: Context) {
    const id = parseInt(ctx.params.id);
    const proxyId = ctx.query.proxy_id ? Number(ctx.query.proxy_id) : undefined;
    try {
      const file = await mailService.downloadAttachment(id, String(ctx.params.attachmentId), proxyId);
      ctx.set('Content-Type', file.content_type || 'application/octet-stream');
      ctx.set('Content-Disposition', contentDisposition(file.filename));
      ctx.body = file.content;
    } catch (err: any) {
      fail(ctx, `附件下载失败: ${err.message}`);
    }
  }

  async clear(ctx: Context) {
    const { account_id, mailbox = 'INBOX', proxy_id } = ctx.request.body as any;
    if (!account_id) return fail(ctx, 'account_id is required', 400);
    try {
      const result = await mailService.clearMailbox(account_id, mailbox, proxy_id);
      cacheModel.clearByAccount(account_id, mailbox);
      success(ctx, { message: '邮件已清空', ...result });
    } catch (err: any) {
      fail(ctx, `Failed to clear mailbox: ${err.message}`);
    }
  }

  async cached(ctx: Context) {
    const { account_id, mailbox = 'INBOX', page = '1', pageSize = '50' } = ctx.query as Record<string, string>;
    if (!account_id) return fail(ctx, 'account_id is required', 400);
    const data = cacheModel.getByAccount(parseInt(account_id), mailbox, Math.max(1, parseInt(page) || 1), Math.min(2000, Math.max(1, parseInt(pageSize) || 50)));
    success(ctx, data);
  }
}
