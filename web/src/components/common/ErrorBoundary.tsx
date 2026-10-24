import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, LayoutDashboard, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
  /** 变化时自动复位（例如路由段变化：切换到别的页面就重新渲染，而不是一直停在错误卡片） */
  resetKey?: string;
  /** page：页面内的错误卡片；app：整个应用的兜底（Router 之外，使用整页跳转） */
  scope?: 'page' | 'app';
  /** 「返回概览」；未提供时整页跳转到 /dashboard */
  onHome?: () => void;
}

interface State { error: Error | null; resetKey?: string }

const LOG_KEY = 'mm-client-errors';

/** 记录前端渲染错误：控制台 + sessionStorage（最近 20 条）+ 尽力上报给后端日志 */
export function logClientError(error: unknown, info?: { componentStack?: string | null; scope?: string }) {
  const err = error instanceof Error ? error : new Error(String(error));
  const entry = {
    at: new Date().toISOString(),
    path: typeof location !== 'undefined' ? location.pathname + location.search : '',
    scope: info?.scope || 'page',
    message: err.message,
    stack: (err.stack || '').split('\n').slice(0, 8).join('\n'),
    componentStack: (info?.componentStack || '').split('\n').slice(0, 12).join('\n'),
  };
  console.error(`[Mail Manager] 页面渲染出错（${entry.path}）:`, err);
  try {
    const list = JSON.parse(sessionStorage.getItem(LOG_KEY) || '[]');
    list.push(entry);
    sessionStorage.setItem(LOG_KEY, JSON.stringify(list.slice(-20)));
  } catch { /* 存储不可用 */ }
  try {
    const token = localStorage.getItem('auth_token');
    fetch('/api/client-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(entry),
      keepalive: true,
    }).catch(() => { /* 后端不可用时忽略 */ });
  } catch { /* ignore */ }
}

/**
 * 渲染错误边界：任何子树抛出的异常都显示为友好的错误卡片（重试 / 返回概览），绝不让整棵
 * React 树卸载成空白页。AppLayout 中按一级路由包裹页面（导航栏仍可用），App 中再包一层兜底。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.resetKey) return { resetKey: props.resetKey, error: null };
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logClientError(error, { componentStack: info.componentStack, scope: this.props.scope });
  }

  retry = () => this.setState({ error: null });

  home = () => {
    this.setState({ error: null });
    if (this.props.onHome) this.props.onHome();
    else window.location.assign('/dashboard');
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const app = this.props.scope === 'app';
    return (
      <div role="alert" data-testid="error-boundary" className={app ? 'flex min-h-[100dvh] items-center justify-center p-6' : 'flex min-h-[60vh] items-center justify-center p-4'}>
        <div className="card sf-low w-full max-w-md p-6 text-center">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-error-container text-on-error-container">
            <AlertTriangle className="size-6" />
          </div>
          <h2 className="text-title-l text-on-surface">{app ? '应用遇到了问题' : '这个页面出错了'}</h2>
          <p className="mt-1.5 text-body-m text-on-surface-variant">数据可能不完整或格式异常。你可以重试，或返回概览继续使用其他功能。</p>
          <pre className="mt-4 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-surface-container-highest/70 px-3 py-2 text-left font-mono text-[11.5px] text-on-surface-variant">{error.message || String(error)}</pre>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button type="button" onClick={this.retry} className="inline-flex h-10 items-center gap-2 rounded-full bg-primary px-5 text-label-l text-on-primary hover:shadow-elev-1">
              <RotateCcw className="size-[18px]" />重试
            </button>
            <button type="button" onClick={this.home} className="inline-flex h-10 items-center gap-2 rounded-full px-5 text-label-l text-primary ring-1 ring-inset ring-outline-variant hover:bg-primary/[0.08]">
              <LayoutDashboard className="size-[18px]" />返回概览
            </button>
          </div>
        </div>
      </div>
    );
  }
}
