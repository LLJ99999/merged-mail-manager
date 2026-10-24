import { useState } from 'react';
import { FileUp, ClipboardPaste, Wand2, Info, ArrowLeft, Upload, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { CountUp } from '../common/Misc';
import { toast } from 'sonner';
import type { ImportPreviewResult } from '../../types';
import { accountApi } from '../../lib/api';
import { Dialog } from '../common/Dialog';
import { Button } from '../common/Button';
import { Textarea, Input } from '../common/Input';
import { Segmented } from '../common/Misc';
import { ProviderIcon } from '../common/ProviderIcon';
import { PROVIDERS, cn, providerMeta } from '../../lib/utils';

interface Props {
  open: boolean;
  onClose: () => void;
  onImport: () => void;
}

const FORMAT_HINTS: Record<string, { format: string; example: string; note: string }> = {
  auto: {
    format: '每行一个账户，自动识别格式',
    example: 'user@outlook.com----密码----client_id----refresh_token\nuser@gmail.com----应用专用密码\nme@corp.com----密码----mail.corp.com----993',
    note: '含 UUID client_id 或长 token 的行按 Outlook 处理；第 4 段为端口的行按自定义 IMAP；两段的行按邮箱域名匹配服务商。',
  },
  outlook: {
    format: 'email----password----client_id----refresh_token',
    example: 'user@outlook.com----P@ssw0rd----9e5f94bc-e8a4-4e73-b8be-63364c29d753----M.C5_BAY.0.U.-Cg...',
    note: 'client_id 与 refresh_token 顺序可互换，系统会根据 UUID 自动识别。取信顺序：Graph → IMAP(新) → IMAP(旧) → 本地缓存。',
  },
  custom: {
    format: 'email----password----imap_host----imap_port',
    example: 'me@company.com----secret----mail.company.com----993',
    note: '端口 993 使用 SSL/TLS；其他端口会尝试 STARTTLS。',
  },
};

function hintFor(provider: string) {
  if (FORMAT_HINTS[provider]) return FORMAT_HINTS[provider];
  const meta = providerMeta(provider);
  const sample = { gmail: 'user@gmail.com----abcd efgh ijkl mnop', qq: '123456@qq.com----授权码', '163': 'user@163.com----授权码', '126': 'user@126.com----授权码', yahoo: 'user@yahoo.com----app-password', aliyun: 'user@aliyun.com----密码', '2925': 'user@2925.com----密码' }[provider] || 'user@example.com----授权码';
  const notes: Record<string, string> = {
    gmail: '需开启两步验证并生成「应用专用密码」；IMAP 主机 imap.gmail.com:993。',
    qq: '在 QQ 邮箱「设置 → 账户」开启 IMAP 并生成授权码；imap.qq.com:993。',
    '163': '需在网页端开启 IMAP 并使用客户端授权码；连接时自动发送 IMAP ID 避免 Unsafe Login。',
    '126': '需在网页端开启 IMAP 并使用客户端授权码；连接时自动发送 IMAP ID。',
    yahoo: '使用 Yahoo 账户安全页生成的 App Password；imap.mail.yahoo.com:993。',
    aliyun: '阿里邮箱 imap.aliyun.com:993。',
    '2925': '2925 邮箱 imap.2925.com:993。',
  };
  return { format: 'email----授权码', example: sample, note: notes[provider] || `${meta.label} 预设 IMAP。` };
}

/**
 * 读取导入文件：Windows 记事本「Unicode」保存为 UTF-16 LE（带 BOM），旧版 Excel / 记事本「ANSI」在中文系统下是 GBK。
 * file.text() 一律按 UTF-8 解码，这两种文件会变成乱码、导入全部失败。按 BOM → 严格 UTF-8 → GB18030 依次尝试。
 */
async function decodeTextFile(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf); // 自动去掉 UTF-8 BOM
  } catch {
    try { return new TextDecoder('gb18030').decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); }
  }
}

