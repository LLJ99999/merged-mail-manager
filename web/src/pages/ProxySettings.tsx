import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { useProxyStore } from '../stores/proxy';
import type { Proxy } from '../types';
import ProxyTable from '../components/proxy/ProxyTable';
import ProxyForm from '../components/proxy/ProxyForm';
import { PageHeader } from '../components/common/Misc';
import { Button } from '../components/common/Button';
import { confirmDialog, useUi } from '../stores/ui';
import { motion } from 'framer-motion';
import { Waypoints, Mail, ListOrdered } from 'lucide-react';
import { listContainer, listItem } from '../lib/motion';

export default function ProxySettings() {
  const { proxies, loading, fetchProxies, createProxy, updateProxy, deleteProxy, testProxy, setDefault } = useProxyStore();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Proxy | null>(null);

  useEffect(() => { fetchProxies().catch(() => toast.error('加载代理列表失败')); }, [fetchProxies]);
  const setFab = useUi(s => s.setFab);
  useEffect(() => {
    setFab({ label: '添加代理', icon: 'add', onClick: () => { setEditing(null); setFormOpen(true); } });
    return () => setFab(null);
  }, [setFab]);

  const handleSave = async (data: Partial<Proxy>) => {
    try {
      if (editing) { await updateProxy(editing.id, data); toast.success('代理已更新'); }
      else { await createProxy(data); toast.success('代理已添加'); }
    } catch (e: any) {
      toast.error(e.message || '操作失败');
      throw e;
    }
  };

  const handleDelete = async (id: number) => {
    if (!(await confirmDialog({ title: '删除该代理？', confirmText: '删除', danger: true }))) return;
    try { await deleteProxy(id); toast.success('代理已删除'); } catch (e: any) { toast.error(e.message || '删除失败'); }
  };

  const handleTest = async (id: number) => {
    const r = await testProxy(id);
    r.status === 'active' ? toast.success(`出口 IP ${r.ip} · ${r.latency}ms`) : toast.error('代理连接失败');
    return r;
  };

  return (
    <div>
      <PageHeader
        title="代理"
        description="默认代理会应用到全部通道：OAuth Token 刷新、Graph API、IMAP（新/旧）以及标准 IMAP"
        actions={<Button variant="filled" onClick={() => { setEditing(null); setFormOpen(true); }}><Plus />添加代理</Button>}
      />
      <div>
        <ProxyTable
          proxies={proxies}
          loading={loading}
          onEdit={p => { setEditing(p); setFormOpen(true); }}
          onDelete={handleDelete}
          onTest={handleTest}
          onSetDefault={async id => { try { await setDefault(id); toast.success('已设为默认代理'); } catch (e: any) { toast.error(e.message); } }}
        />
      </div>
      <motion.div variants={listContainer} initial="hidden" animate="show" className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {([
          [Waypoints, 'Graph / OAuth', 'undici Dispatcher：HTTP 代理走 CONNECT，SOCKS5 通过自定义 connector 建立隧道后再 TLS'],
          [Mail, 'IMAP', 'imapflow 原生 proxy 参数，支持 socks5:// 与 http:// CONNECT'],
          [ListOrdered, '优先级', '请求参数中的 proxy_id → 默认代理 → 直连'],
        ] as const).map(([Icon, t, d]) => (
          <motion.div key={t} variants={listItem} className="card sf-low p-5">
            <span className="mb-3 flex size-10 items-center justify-center rounded-xl bg-tertiary-container text-on-tertiary-container"><Icon className="size-5" /></span>
            <p className="mb-1 text-title-s text-on-surface">{t}</p>
            <p className="text-body-m leading-relaxed text-on-surface-variant">{d}</p>
          </motion.div>
        ))}
      </motion.div>
      <ProxyForm open={formOpen} proxy={editing} onClose={() => setFormOpen(false)} onSave={handleSave} />
    </div>
  );
}
