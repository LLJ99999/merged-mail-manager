import { useState, useEffect } from 'react';
import type { Proxy } from '../../types';
import { Dialog } from '../common/Dialog';
import { Button } from '../common/Button';
import { Input, Field } from '../common/Input';
import { Segmented } from '../common/Misc';
import { Switch } from '../common/Input';
import { Globe } from 'lucide-react';

interface Props {
  open: boolean;
  proxy: Proxy | null;
  onClose: () => void;
  onSave: (data: Partial<Proxy>) => Promise<void>;
}

const initial = { name: '', type: 'socks5' as 'socks5' | 'http', host: '', port: 1080, username: '', password: '', is_default: false };

export default function ProxyForm({ open, proxy, onClose, onSave }: Props) {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(proxy ? { name: proxy.name, type: proxy.type, host: proxy.host, port: proxy.port, username: proxy.username || '', password: proxy.password || '', is_default: !!proxy.is_default } : initial);
  }, [proxy, open]);

  const save = async () => {
    setSaving(true);
    try { await onSave(form); onClose(); } catch { /* toast 已提示 */ } finally { setSaving(false); }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={o => !o && onClose()}
      title={proxy ? '编辑代理' : '添加代理'}
      icon={Globe}
      footer={<><Button variant="text" onClick={onClose}>取消</Button><Button variant="filled" onClick={save} disabled={saving || !form.host || !form.port}>{saving ? '保存中…' : '保存'}</Button></>}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-5 gap-3">
          <Field label="名称" className="col-span-3"><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="例如：香港 SOCKS5" /></Field>
          <Field label="类型" className="col-span-2">
            <Segmented value={form.type} onChange={t => setForm(f => ({ ...f, type: t, port: f.port === 1080 || f.port === 8080 ? (t === 'socks5' ? 1080 : 8080) : f.port }))} options={[{ value: 'socks5', label: 'SOCKS5' }, { value: 'http', label: 'HTTP' }]} className="h-11 w-full [&>button]:flex-1" />
          </Field>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <Field label="主机" className="col-span-3"><Input value={form.host} onChange={e => setForm(f => ({ ...f, host: e.target.value }))} placeholder="127.0.0.1" className="tabular" /></Field>
          <Field label="端口"><Input type="number" value={form.port} onChange={e => setForm(f => ({ ...f, port: Number(e.target.value) }))} className="tabular" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="用户名（可选）"><Input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} /></Field>
          <Field label="密码（可选）"><Input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} /></Field>
        </div>
        <div className="flex items-center justify-between gap-4 rounded-2xl bg-surface-container-highest/60 px-4 py-3">
          <div>
            <p className="text-body-l text-on-surface">设为默认代理</p>
            <p className="text-body-s text-on-surface-variant">所有账户的 Token 刷新、Graph 与 IMAP 请求均经由此代理</p>
          </div>
          <Switch checked={form.is_default} onChange={v => setForm(f => ({ ...f, is_default: v }))} label="设为默认代理" />
        </div>
      </div>
    </Dialog>
  );
}
