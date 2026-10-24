import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Upload, Search, Trash2, Inbox, ShieldAlert, ArrowLeft, Users, MailX, KeyRound, PanelLeftClose, PanelLeftOpen, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { accountApi, isAbortError } from '../lib/api';
import type { Account } from '../types';
import { useMailStore } from '../stores/mails';
import { useAccountStore } from '../stores/accounts';
import { confirmDialog, useUi } from '../stores/ui';
import { cn, CHANNELS, PROVIDERS, timeAgo } from '../lib/utils';
import { listContainer, listItem, spring } from '../lib/motion';
import { ProviderIcon } from '../components/common/ProviderIcon';
import { ChannelBadge } from '../components/common/ChannelBadge';
import { StatusDot } from '../components/common/Badge';
import { Button, IconButton } from '../components/common/Button';
import { Input, Select } from '../components/common/Input';
import { EmptyState, Segmented, Skeleton } from '../components/common/Misc';
import { MailRow, MailListSkeleton } from '../components/mail/MailList';
import { MailContent } from '../components/mail/MailContent';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { mailPath, parseBox, type Box, type MailNavState } from '../lib/mailRoute';
import { FetchSplitButton, FetchScopeButton, FETCH_ICONS } from '../components/mail/FetchButton';
import { AccountFetchBadge } from '../components/mail/FetchProgressPanel';
import { fetchAccount, fetchMany, useAccountBadge, useFetchQueue, useIsAccountBusy, useJob } from '../stores/fetchQueue';

const COLLAPSE_KEY = 'mm-mail-accounts-collapsed';