export default function ImportDialog({ open, onClose, onImport }: Props) {
  const [provider, setProvider] = useState('auto');
  const [source, setSource] = useState<'paste' | 'file'>('paste');
  const [content, setContent] = useState('');
  const [separator, setSeparator] = useState('----');
  const [fileName, setFileName] = useState('');
  const [step, setStep] = useState<'input' | 'preview'>('input');
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [mode, setMode] = useState<'skip' | 'overwrite'>('skip');
  const [loading, setLoading] = useState(false);

  const hint = hintFor(provider);
  const lineCount = content.split('\n').filter(l => l.trim()).length;

  const reset = () => {
    setContent(''); setFileName(''); setStep('input'); setPreview(null); setMode('skip');
  };
  const close = () => { reset(); onClose(); };

  const [dragOver, setDragOver] = useState(false);
  const loadFile = async (file: File) => {
    try {
      setContent(await decodeTextFile(file));
      setFileName(file.name);
    } catch (err: any) {
      toast.error(`无法读取文件：${err?.message || err}`);
    }
  };
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // 清空 value：再次选择同一个文件（修改后重新导入）也能触发 change
    e.target.value = '';
    if (file) loadFile(file);
  };

  const payload = () => ({ content, separator, provider });

  const handlePreview = async () => {
    setLoading(true);
    try {
      setPreview(await accountApi.importPreview(payload()));
      setStep('preview');
    } catch (err: any) {
      toast.error('解析失败: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    setLoading(true);
    try {
      const r = await accountApi.importConfirm({ ...payload(), mode });
      toast.success(`导入 ${r.imported} 个，跳过 ${r.skipped} 个${r.errors.length ? `，${r.errors.length} 行错误` : ''}`);
      onImport();
      close();
    } catch (err: any) {
      toast.error('导入失败: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const byProvider = (preview?.newItems || []).concat(preview?.duplicates || []).reduce<Record<string, number>>((acc, it) => {
    acc[it.provider] = (acc[it.provider] || 0) + 1;
    return acc;
  }, {});

  return (
    <Dialog
      open={open}
      onOpenChange={o => !o && close()}
      title={step === 'input' ? '导入账户' : '确认导入'}
      icon={Upload}
      description={step === 'input' ? '选择服务商与数据来源，支持 Outlook OAuth、预设 IMAP 与自定义 IMAP 混合导入' : `${lineCount} 行已解析`}
      className="max-w-[720px]"
      footer={
        step === 'input' ? (
          <>
            <span className="tabular mr-auto text-body-s text-on-surface-variant">{lineCount} 行</span>
            <Button variant="text" onClick={close}>取消</Button>
            <Button variant="filled" onClick={handlePreview} disabled={loading || !content.trim()}>{loading ? '解析中…' : '下一步'}</Button>
          </>
        ) : (
          <>
            <Button variant="text" onClick={() => setStep('input')} className="mr-auto"><ArrowLeft />返回</Button>
            <Button variant="text" onClick={close}>取消</Button>
            <Button variant="filled" onClick={handleConfirm} disabled={loading || (!preview?.newItems.length && !(mode === 'overwrite' && preview?.duplicates.length))}>
              {loading ? '导入中…' : '确认导入'}
            </Button>
          </>
        )
      }
    >
      {step === 'input' ? (
        <div className="space-y-4">
          <div>
            <label className="field-label">服务商</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <ProviderChip active={provider === 'auto'} onClick={() => setProvider('auto')} icon={<span className="flex size-7 items-center justify-center rounded-[9px] bg-tertiary-container text-on-tertiary-container"><Wand2 className="size-3.5" /></span>} label="自动识别" />
              {PROVIDERS.map(p => (
                <ProviderChip key={p.key} active={provider === p.key} onClick={() => setProvider(p.key)} icon={<ProviderIcon provider={p.key} size="sm" />} label={p.key === 'custom' ? '自定义' : p.label} />
              ))}
            </div>
          </div>

          <AnimatePresence mode="wait" initial={false}>
          <motion.div key={provider} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }} className="rounded-2xl bg-surface-container-highest/70 p-4">
            <div className="flex items-start gap-3">
              <Info className="mt-0.5 size-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-title-s text-on-surface">{hint.format}</p>
                <pre className="overflow-x-auto whitespace-pre rounded-xl bg-surface-container-lowest/80 px-3 py-2 font-mono text-[11.5px] leading-relaxed text-on-surface-variant">{hint.example}</pre>
                <p className="text-body-s text-on-surface-variant">{hint.note}</p>
              </div>
            </div>
          </motion.div>
          </AnimatePresence>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented value={source} onChange={setSource} options={[{ value: 'paste', label: <><ClipboardPaste />粘贴</> }, { value: 'file', label: <><FileUp />文件</> }]} />
            <div className="flex items-center gap-2">
              <span className="text-body-s text-on-surface-variant">分隔符</span>
              <Input value={separator} onChange={e => setSeparator(e.target.value)} className="h-9 w-24 rounded-full text-center" />
            </div>
          </div>

          {source === 'paste' ? (
            <Textarea value={content} onChange={e => setContent(e.target.value)} rows={7} className="font-mono text-[12.5px]" placeholder={hint.example} spellCheck={false} />
          ) : (
            <label
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) loadFile(f); }}
              className={cn('flex h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl bg-surface-container-highest/60 text-center transition-colors hover:bg-surface-container-highest focus-within:shadow-[inset_0_0_0_2px_rgb(var(--primary))]', dragOver ? 'shadow-[inset_0_0_0_2px_rgb(var(--primary))]' : 'shadow-[inset_0_0_0_2px_rgb(var(--outline-variant))]')}
            >
              <span className="flex size-11 items-center justify-center rounded-2xl bg-primary-container text-on-primary-container"><FileUp className="size-5" /></span>
              <span className="max-w-full truncate px-4 text-title-s">{fileName || '选择或拖入 .txt / .csv 文件'}</span>
              <span className="text-body-s text-on-surface-variant">{fileName ? `${lineCount} 行` : '每行一个账户'}</span>
              <input type="file" accept=".txt,.csv,text/plain,text/csv" onChange={handleFile} className="sr-only" data-testid="import-file-input" />
            </label>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: '新增', value: preview?.newItems.length || 0, cls: 'bg-primary-container text-on-primary-container' },
              { label: '已存在', value: preview?.duplicates.length || 0, cls: 'bg-warning-container text-on-warning-container' },
              { label: '错误行', value: preview?.errors.length || 0, cls: 'bg-error-container text-on-error-container' },
            ].map(s => (
              <div key={s.label} className={cn('rounded-2xl px-4 py-3', s.cls)}>
                <p className="text-label-m opacity-80">{s.label}</p>
                <CountUp value={s.value} className="text-headline-s font-medium" duration={0.6} />
              </div>
            ))}
          </div>

          {Object.keys(byProvider).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(byProvider).map(([k, n]) => (
                <span key={k} className="inline-flex h-8 items-center gap-2 rounded-lg bg-surface-container-highest pl-1 pr-3 text-label-l">
                  <ProviderIcon provider={k} size="sm" className="size-6 rounded-md" />{providerMeta(k).label}<span className="tabular text-on-surface-variant">{n}</span>
                </span>
              ))}
            </div>
          )}

          {(preview?.duplicates.length || 0) > 0 && (
            <div>
              <label className="field-label">已存在的账户</label>
              <Segmented value={mode} onChange={setMode} options={[{ value: 'skip', label: '跳过' }, { value: 'overwrite', label: '覆盖更新' }]} />
              <ul className="mt-3 max-h-32 overflow-y-auto rounded-2xl bg-surface-container-highest/60 py-1 text-body-m">
                {preview!.duplicates.map(d => (
                  <li key={d.line} className="flex items-center gap-2.5 px-4 py-1.5">
                    <span className="tabular w-10 text-body-s text-on-surface-variant">L{d.line}</span>{d.email}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(preview?.newItems.length || 0) > 0 && (
            <div>
              <label className="field-label">将新增</label>
              <ul className="max-h-44 overflow-y-auto rounded-2xl bg-surface-container-highest/60 py-1 text-body-m">
                {preview!.newItems.map(d => (
                  <li key={d.line} className="flex items-center gap-2.5 px-4 py-1.5">
                    <span className="tabular w-10 text-body-s text-on-surface-variant">L{d.line}</span>
                    <ProviderIcon provider={d.provider} size="sm" />
                    <span className="flex-1 truncate">{d.email}</span>
                    <span className="text-body-s text-on-surface-variant">{d.account_type === 'outlook' ? 'OAuth' : d.imap_host}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(preview?.errors.length || 0) > 0 && (
            <div>
              <label className="field-label">错误</label>
              <ul className="max-h-32 overflow-y-auto rounded-2xl bg-error-container px-4 py-3 text-body-s text-on-error-container">
                {preview!.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

function ProviderChip({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      title={label}
      whileTap={{ scale: 0.95 }}
      className={cn(
        'relative flex h-11 items-center gap-2 rounded-2xl pl-2 pr-2 text-left text-label-l transition-colors',
        active ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface hover:bg-on-surface/[0.06] shadow-[inset_0_0_0_1px_rgb(var(--outline-variant))]',
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </motion.button>
  );
}
