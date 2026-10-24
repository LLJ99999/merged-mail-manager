import { useState, useEffect } from 'react';
import { Eye, EyeOff, X, Plus } from 'lucide-react';
import type { Account, Tag } from '../../types';
import { Dialog } from '../common/Dialog';
import { Button } from '../common/Button';
import { Input, Textarea, Select, Field } from '../common/Input';
import { ChannelBadge } from '../common/ChannelBadge';
import { PROVIDERS, providerMeta } from '../../lib/utils';
import { confirmDialog } from '../../stores/ui';
import { UserRoundPen, UserRoundPlus } from 'lucide-react';

interface Props {
  open: boolean;
  account: Account | null;
  onClose: () => void;
  onSave: (data: Partial<Account>) => Promise<void>;
  tags?: Tag[];
  accountTagIds?: number[];
  onTagToggle?: (tagId: number) => void;
  onCreateTag?: (name: string, color?: string) => Promise<void>;
  onDeleteTag?: (tagId: number) => void;
}

const empty = { email: '', password: '', client_id: '', refresh_token: '', remark: '', provider: 'outlook', imap_host: '', imap_port: 993, imap_password: '', preferred_channel: '' };

export default function EditAccountDialog({ open, account, onClose, onSave, tags = [], accountTagIds = [], onTagToggle, onCreateTag, onDeleteTag }: Props) {
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [newTag, setNewTag] = useState('');

  // 只在打开对话框 / 切换到另一个账户时重置表单。账户数据在后台刷新（切换标签、批量收取结束、Token 刷新）时
  // account 对象会被替换，之前这里依赖 [account] 会把用户正在输入的内容整个清掉
  const accountId = account?.id ?? null;
  useEffect(() => {
    if (!open) return;
    if (account) {
      setForm({
        email: account.email, password: account.password || '', client_id: account.client_id || '', refresh_token: account.refresh_token || '',
        remark: account.remark || '', provider: account.provider || 'outlook', imap_host: account.imap_host || '', imap_port: account.imap_port || 993,
        imap_password: account.imap_password || '', preferred_channel: account.preferred_channel || '',
      });
    } else setForm(empty);
    setShowSecret(false);
    setNewTag('');
  }, [accountId, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const isOutlook = form.provider === 'outlook';
  const set = (k: keyof typeof empty, v: any) => setForm(f => ({ ...f, [k]: v }));
  const valid = !!form.email && (isOutlook ? !!form.client_id && !!form.refresh_token : !!form.imap_password && (form.provider !== 'custom' || !!form.imap_host));

  const handleSave = async () => {
    setSaving(true);
    try {
      const data: Partial<Account> = { email: form.email, remark: form.remark, provider: form.provider };
      if (isOutlook) Object.assign(data, { password: form.password, client_id: form.client_id, refresh_token: form.refresh_token, preferred_channel: form.preferred_channel });
      else Object.assign(data, { imap_password: form.imap_password, imap_host: form.imap_host, imap_port: Number(form.imap_port) || 993 });
      await onSave(data);
      onClose();
    } catch {
      /* 错误已由上层 toast 提示 */
    } finally {
      setSaving(false);
    }
  };

  const meta = providerMeta(form.provider);

  return (
    <Dialog
      open={open}
      onOpenChange={o => !o && onClose()}
      title={account ? '编辑账户' : '新增账户'}
      icon={account ? UserRoundPen : UserRoundPlus}
      description={account ? account.email : 'Outlook 使用 OAuth（client_id + refresh_token），其他服务商使用 IMAP 授权码'}
      footer={
        <>
          <Button variant="text" onClick={onClose}>取消</Button>
          <Button variant="filled" onClick={handleSave} disabled={saving || !valid}>{saving ? '保存中…' : '保存'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-5 gap-3">
          <Field label="服务商" className="col-span-2">
            <Select value={form.provider} onChange={e => set('provider', e.target.value)}>
              {PROVIDERS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
            </Select>
          </Field>
          <Field label="邮箱地址" className="col-span-3">
            <Input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder={isOutlook ? 'user@outlook.com' : 'user@example.com'} />
          </Field>
        </div>

        {isOutlook ? (
          <>
            <Field label="密码" hint="仅作记录，取信不使用账户密码">
              <div className="relative">
                <Input type={showSecret ? 'text' : 'password'} value={form.password} onChange={e => set('password', e.target.value)} className="pr-11" />
                <button type="button" onClick={() => setShowSecret(!showSecret)} className="absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-on-surface-variant hover:bg-on-surface/[0.08]" aria-label="切换显示">
                  {showSecret ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </Field>
            <Field label="Client ID">
              <Input value={form.client_id} onChange={e => set('client_id', e.target.value)} className="tabular" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
            </Field>
            <Field label="Refresh Token" hint="微软返回的轮换 refresh_token 会自动写回">
              <Textarea value={form.refresh_token} onChange={e => set('refresh_token', e.target.value)} rows={3} className="resize-none text-body-s" />
            </Field>
            {account && (
              <Field label="首选通道" hint={<span className="inline-flex items-center gap-1.5">最近一次：<ChannelBadge channel={account.last_channel} /></span>}>
                <Select value={form.preferred_channel} onChange={e => set('preferred_channel', e.target.value)}>
                  <option value="">自动（Graph → IMAP 新 → IMAP 旧）</option>
                  <option value="graph">Graph API</option>
                  <option value="imap_new">IMAP 新 · outlook.live.com</option>
                  <option value="imap_old">IMAP 旧 · outlook.office365.com</option>
                </Select>
              </Field>
            )}
          </>
        ) : (
          <>
            {form.provider === 'custom' ? (
              <div className="grid grid-cols-4 gap-3">
                <Field label="IMAP 主机" className="col-span-3"><Input value={form.imap_host} onChange={e => set('imap_host', e.target.value)} placeholder="imap.example.com" /></Field>
                <Field label="端口"><Input type="number" value={form.imap_port} onChange={e => set('imap_port', e.target.value)} className="tabular" /></Field>
              </div>
            ) : (
              <div className="flex items-center justify-between rounded-2xl bg-surface-container-highest/70 px-4 py-3 text-body-m">
                <span className="text-on-surface-variant">IMAP 服务器</span>
                <span className="tabular text-on-surface">{meta.host}:993 · SSL</span>
              </div>
            )}
            <Field label="授权码 / 密码" hint={form.provider === 'gmail' ? 'Gmail 需使用「应用专用密码」' : ['qq', '163', '126'].includes(form.provider) ? '请在邮箱网页端开启 IMAP 后生成客户端授权码' : undefined}>
              <div className="relative">
                <Input type={showSecret ? 'text' : 'password'} value={form.imap_password} onChange={e => set('imap_password', e.target.value)} className="pr-11" />
                <button type="button" onClick={() => setShowSecret(!showSecret)} className="absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-on-surface-variant hover:bg-on-surface/[0.08]" aria-label="切换显示">
                  {showSecret ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </Field>
          </>
        )}

        <Field label="备注">
          <Input value={form.remark} onChange={e => set('remark', e.target.value)} placeholder="可选" />
        </Field>

        {account && (
          <div>
            <label className="field-label">标签</label>
            <div className="flex flex-wrap items-center gap-1.5">
              {tags.map(tag => {
                const on = accountTagIds.includes(tag.id);
                return (
                  <span key={tag.id} className={`group/tag inline-flex h-8 items-center gap-1.5 rounded-lg pl-3 pr-1 text-label-l transition-colors ${on ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface-variant shadow-[inset_0_0_0_1px_rgb(var(--outline-variant))] hover:bg-on-surface/[0.06]'}`}>
                    <button type="button" onClick={() => onTagToggle?.(tag.id)} className="inline-flex items-center gap-1.5">
                      <span className="size-2 rounded-full" style={{ backgroundColor: tag.color }} />{tag.name}
                    </button>
                    {onDeleteTag && (
                      <button type="button" title="删除标签" onClick={async () => (await confirmDialog({ title: `删除标签「${tag.name}」？`, danger: true, confirmText: '删除' })) && onDeleteTag(tag.id)} className="rounded-full p-1 opacity-60 hover:bg-on-surface/[0.1] group-hover/tag:opacity-100">
                        <X className="size-3" />
                      </button>
                    )}
                  </span>
                );
              })}
              {onCreateTag && (
                <form className="inline-flex" onSubmit={e => { e.preventDefault(); if (newTag.trim()) { onCreateTag(newTag.trim()); setNewTag(''); } }}>
                  <div className="relative">
                    <Plus className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-on-surface-variant" />
                    <Input value={newTag} onChange={e => setNewTag(e.target.value)} placeholder="新标签" className="h-8 w-28 rounded-lg pl-7 text-body-s" />
                  </div>
                </form>
              )}
            </div>
          </div>
        )}

        {account?.last_error && (
          <div className="rounded-2xl bg-error-container px-4 py-3 text-body-s text-on-error-container">
            <span className="font-medium">最近错误：</span>{account.last_error}
          </div>
        )}
      </div>
    </Dialog>
  );
}