export default function MailPage() {
  const [params] = useSearchParams();
  const routeParams = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const navState = (location.state || {}) as MailNavState;
  const here = location.pathname + location.search;
  // URL 是唯一来源：账户 / 邮件 / 文件夹
  const accountId = Number(routeParams.accountId) || null;
  const mailId = Number(routeParams.mailId) || null;
  const box: Box = parseBox(params.get('box'));
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accLoading, setAccLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [provider, setProvider] = useState('');
  const [collapsed, setCollapsed] = useState(() => {
    const v = localStorage.getItem(COLLAPSE_KEY);
    // 默认：窗口 < 1440（含 1920×1080 @150% 缩放 = 1280 宽、1366 笔记本）时收起账户栏，给阅读面板留出空间
    return v ? v === '1' : window.innerWidth < 1440;
  });
  const {
    mails, selectedMail, loading, detailLoading, mailsTotal, loadingMore,
    openFolder, clearMailbox, selectMailById, loadMoreMails,
  } = useMailStore();
  const currentAccountId = accountId;
  const currentMailbox = box;
  const setLastMailPath = useUi(s => s.setLastMailPath);
  const storeAccounts = useAccountStore(s => s.accounts);
  const accountsVersion = useUi(s => s.accountsVersion);
  const setImportOpen = useUi(s => s.setImportOpen);

  const wide = useMediaQuery('(min-width: 1024px)');
  const isCollapsed = collapsed && wide;
  const toggleCollapsed = () => setCollapsed(c => { localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1'); return !c; });

  // 账户列表请求：离开页面或重新加载时中止上一次请求，卸载后不再 setState / toast
  const aliveRef = useRef(true);
  const listCtrl = useRef<AbortController | null>(null);
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; listCtrl.current?.abort(); }; }, []);
  const loadAccounts = async () => {
    listCtrl.current?.abort();
    const ctrl = new AbortController();
    listCtrl.current = ctrl;
    try {
      const data = await accountApi.list({ page: 1, pageSize: 10000 }, ctrl.signal);
      if (aliveRef.current && !ctrl.signal.aborted) setAccounts(data.list);
    } catch (e: any) {
      if (!isAbortError(e) && aliveRef.current) toast.error(e?.message || '加载账户失败');
    } finally {
      if (aliveRef.current && listCtrl.current === ctrl) setAccLoading(false);
    }
  };

  useEffect(() => { loadAccounts(); }, [accountsVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!storeAccounts.length) return;
    setAccounts(prev => prev.map(a => storeAccounts.find(s => s.id === a.id) || a));
  }, [storeAccounts]);

  // 旧版链接 /mail?account=1&box=Junk → /mail/1?box=Junk
  const legacyAccount = Number(params.get('account')) || null;
  useEffect(() => {
    if (legacyAccount) navigate(mailPath(legacyAccount, null, parseBox(params.get('box'))), { replace: true });
  }, [legacyAccount]); // eslint-disable-line react-hooks/exhaustive-deps

  // URL → 数据（先切文件夹，再选邮件；effect 按声明顺序执行）
  useEffect(() => { if (!legacyAccount) openFolder(accountId, box); }, [accountId, box]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let alive = true;
    selectMailById(mailId).then(ok => {
      // 邮件不存在（已删除/链接失效）→ 回到列表，避免停在空白阅读面板
      if (alive && !ok) navigate(mailPath(accountId, null, box), { replace: true });
    });
    return () => { alive = false; };
  }, [mailId, accountId, box]); // eslint-disable-line react-hooks/exhaustive-deps
  // 记住最后的邮件位置，导航栏「邮件」回到这里
  useEffect(() => { if (!legacyAccount) setLastMailPath(here); }, [here]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = accounts.find(a => a.id === currentAccountId) || null;
  // 账户已不存在（被删除或链接失效）→ 回到账户列表
  useEffect(() => {
    if (!accLoading && accountId && accounts.length && !current) navigate('/mail', { replace: true });
  }, [accLoading, accountId, accounts, current]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 推入子面板，记录来源，供应用内返回按钮使用 history.back() */
  const pushChild = (to: string) => navigate(to, { state: { mmFrom: here } satisfies MailNavState });
  /** 应用内返回：如果上一条历史就是父面板则后退，否则替换为父面板（例如直接打开的深链接） */
  const goUp = (parent: string) => {
    if (navState.mmFrom === parent) navigate(-1);
    else navigate(parent, { replace: true });
  };

  const filtered = useMemo(() => accounts.filter(a =>
    (!search || a.email.toLowerCase().includes(search.toLowerCase()) || (a.remark || '').toLowerCase().includes(search.toLowerCase())) &&
    (!provider || a.provider === provider)), [accounts, search, provider]);

  const openAccount = (id: number, b: Box = box) => {
    const to = mailPath(id, null, b);
    if (to !== here) pushChild(to);
  };
  const openMail = (id: number) => {
    const to = mailPath(accountId, id, box);
    if (to === here) return;
    // 已在阅读某封邮件时切换到另一封：替换当前记录，后退直接回到列表而不是逐封回溯
    if (mailId) navigate(to, { replace: true, state: navState });
    else pushChild(to);
  };

  // ---- 收取：全部交给 stores/fetchQueue（唯一的收取引擎），这里只读状态、发请求 ----
  const job = useJob(currentAccountId, currentMailbox);
  const jobActive = job?.status === 'queued' || job?.status === 'running';
  const accountBusy = useIsAccountBusy(currentAccountId);
  const cancelAccount = useFetchQueue(s => s.cancelAccount);
  /** 本次会话内这个文件夹最近一次收取的结果（FetchStatus 显示「本次由 … 提供」） */
  const lastResult = job && (job.status === 'ok' || job.status === 'cached') ? job : undefined;

  const target = current ? { id: current.id, email: current.email, provider: current.provider } : null;
  /** 列表头部「收取」：当前账户的当前文件夹 */
  const handleFetch = () => { if (target) void fetchAccount(target, [currentMailbox]); };
  /** 菜单「收取收件箱和垃圾箱」：当前账户的两个文件夹 */
  const handleFetchBoth = () => { if (target) void fetchAccount(target, ['INBOX', 'Junk']); };
  /** 账户栏「收取全部」：当前筛选下的全部账户（≥ 2 个时为批量收取，进度见右下角面板） */
  const fetchAll = () => void fetchMany(filtered.map(a => ({ id: a.id, email: a.email, provider: a.provider })));

  const fetchMenu = [
    { key: 'both', icon: FETCH_ICONS.both, label: '收取收件箱和垃圾箱', hint: '当前账户的两个文件夹', disabled: !current, onSelect: handleFetchBoth },
    ...(accountBusy ? [{ key: 'cancel', icon: FETCH_ICONS.cancel, label: '取消收取', hint: '停止这个账户的收取', onSelect: () => currentAccountId && cancelAccount(currentAccountId) }] : []),
  ];

  const handleClear = async () => {
    if (!currentAccountId) return;
    const ok = await confirmDialog({ title: `清空远端${currentMailbox === 'INBOX' ? '收件箱' : '垃圾箱'}？`, message: '将删除服务器上该文件夹中的全部邮件，此操作不可撤销。', confirmText: '清空', danger: true });
    if (!ok) return;
    try {
      await clearMailbox(currentAccountId, currentMailbox);
      if (mailId) navigate(mailPath(accountId, null, box), { replace: true, state: navState });
      toast.success('已清空');
    } catch (e: any) {
      toast.error(e.message || '清空失败');
    }
  };

  const handleRefreshToken = async () => {
    if (!current) return;
    try {
      const r = await accountApi.refreshToken(current.id);
      r.success ? toast.success(current.account_type === 'imap' ? '登录校验通过' : 'Token 已刷新') : toast.error(r.error || '失败');
      loadAccounts();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const mobilePane: 'accounts' | 'list' | 'reader' = mailId ? 'reader' : accountId ? 'list' : 'accounts';
  const unread = mails.filter(m => !m.is_read).length;

  return (
    <div className="flex h-full min-h-0 gap-3 px-3 pb-[92px] pt-3 md:px-0 md:pb-0 md:pt-0">
      {/* ---- 左：账户（可折叠） ---- */}
      <aside
        className={cn(
          'sf-low w-full shrink-0 flex-col overflow-hidden rounded-[28px] lg:flex',
          isCollapsed ? 'lg:w-[76px]' : 'lg:w-[288px]',
          mobilePane === 'accounts' ? 'flex' : 'hidden',
        )}
      >
        <div className={cn('flex items-center gap-2 pb-2 pt-4', isCollapsed ? 'flex-col justify-center px-0' : 'px-4')}>
          <h2 className={cn('flex-1 text-title-l text-on-surface', isCollapsed && 'hidden')}>邮箱</h2>
          {/* 账户栏是「收取全部」唯一的入口：它作用于上面的搜索 / 服务商筛选结果，未选择账户时也可用；收起时只显示图标 */}
          <FetchScopeButton
            label="收取全部"
            count={filtered.length}
            compact
            size="sm"
            iconOnly={isCollapsed}
            className={cn(!isCollapsed && 'px-3')}
            onClick={fetchAll}
            disabled={!filtered.length}
            testId="fetch-all-accounts"
          />
          <IconButton size="icon-sm" className="hidden lg:inline-flex" onClick={toggleCollapsed} title={isCollapsed ? '展开账户列表' : '收起账户列表'} aria-label="折叠">
            {isCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </IconButton>
        </div>
        <AnimatePresence initial={false}>
          {!isCollapsed && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2 px-4 pb-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-on-surface-variant" />
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索账户" className="h-10 rounded-full pl-10" />
              </div>
              <Select value={provider} onChange={e => setProvider(e.target.value)} className="h-10 rounded-full">
                <option value="">全部服务商</option>
                {PROVIDERS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </Select>
            </motion.div>
          )}
        </AnimatePresence>
        <div className={cn('flex-1 overflow-y-auto pb-3', 'px-2')}>
          {accLoading ? (
            <div className="space-y-2 p-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-2xl" />)}</div>
          ) : filtered.length === 0 ? (
            accounts.length === 0
              ? <EmptyState icon={Users} title="没有账户" description="导入或新增邮箱账户后在这里收信" action={<Button variant="filled" size="sm" onClick={() => setImportOpen(true)}><Upload />导入账户</Button>} />
              : <EmptyState icon={Search} title="没有匹配的账户" description="换个关键词或服务商试试" action={<Button variant="text" size="sm" onClick={() => { setSearch(''); setProvider(''); }}>清除筛选</Button>} />
          ) : (
            <motion.div variants={listContainer} custom={filtered.length} initial="hidden" animate="show" className="space-y-0.5">
              {filtered.map(a => {
                const active = a.id === currentAccountId;
                return (
                  <motion.button
                    key={a.id}
                    variants={listItem}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => openAccount(a.id, currentMailbox)}
                    title={isCollapsed ? a.email : undefined}
                    className={cn('relative flex w-full items-center gap-3 rounded-2xl px-2.5 py-2 text-left', !active && 'hover:bg-on-surface/[0.06]', isCollapsed && 'justify-center px-0')}
                  >
                    {active && <motion.span layoutId="acc-indicator" transition={spring} className="absolute inset-0 rounded-2xl bg-secondary-container" />}
                    <span className="relative">
                      <ProviderIcon provider={a.provider} />
                      {a.status === 'error' && <StatusDot tone="danger" className="absolute -right-0.5 -top-0.5 size-2.5 ring-2 ring-surface-container-low" />}
                      <AccountRowBadge id={a.id} />
                    </span>
                    <div className={cn('relative min-w-0 flex-1', isCollapsed && 'hidden')}>
                      <p className={cn('truncate text-body-m', active ? 'font-medium text-on-secondary-container' : 'text-on-surface')}>{a.email}</p>
                      <div className="mt-1 flex items-center gap-1.5">
                        <ChannelBadge channel={a.last_channel} size="sm" />
                        {a.last_channel_at && <span className="truncate text-body-s text-on-surface-variant">{timeAgo(a.last_channel_at)}</span>}
                      </div>
                    </div>
                  </motion.button>
                );
              })}
            </motion.div>
          )}
        </div>
      </aside>

      {/* ---- 中：邮件列表 ---- */}
      <section className={cn('sf-low w-full shrink-0 flex-col overflow-hidden rounded-[28px] lg:flex lg:w-[380px] 2xl:w-[420px]', mobilePane === 'list' ? 'flex' : 'hidden')}>
        {!current ? (
          <div className="flex flex-1 items-center justify-center"><EmptyState icon={Inbox} title="选择一个邮箱" description="选择账户后显示缓存邮件，点击「收取」从服务器拉取" /></div>
        ) : (
          <>
            <div className="space-y-3 px-4 pb-3 pt-4">
              <div className="flex items-center gap-3">
                <IconButton size="icon-sm" className="lg:hidden" onClick={() => goUp('/mail')} aria-label="返回"><ArrowLeft /></IconButton>
                <ProviderIcon provider={current.provider} size="lg" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-title-m text-on-surface">{current.email}</p>
                  <p className="truncate text-body-s text-on-surface-variant">
                    {current.account_type === 'outlook' ? `OAuth · 首选 ${CHANNELS[current.preferred_channel]?.short || '自动'}` : `${current.imap_host}:${current.imap_port}`}
                  </p>
                </div>
                <IconButton size="icon-sm" title={current.account_type === 'imap' ? '校验登录' : '刷新 Token'} aria-label="刷新 Token" onClick={handleRefreshToken}><KeyRound /></IconButton>
                <IconButton size="icon-sm" onClick={handleClear} disabled={accountBusy || mails.length === 0} title="清空远端文件夹" aria-label="清空"><Trash2 /></IconButton>
              </div>
              <div className="flex items-center gap-2">
                <Segmented
                  value={currentMailbox}
                  onChange={box => openAccount(current.id, box)}
                  options={[
                    { value: 'INBOX', label: <><Inbox />收件箱{currentMailbox === 'INBOX' && unread > 0 && <span className="tabular rounded-full bg-primary px-1.5 text-label-s text-on-primary">{unread}</span>}</> },
                    { value: 'Junk', label: <><ShieldAlert />垃圾箱</> },
                  ]}
                  className="min-w-0 flex-1 [&>button]:flex-1 [&>button]:px-2 [&>button>span]:gap-1"
                />
                <FetchSplitButton
                  busy={jobActive}
                  busyLabel={job?.status === 'queued' ? '排队中…' : '收取中…'}
                  title={jobActive ? `正在收取${currentMailbox === 'Junk' ? '垃圾箱' : '收件箱'}（再次点击不会重复请求${job?.status === 'queued' ? '，会优先处理' : ''}；取消见右侧菜单）` : `收取当前账户的${currentMailbox === 'Junk' ? '垃圾箱' : '收件箱'}`}
                  onFetch={handleFetch}
                  items={fetchMenu}
                />
              </div>
              <FetchStatus channel={lastResult?.channel || current.last_channel} cached={lastResult?.cached} errors={lastResult?.errors || (current.last_channel === 'cache' ? { error: current.last_error } : undefined)} fresh={!!lastResult} at={current.last_channel_at} />
            </div>
            <motion.div layoutScroll className="flex-1 overflow-y-auto pb-3">
              {loading || (job?.status === 'running' && mails.length === 0) ? <MailListSkeleton /> : mails.length === 0 ? (
                <EmptyState icon={MailX} title="暂无缓存邮件" description="点击「收取」按 Graph → IMAP(新) → IMAP(旧) 的顺序拉取" />
              ) : (
                <motion.div key={`${currentAccountId}-${currentMailbox}`} variants={listContainer} custom={mails.length} initial="hidden" animate="show" className="space-y-0.5 px-2">
                  {mails.map(m => <MailRow key={m.id} mail={m} selected={mailId === m.id} onClick={() => openMail(m.id)} />)}
                  {mailsTotal > mails.length && (
                    <div className="flex justify-center py-3">
                      <Button variant="text" size="sm" onClick={() => loadMoreMails().catch((e: any) => toast.error(e?.message || '加载失败'))} disabled={loadingMore} data-testid="mail-load-more">
                        {loadingMore ? '加载中…' : `加载更多（还有 ${mailsTotal - mails.length} 封）`}
                      </Button>
                    </div>
                  )}
                </motion.div>
              )}
            </motion.div>
          </>
        )}
      </section>

      {/* ---- 右：阅读 ---- */}
      <section className={cn('min-w-0 flex-1 flex-col lg:flex', mobilePane === 'reader' ? 'flex' : 'hidden')}>
        <MailContent mail={selectedMail} loading={detailLoading} pending={!!mailId && !selectedMail} onBack={() => goUp(mailPath(accountId, null, box))} />
      </section>
    </div>
  );
}

/** 账户行徽标：单独订阅，避免任何任务变化都重渲染整个账户列表 */
function AccountRowBadge({ id }: { id: number }) {
  return <AccountFetchBadge it={useAccountBadge(id)} />;
}

function FetchStatus({ channel, cached, errors, fresh, at }: { channel?: string; cached?: boolean; errors?: Record<string, string>; fresh: boolean; at?: string | null }) {
  if (!channel) return <p className="px-1 text-body-s text-on-surface-variant">尚未从服务器收取</p>;
  const failed = errors ? Object.entries(errors).filter(([, v]) => v) : [];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 px-1 text-body-s text-on-surface-variant">
        <span>{fresh ? '本次' : '上次'}由</span>
        <ChannelBadge channel={channel} size="sm" />
        <span>提供{!fresh && at ? ` · ${timeAgo(at)}` : ''}</span>
      </div>
      {(cached || channel === 'cache') && failed.length > 0 && (
        <div className="flex items-center gap-2 rounded-2xl bg-warning-container px-3 py-2 text-body-s text-on-warning-container" title={failed.map(([k, v]) => `${k}: ${v}`).join('\n')}>
          <AlertTriangle className="size-4 shrink-0" />
          <span className="truncate">网络通道失败：{failed.map(([k]) => CHANNELS[k]?.short || (k === 'error' ? '全部通道' : k)).join(' / ')}，显示本地缓存</span>
        </div>
      )}
    </div>
  );
}
