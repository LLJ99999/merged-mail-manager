/**
 * Microsoft Graph 邮件接口 —— 移植自 assast/outlookEmail
 * (get_emails_graph / get_email_detail_graph_result / get_email_attachments_graph / download_email_attachment_graph_result)
 * 所有请求经 utils/http → 代理对 Graph 同样生效。
 */
import { Proxy, MailAttachmentMeta } from '../types';
import { httpFetch } from '../utils/http';
import { CachedMailInput } from '../models/MailCache';
import logger from '../utils/logger';

const GRAPH = 'https://graph.microsoft.com/v1.0';

export const GRAPH_FOLDER_MAP: Record<string, string> = {
  inbox: 'inbox',
  junkemail: 'junkemail',
  deleteditems: 'deleteditems',
  trash: 'deleteditems',
};

export class GraphError extends Error {
  constructor(message: string, readonly status: number, readonly details?: any) {
    super(message);
    this.name = 'GraphError';
  }
}

export function sanitizeAttachmentFilename(name: string, fallback = 'attachment'): string {
  const cleaned = String(name || '').replace(/[\\/:*?"<>|\r\n\t]+/g, '_').trim();
  return cleaned || fallback;
}

function mapGraphItem(item: any): CachedMailInput {
  return {
    mail_id: item.id,
    sender: item.from?.emailAddress?.address || '',
    sender_name: item.from?.emailAddress?.name || '',
    subject: item.subject || '',
    text_content: item.bodyPreview || '',
    html_content: item.body?.contentType === 'html' ? item.body?.content || '' : '',
    mail_date: item.receivedDateTime || item.createdDateTime || '',
    is_read: !!item.isRead,
    has_attachments: !!item.hasAttachments,
    to_addr: (item.toRecipients || []).map((r: any) => r?.emailAddress?.address).filter(Boolean).join(', '),
    id_mode: 'graph',
  };
}

export class GraphApiService {
  private async get(url: string, accessToken: string, proxy?: Proxy | null, extraHeaders: Record<string, string> = {}) {
    const res = await httpFetch(url, { headers: { Authorization: `Bearer ${accessToken}`, ...extraHeaders } }, proxy);
    if (res.status !== 200) {
      const text = await res.text();
      throw new GraphError(`Graph API 请求失败: ${res.status} - ${text.slice(0, 300)}`, res.status, text);
    }
    return res;
  }

  /** 列表：对应 get_emails_graph（额外取 body，方便离线缓存直接展示正文） */
  async fetchMails(accessToken: string, folder: string, top = 50, skip = 0, proxy?: Proxy | null): Promise<CachedMailInput[]> {
    const folderName = GRAPH_FOLDER_MAP[String(folder).toLowerCase()] || 'inbox';
    const params = new URLSearchParams({
      $top: String(top),
      $skip: String(skip),
      $select: 'id,subject,from,toRecipients,receivedDateTime,isRead,hasAttachments,bodyPreview,body',
      $orderby: 'receivedDateTime desc',
    });
    const res = await this.get(`${GRAPH}/me/mailFolders/${folderName}/messages?${params}`, accessToken, proxy, {
      Prefer: "outlook.body-content-type='html'",
    });
    const data = await res.json();
    const mails = (data.value || []).map(mapGraphItem);
    logger.info(`Graph API fetched ${mails.length} mails from ${folderName}`);
    return mails;
  }

  /** 详情：对应 get_email_detail_graph_result */
  async getDetail(accessToken: string, messageId: string, proxy?: Proxy | null): Promise<CachedMailInput> {
    const params = new URLSearchParams({
      $select: 'id,subject,from,toRecipients,ccRecipients,receivedDateTime,isRead,hasAttachments,body,bodyPreview',
    });
    const res = await this.get(`${GRAPH}/me/messages/${encodeURIComponent(messageId)}?${params}`, accessToken, proxy, {
      Prefer: "outlook.body-content-type='html'",
    });
    return mapGraphItem(await res.json());
  }

  /** 附件列表：对应 get_email_attachments_graph */
  async listAttachments(accessToken: string, messageId: string, proxy?: Proxy | null): Promise<MailAttachmentMeta[]> {
    const params = new URLSearchParams({ $select: 'id,name,contentType,size,isInline' });
    const res = await this.get(`${GRAPH}/me/messages/${encodeURIComponent(messageId)}/attachments?${params}`, accessToken, proxy);
    const data = await res.json();
    return (data.value || []).map((item: any, idx: number) => ({
      id: item.id || '',
      name: sanitizeAttachmentFilename(item.name, `attachment-${idx + 1}`),
      content_type: item.contentType || 'application/octet-stream',
      size: Number(item.size || 0),
      is_inline: !!item.isInline,
    }));
  }

  /** 附件下载：对应 download_email_attachment_graph_result（contentBytes 优先，否则 /$value） */
  async downloadAttachment(accessToken: string, messageId: string, attachmentId: string, proxy?: Proxy | null) {
    const metaUrl = `${GRAPH}/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`;
    const meta = await (await this.get(metaUrl, accessToken, proxy)).json();
    let content: Buffer;
    if (meta.contentBytes) {
      content = Buffer.from(meta.contentBytes, 'base64');
    } else {
      const res = await this.get(`${metaUrl}/$value`, accessToken, proxy);
      content = Buffer.from(await res.arrayBuffer());
    }
    return {
      filename: sanitizeAttachmentFilename(meta.name, 'attachment'),
      content_type: meta.contentType || 'application/octet-stream',
      content,
    };
  }

  async deleteMail(accessToken: string, mailId: string, proxy?: Proxy | null): Promise<void> {
    const res = await httpFetch(`${GRAPH}/me/messages/${encodeURIComponent(mailId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    }, proxy);
    if (res.status >= 400 && res.status !== 404) {
      throw new GraphError(`Graph 删除失败: ${res.status}`, res.status, await res.text());
    }
  }

  async deleteAllMails(accessToken: string, folder: string, proxy?: Proxy | null): Promise<number> {
    let deleted = 0;
    // 每轮取 50 封删除，直到为空（最多 200 轮防止死循环）
    for (let round = 0; round < 200; round++) {
      const mails = await this.fetchMails(accessToken, folder, 50, 0, proxy);
      if (!mails.length) break;
      let roundDeleted = 0;
      for (let i = 0; i < mails.length; i += 10) {
        const batch = mails.slice(i, i + 10);
        const results = await Promise.allSettled(batch.map(m => this.deleteMail(accessToken, m.mail_id!, proxy)));
        roundDeleted += results.filter(r => r.status === 'fulfilled').length;
      }
      deleted += roundDeleted;
      if (mails.length < 50 || roundDeleted === 0) break;
    }
    logger.info(`Graph deleted ${deleted} mails from ${folder}`);
    return deleted;
  }
}
