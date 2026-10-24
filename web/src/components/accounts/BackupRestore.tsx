import { useRef, useState } from 'react';
import { DatabaseBackup, ArchiveRestore } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../common/Button';
import { confirmDialog } from '../../stores/ui';
import { downloadBlob } from '../../lib/utils';

export default function BackupRestore({ variant = 'outlined' }: { variant?: 'outlined' | 'tonal' }) {
  const [restoring, setRestoring] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleDownload = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch('/api/backup/download', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok || res.headers.get('content-type')?.includes('json')) throw new Error('下载失败');
      downloadBlob(await res.blob(), `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
    } catch (err: any) {
      toast.error('备份下载失败: ' + err.message);
    }
  };

  const handleRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!(await confirmDialog({ title: '恢复数据库？', message: '恢复将覆盖当前所有数据，且需要重启服务后生效。', confirmText: '恢复', danger: true }))) { e.target.value = ''; return; }
    setRestoring(true);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (let i = 0; i < buf.length; i += 0x8000) binary += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      const token = localStorage.getItem('auth_token');
      const res = await fetch('/api/backup/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ fileContent: btoa(binary) }),
      });
      let json: any = null;
      try { json = await res.json(); } catch { throw new Error(res.status === 413 ? '备份文件过大' : `服务器返回了无效的响应（HTTP ${res.status}）`); }
      if (json.code !== 200) throw new Error(json.message || '恢复失败');
      toast.success('备份已上传，重启服务后生效（重启时自动替换数据库，原数据库保留为 .backup 文件）', { duration: 8000 });
    } catch (err: any) {
      toast.error('恢复失败: ' + err.message);
    } finally {
      setRestoring(false);
      e.target.value = '';
    }
  };

  return (
    <>
      <Button variant={variant} onClick={handleDownload} title="下载 SQLite 备份"><DatabaseBackup />备份</Button>
      <Button variant={variant} onClick={() => fileRef.current?.click()} disabled={restoring}><ArchiveRestore />{restoring ? '恢复中…' : '恢复'}</Button>
      <input ref={fileRef} type="file" accept=".db" onChange={handleRestore} disabled={restoring} className="hidden" />
    </>
  );
}
