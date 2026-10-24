import { useEffect, useState, useCallback, useRef } from 'react';
import { mailPath } from '../lib/mailRoute';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { RefreshCw, KeyRound, AlertTriangle, ChevronRight, Clock, CircleSlash, Globe, Inbox, Mail, Users, ShieldAlert, Wifi, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { accountApi, dashboardApi, isAbortError } from '../lib/api';
import { fetchMany } from '../stores/fetchQueue';
import { FetchScopeButton } from '../components/mail/FetchButton';
import type { DashboardStats } from '../types';
import { Button, IconButton } from '../components/common/Button';
import { PageHeader, EmptyState, CountUp, Skeleton } from '../components/common/Misc';
import { ProviderIcon, SenderAvatar } from '../components/common/ProviderIcon';
import { ChannelBadge } from '../components/common/ChannelBadge';
import { CHANNELS, cn, providerMeta, shortTime } from '../lib/utils';
import { listContainer, listItem, spring } from '../lib/motion';
import { confirmDialog, useUi } from '../stores/ui';

const CHANNEL_FILL: Record<string, string> = {
  graph: 'bg-primary', imap_new: 'bg-secondary', imap_old: 'bg-tertiary', imap: 'bg-secondary/60', cache: 'bg-warning',
};

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshingTokens, setRefreshingTokens] = useState(false);
  const navigate = useNavigate();
  const accountsVersion = useUi(s => s.accountsVersion);

  // 离开页面时中止统计请求，卸载后不再 setState
  const ctrlRef = useRef<AbortController | null>(null);
  useEffect(() => () => ctrlRef.current?.abort(), []);
  const fetchStats = useCallback(async (isRefresh = false) => {
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    try {
      isRefresh ? setRefreshing(true) : setLoading(true);
      setError(null);
      const data = await dashboardApi.stats(ctrl.signal);
      if (!ctrl.signal.aborted) setStats(data);
    } catch (err: any) {
      if (isAbortError(err) || ctrl.signal.aborted) return;
      setError(err?.message || '加载失败');
    } finally {
      if (ctrlRef.current === ctrl) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);
  /** 概览唯一的收取入口：全部账户（交给收取引擎；运行中再点击 = 追加，不重复） */
  const fetchAllAccounts = async () => {
    try {
      const all = await accountApi.list({ page: 1, pageSize: 10000 });
      await fetchMany(all.list.map(a => ({ id: a.id, email: a.email, provider: a.provider })));
    } catch (e: any) {
      toast.error(e?.message || '加载账户失败');
    }
  };
  useEffect(() => { if (accountsVersion) fetchStats(true); }, [accountsVersion, fetchStats]);

  const refreshAllTokens = async () => {
    if (!(await confirmDialog({ title: '刷新全部 Token？', message: '将依次刷新全部账户的 Token（IMAP 账户执行登录校验），可能需要一些时间。', confirmText: '开始刷新' }))) return;
    setRefreshingTokens(true);
    try {
      const r = await accountApi.refreshTokens();
      toast[r.failed ? 'warning' : 'success'](`Token 刷新完成：成功 ${r.success} / 失败 ${r.failed}`);
      fetchStats(true);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setRefreshingTokens(false);
    }
  };

  const header = (
    <PageHeader
      title="概览"
      description="所有邮箱账户、取信通道与代理的运行状况"
      actions={
        <>
          <FetchScopeButton variant="filled" label="收取全部" onClick={fetchAllAccounts} disabled={!stats?.totalAccounts} testId="dashboard-fetch-all" />
          <Button variant="tonal" onClick={refreshAllTokens} disabled={refreshingTokens || !stats?.totalAccounts}>
            <KeyRound className={cn(refreshingTokens && 'animate-pulse')} />
            {refreshingTokens ? '刷新中…' : '刷新全部 Token'}
          </Button>
          <IconButton variant="outlined" onClick={() => fetchStats(true)} disabled={refreshing} title="刷新" aria-label="刷新">
            <RefreshCw className={cn(refreshing && 'animate-[spin_0.9s_linear_infinite]')} />
          </IconButton>
        </>
      }
    />
  );

  if (loading) return <>{header}<DashboardSkeleton /></>;
  if (error || !stats) {
    return (
      <>
        {header}
        <div className="card sf-low">
          <EmptyState icon={AlertTriangle} title="加载失败" description={error || ''} action={<Button variant="filled" onClick={() => fetchStats()}><RefreshCw />重试</Button>} />
        </div>
      </>
    );
  }

  const tiles = [
    { label: '账户', value: stats.totalAccounts, sub: `${stats.activeAccounts} 正常 · ${stats.errorAccounts} 异常`, icon: Users, tone: 'bg-primary-container text-on-primary-container', to: '/accounts' },
    { label: '收件箱缓存', value: stats.totalInboxMails, sub: '封邮件', icon: Inbox, tone: 'bg-secondary-container text-on-secondary-container', to: '/mail' },
    { label: '垃圾箱缓存', value: stats.totalJunkMails, sub: '封邮件', icon: ShieldAlert, tone: 'bg-tertiary-container text-on-tertiary-container', to: '/mail' },
    { label: '代理在线', value: stats.activeProxies, sub: `共 ${stats.totalProxies} 个代理`, icon: Wifi, tone: 'bg-success-container text-on-success-container', to: '/proxy' },
  ];

  const health = [
    { icon: Clock, label: 'Token 超过 60 天未刷新', count: stats.expiringTokens, to: '/accounts', tone: 'warning' },
    { icon: AlertTriangle, label: '异常账户', count: stats.errorAccounts, to: '/accounts?status=error', tone: 'danger' },
    { icon: CircleSlash, label: '从未使用的账户', count: stats.unusedAccounts, to: '/accounts', tone: 'neutral' },
    { icon: Globe, label: '代理（点击测试）', count: stats.totalProxies, to: '/proxy', tone: 'neutral' },
  ] as const;

  const providerMax = Math.max(1, ...stats.providerStats.map(p => p.count));
  const channelOrder = ['graph', 'imap_new', 'imap_old', 'imap', 'cache'];
  const channelMap = Object.fromEntries(stats.channelStats.map(c => [c.channel, c.count]));
  const channelTotal = stats.channelStats.reduce((a, b) => a + b.count, 0);

  return (
    <div>
      {header}
      <motion.div variants={listContainer} initial="hidden" animate="show" className="space-y-4">
        {/* 指标卡 */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {tiles.map(t => (
            <motion.button
              key={t.label}
              variants={listItem}
              whileHover={{ scale: 1.02, y: -2 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => navigate(t.to)}
              className="card sf-low group relative overflow-hidden p-5 text-left"
            >
              <div className="flex items-start justify-between">
                <span className={cn('flex size-11 items-center justify-center rounded-2xl', t.tone)}><t.icon className="size-5" /></span>
                <ArrowRight className="size-4 -translate-x-1 text-on-surface-variant opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100" />
              </div>
              <p className="mt-4 text-label-l text-on-surface-variant">{t.label}</p>
              <CountUp value={t.value} className="mt-0.5 block text-display-s font-medium tracking-tight text-on-surface" />
              <p className="mt-0.5 text-body-s text-on-surface-variant">{t.sub}</p>
            </motion.button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* 待处理 */}
          <motion.section variants={listItem} className="card sf-low pb-3">
            <div className="card-header"><h2 className="card-title">待处理</h2></div>
            <ul className="px-2">
              {health.map(h => (
                <li key={h.label}>
                  <motion.button whileTap={{ scale: 0.98 }} onClick={() => navigate(h.to)} className="group flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-on-surface/[0.06]">
                    <span className={cn('flex size-9 items-center justify-center rounded-xl',
                      h.count === 0 ? 'bg-surface-container-highest text-on-surface-variant' : h.tone === 'danger' ? 'bg-error-container text-on-error-container' : h.tone === 'warning' ? 'bg-warning-container text-on-warning-container' : 'bg-secondary-container text-on-secondary-container')}>
                      <h.icon className="size-[18px]" />
                    </span>
                    <span className="flex-1 text-body-m">{h.label}</span>
                    <span className={cn('tabular text-title-m', h.count === 0 ? 'text-on-surface-variant' : h.tone === 'danger' ? 'text-error' : h.tone === 'warning' ? 'text-warning' : 'text-on-surface')}>{h.count}</span>
                    <ChevronRight className="size-4 text-on-surface-variant transition-transform group-hover:translate-x-0.5" />
                  </motion.button>
                </li>
              ))}
            </ul>
          </motion.section>

          {/* 服务商分布 */}
          <motion.section variants={listItem} className="card sf-low pb-4">
            <div className="card-header">
              <h2 className="card-title">服务商</h2>
              <span className="text-body-s text-on-surface-variant">{stats.totalAccounts} 个账户</span>
            </div>
            <div className="space-y-3 px-5 pt-1">
              {stats.providerStats.length === 0 && <p className="py-6 text-center text-body-m text-on-surface-variant">暂无账户</p>}
              {stats.providerStats.map((p, i) => (
                <div key={p.provider} className="flex items-center gap-3">
                  <ProviderIcon provider={p.provider} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center justify-between text-body-s">
                      <span className="text-on-surface">{providerMeta(p.provider).label}</span>
                      <span className="tabular text-on-surface-variant">{p.count}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-surface-container-highest">
                      <motion.div
                        className="h-full origin-left rounded-full bg-primary"
                        style={{ width: `${(p.count / providerMax) * 100}%` }}
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: 1 }}
                        transition={{ ...spring, delay: 0.15 + i * 0.05 }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </motion.section>

          {/* 通道分布 */}
          <motion.section variants={listItem} className="card sf-low pb-4">
            <div className="card-header">
              <h2 className="card-title">最近取信通道</h2>
            </div>
            <p className="-mt-1 px-5 text-body-s text-on-surface-variant">Graph → IMAP-new → IMAP-old → Cache</p>
            <div className="px-5 pt-3">
              {channelTotal > 0 && (
                <div className="mb-4 flex h-3 gap-1 overflow-hidden">
                  {channelOrder.filter(c => channelMap[c]).map((c, i) => (
                    <motion.div
                      key={c}
                      className={cn('h-full origin-left rounded-full', CHANNEL_FILL[c])}
                      style={{ width: `${(channelMap[c] / channelTotal) * 100}%` }}
                      initial={{ scaleX: 0, opacity: 0 }}
                      animate={{ scaleX: 1, opacity: 1 }}
                      transition={{ ...spring, delay: 0.2 + i * 0.06 }}
                    />
                  ))}
                </div>
              )}
              <ul className="space-y-2.5">
                {channelOrder.map(c => (
                  <li key={c} className="flex items-center gap-2">
                    <ChannelBadge channel={c} />
                    <span className="min-w-0 flex-1 truncate text-body-s text-on-surface-variant">{CHANNELS[c].hint}</span>
                    <span className="tabular text-title-s">{channelMap[c] || 0}</span>
                  </li>
                ))}
              </ul>
            </div>
          </motion.section>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          {/* 最近邮件 */}
          <motion.section variants={listItem} className="card sf-low pb-3 lg:col-span-3">
            <div className="card-header">
              <h2 className="card-title">最近邮件</h2>
              <Button variant="text" size="sm" onClick={() => navigate('/mail')}>打开邮件<ChevronRight /></Button>
            </div>
            {stats.recentMails.length === 0 ? (
              <EmptyState icon={Mail} title="暂无邮件" description="在「邮件」页选择账户并收取后，会在这里显示" />
            ) : (
              <ul className="px-2">
                {stats.recentMails.slice(0, 7).map(m => (
                  <li key={m.id}>
                    <motion.button whileTap={{ scale: 0.99 }} onClick={() => navigate(mailPath(m.account_id, m.id, m.mailbox))} className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-on-surface/[0.06]">
                      <SenderAvatar name={m.sender_name || m.sender} seedKey={m.sender || ''} size={36} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="truncate text-title-s text-on-surface">{m.sender_name || m.sender || '未知发件人'}</span>
                          {m.mailbox === 'Junk' && <span className="rounded-full bg-warning-container px-2 text-label-s text-on-warning-container">垃圾</span>}
                        </div>
                        <p className="truncate text-body-m text-on-surface-variant">{m.subject || '(无主题)'}</p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className="tabular text-label-m text-on-surface-variant">{shortTime(m.mail_date)}</span>
                        <ProviderIcon provider={m.account_provider} size="sm" className="size-6 rounded-lg text-[9px]" />
                      </div>
                    </motion.button>
                  </li>
                ))}
              </ul>
            )}
          </motion.section>

          {/* 账户缓存 */}
          <motion.section variants={listItem} className="card sf-low pb-3 lg:col-span-2">
            <div className="card-header">
              <h2 className="card-title">账户缓存</h2>
              <Button variant="text" size="sm" onClick={() => navigate('/accounts')}>管理<ChevronRight /></Button>
            </div>
            {stats.accountStats.length === 0 ? (
              <EmptyState icon={Inbox} title="还没有账户" description="点击「导入」或在「账户」页新增" />
            ) : (
              <ul className="px-2">
                {stats.accountStats.slice(0, 7).map(a => (
                  <li key={a.account_id}>
                    <motion.button whileTap={{ scale: 0.99 }} onClick={() => navigate(mailPath(a.account_id))} className="flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition-colors hover:bg-on-surface/[0.06]">
                      <ProviderIcon provider={a.provider} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body-m text-on-surface">{a.email}</p>
                        <div className="mt-0.5"><ChannelBadge channel={a.last_channel} size="sm" /></div>
                      </div>
                      <div className="text-right">
                        <p className="tabular text-title-s text-on-surface">{a.inbox_count}</p>
                        <p className="tabular text-body-s text-on-surface-variant">垃圾 {a.junk_count}</p>
                      </div>
                    </motion.button>
                  </li>
                ))}
              </ul>
            )}
          </motion.section>
        </div>
      </motion.div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card sf-low space-y-3 p-5">
            <Skeleton className="size-11 rounded-2xl" />
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-3 w-28" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="card sf-low space-y-4 p-5">
            <Skeleton className="h-4 w-24" />
            {Array.from({ length: 4 }).map((_, j) => <Skeleton key={j} className="h-8 w-full rounded-xl" />)}
          </div>
        ))}
      </div>
    </div>
  );
}
