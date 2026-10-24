import { motion } from 'framer-motion';
import { Star, Pencil, Trash2, Globe, Shield, Network } from 'lucide-react';
import type { Proxy, ProxyTestResult } from '../../types';
import ProxyTestButton from './ProxyTestButton';
import { Badge } from '../common/Badge';
import { EmptyState, Skeleton } from '../common/Misc';
import { IconButton } from '../common/Button';
import { cn, timeAgo } from '../../lib/utils';
import { listContainer, listItem } from '../../lib/motion';

interface Props {
  proxies: Proxy[];
  loading: boolean;
  onEdit: (proxy: Proxy) => void;
  onDelete: (id: number) => void;
  onTest: (id: number) => Promise<ProxyTestResult>;
  onSetDefault: (id: number) => void;
}

/** 代理以卡片网格展示：默认代理使用 primary 容器色突出 */
export default function ProxyTable({ proxies, loading, onEdit, onDelete, onTest, onSetDefault }: Props) {
  if (loading && proxies.length === 0) {
    return <div className="grid gap-4 md:grid-cols-2">{[0, 1].map(i => <div key={i} className="card sf-low space-y-3 p-5"><Skeleton className="h-6 w-40" /><Skeleton className="h-4 w-56" /><Skeleton className="h-9 w-full rounded-full" /></div>)}</div>;
  }
  if (proxies.length === 0) {
    return <div className="card sf-low"><EmptyState icon={Globe} title="暂无代理" description="添加 SOCKS5 或 HTTP 代理后，可设为默认以应用到所有取信通道" /></div>;
  }
  return (
    <motion.div variants={listContainer} initial="hidden" animate="show" className="grid gap-4 md:grid-cols-2">
      {proxies.map(p => (
        <motion.div
          key={p.id}
          variants={listItem}
          whileHover={{ scale: 1.01, y: -2 }}
          className={cn('card relative overflow-hidden p-5', p.is_default ? 'bg-primary-container/60 sf-low' : 'sf-low')}
        >
          <div className="flex items-start gap-4">
            <span className={cn('flex size-12 shrink-0 items-center justify-center rounded-2xl', p.is_default ? 'bg-primary text-on-primary' : 'bg-secondary-container text-on-secondary-container')}>
              {p.type === 'socks5' ? <Shield className="size-5" /> : <Network className="size-5" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-title-m text-on-surface">{p.name || '未命名'}</h3>
                {!!p.is_default && <Badge tone="primary" icon={Star}>默认</Badge>}
                <Badge tone="neutral">{p.type === 'socks5' ? 'SOCKS5' : 'HTTP'}</Badge>
              </div>
              <p className="tabular mt-1 truncate text-body-m text-on-surface-variant">{p.host}:{p.port}{p.username && ` · ${p.username}`}</p>
            </div>
            {p.status === 'active' ? <Badge tone="success" dot>在线</Badge> : p.status === 'failed' ? <Badge tone="danger" dot>失败</Badge> : <Badge dot>未测试</Badge>}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl bg-surface-container-highest/60 px-4 py-2.5 text-body-s text-on-surface-variant">
            <span>出口 IP</span>
            <span className="tabular text-body-m text-on-surface">{p.last_test_ip || '—'}</span>
            {p.last_tested_at && <span className="ml-auto">{timeAgo(p.last_tested_at)}测试</span>}
          </div>
          <div className="mt-3 flex items-center gap-1">
            <ProxyTestButton proxyId={p.id} onTest={onTest} />
            <div className="ml-auto flex items-center">
              {!p.is_default && <IconButton title="设为默认" aria-label="设为默认" onClick={() => onSetDefault(p.id)}><Star /></IconButton>}
              <IconButton title="编辑" aria-label="编辑" onClick={() => onEdit(p)}><Pencil /></IconButton>
              <IconButton title="删除" aria-label="删除" className="hover:bg-error/10 hover:text-error" onClick={() => onDelete(p.id)}><Trash2 /></IconButton>
            </div>
          </div>
        </motion.div>
      ))}
    </motion.div>
  );
}
