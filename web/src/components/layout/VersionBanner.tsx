import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { versionApi } from '../../lib/api';
import { IconButton } from '../common/Button';

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

/**
 * 前端（本页面构建时的 VERSION）与服务端（/api/version）版本不一致时的提示横幅。
 * 典型原因：升级后旧的服务端仍在后台运行，或前端没有重新构建 —— 浏览器看到的是旧界面 / 新功能不可用。
 * 旧版本服务端没有 /api/version（404）同样视为不一致。可关闭（本次会话内不再显示同一组合）。
 */
export function VersionBanner() {
  const [info, setInfo] = useState<{ server: string; web: string | null } | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      let server = '';
      let web: string | null = null;
      try {
        const v = await versionApi.get();
        server = v.version || '';
        web = v.webBuildVersion;
      } catch (e: any) {
        // 连不上服务器时不提示（其他地方会报错）；404 / 无效响应 = 旧版服务端
        if (/HTTP 404|无效的响应/.test(String(e?.message))) server = '旧版本（无 /api/version）';
        else return;
      }
      if (!alive) return;
      if (server && server === APP_VERSION && (!web || web === APP_VERSION)) { setInfo(null); return; }
      const key = `mm-version-banner:${APP_VERSION}:${server}:${web}`;
      try { if (sessionStorage.getItem(key)) return; } catch { /* ignore */ }
      setInfo({ server: server || '未知', web });
    };
    check();
    const t = window.setInterval(check, 5 * 60 * 1000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);

  if (!info || hidden) return null;
  const close = () => {
    setHidden(true);
    try { sessionStorage.setItem(`mm-version-banner:${APP_VERSION}:${info.server}:${info.web}`, '1'); } catch { /* ignore */ }
  };
  return (
    <div role="alert" data-testid="version-banner" className="relative z-20 mx-3 mt-3 flex items-start gap-3 rounded-2xl bg-error-container px-4 py-3 text-on-error-container shadow-elev-1 md:ml-0">
      <AlertTriangle className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0 flex-1 text-body-m">
        <p className="font-medium">前端版本与服务端不一致，请关闭所有命令窗口后重新运行 start.bat rebuild</p>
        <p className="tabular mt-0.5 text-body-s opacity-80">
          当前页面 v{APP_VERSION} · 服务端 {/^\d/.test(info.server) ? `v${info.server}` : info.server}{info.web ? ` · 已构建前端 v${info.web}` : ''}（macOS / Linux：./start.sh rebuild）
        </p>
      </div>
      <IconButton size="icon-sm" onClick={close} aria-label="关闭提示" title="关闭提示" className="text-on-error-container"><X /></IconButton>
    </div>
  );
}
