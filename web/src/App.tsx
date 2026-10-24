import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import { Toaster } from 'sonner';
import { AppLayout } from './components/layout/AppLayout';
import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import ProxySettings from './pages/ProxySettings';
import MailPage from './pages/Mail';
import SettingsPage from './pages/Settings';
import { Spinner } from './components/common/Misc';
import { LoginDialog } from './components/auth/LoginDialog';
import { Background } from './components/layout/Background';
import { authApi } from './lib/api';
import { ErrorBoundary } from './components/common/ErrorBoundary';

export default function App() {
  const [authRequired, setAuthRequired] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    checkAuth();
    const onAuth = () => { setAuthRequired(true); setShowLogin(true); };
    window.addEventListener('auth-required', onAuth);
    return () => window.removeEventListener('auth-required', onAuth);
  }, []);

  const checkAuth = async () => {
    try {
      const result = await authApi.check();
      setAuthRequired(result.required);
      if (result.required && !localStorage.getItem('auth_token')) {
        setShowLogin(true);
      }
    } catch {
      // 忽略错误
    } finally {
      setChecking(false);
    }
  };

  return (
    <ErrorBoundary scope="app">
    <MotionConfig reducedMotion="user">
      {checking ? (
        <div className="flex h-screen items-center justify-center"><Background /><Spinner className="relative size-8" /></div>
      ) : (
        <BrowserRouter>
          <Toaster
            position="bottom-center"
            offset={24}
            toastOptions={{
              className: '!rounded-2xl !border-0 !bg-inverse-surface !text-inverse-on-surface !text-body-m !shadow-elev-3 !px-4 !py-3.5 !font-sans',
              classNames: { closeButton: '!bg-inverse-surface !text-inverse-on-surface !border-0' },
            }}
          />
          {authRequired && <LoginDialog open={showLogin} onSuccess={() => setShowLogin(false)} />}
          {/* 需要登录时不渲染页面：否则页面在登录框后面发起的请求全部 401，弹出一串「Unauthorized」提示 */}
          {!(authRequired && showLogin) && <Routes>
            <Route element={<AppLayout />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/mail/:accountId?/:mailId?" element={<MailPage />} />
              <Route path="/accounts" element={<Accounts />} />
              <Route path="/proxy" element={<ProxySettings />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Route>
          </Routes>}
        </BrowserRouter>
      )}
    </MotionConfig>
    </ErrorBoundary>
  );
}
