import { Context } from 'koa';
import { AccountModel } from '../models/Account';
import { TagModel } from '../models/Tag';
import { MailService } from '../services/MailService';
import { MAIL_PROVIDERS, PROVIDER_ORDER } from '../providers/presets';
import { success, fail } from '../utils/response';

const model = new AccountModel();
const tagModel = new TagModel();
const mailService = new MailService();

export class AccountController {
  async list(ctx: Context) {
    const { page = '1', pageSize = '20', search = '', provider = '', status = '' } = ctx.query as Record<string, string>;
    // 非法 / 缺失的分页参数（NaN、0、负数）会让 SQLite 的 LIMIT/OFFSET 报错：归一化
    const pg = Math.max(1, parseInt(page) || 1);
    const ps = Math.min(10000, Math.max(1, parseInt(pageSize) || 20));
    const data = model.list(pg, ps, { search, provider, status });
    success(ctx, data);
  }

  async providers(ctx: Context) {
    success(ctx, PROVIDER_ORDER.map(key => ({ key, ...MAIL_PROVIDERS[key] })));
  }

  async create(ctx: Context) {
    const body = model.normalizeInput(ctx.request.body as any);
    const err = model.validate(body);
    if (err) return fail(ctx, err, 400);
    try {
      success(ctx, model.create(body));
    } catch (e: any) {
      if (e.message?.includes('UNIQUE')) return fail(ctx, 'Email already exists', 409);
      throw e;
    }
  }

  async update(ctx: Context) {
    const id = parseInt(ctx.params.id);
    const account = model.update(id, ctx.request.body as any);
    if (!account) return fail(ctx, 'Account not found', 404);
    success(ctx, account);
  }

  async delete(ctx: Context) {
    const id = parseInt(ctx.params.id);
    if (!model.delete(id)) return fail(ctx, 'Account not found', 404);
    success(ctx, { deleted: true });
  }

  async batchDelete(ctx: Context) {
    const { ids } = ctx.request.body as any;
    if (!Array.isArray(ids) || ids.length === 0) return fail(ctx, 'ids must be a non-empty array', 400);
    success(ctx, { deleted: model.batchDelete(ids) });
  }

  async import(ctx: Context) {
    const body = ctx.request.body as any;
    if (!body.content) return fail(ctx, 'content is required', 400);
    success(ctx, model.import(body));
  }

  async export(ctx: Context) {
    const body = (ctx.request.body || {}) as any;
    const content = model.export(body.ids, body.separator, body.format);
    success(ctx, { content, count: content.split('\n').filter(Boolean).length });
  }

  async setTags(ctx: Context) {
    const id = parseInt(ctx.params.id);
    const { tag_ids } = ctx.request.body as any;
    if (!Array.isArray(tag_ids)) return fail(ctx, 'tag_ids must be an array', 400);
    tagModel.setAccountTags(id, tag_ids);
    success(ctx, { account_id: id, tag_ids });
  }

  async importPreview(ctx: Context) {
    const body = ctx.request.body as any;
    if (!body.content) return fail(ctx, 'content is required', 400);
    success(ctx, model.importPreview(body));
  }

  async importConfirm(ctx: Context) {
    const body = ctx.request.body as any;
    if (!body.content) return fail(ctx, 'content is required', 400);
    if (!['skip', 'overwrite'].includes(body.mode)) return fail(ctx, 'mode must be skip or overwrite', 400);
    success(ctx, model.importConfirm(body));
  }

  /** 刷新单个账户 token（Outlook）或校验登录（IMAP） */
  async refreshToken(ctx: Context) {
    const id = parseInt(ctx.params.id);
    const { proxy_id } = (ctx.request.body || {}) as any;
    try {
      success(ctx, await mailService.refreshToken(id, proxy_id));
    } catch (err: any) {
      fail(ctx, err.message, err.message === 'Account not found' ? 404 : 500);
    }
  }

  /** 批量刷新；ids 为空则刷新全部 */
  async refreshTokens(ctx: Context) {
    const { ids, proxy_id } = (ctx.request.body || {}) as any;
    success(ctx, await mailService.refreshTokens(Array.isArray(ids) ? ids : undefined, proxy_id));
  }
}
