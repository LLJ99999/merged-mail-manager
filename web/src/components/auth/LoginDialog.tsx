import { useState } from 'react';
import { motion } from 'framer-motion';
import { Lock } from 'lucide-react';
import { authApi } from '../../lib/api';
import { Input } from '../common/Input';
import { Button } from '../common/Button';
import { Background } from '../layout/Background';
import { spring } from '../../lib/motion';

export function LoginDialog({ open, onSuccess }: { open: boolean; onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  if (!open) return null;

  const login = async () => {
    if (!password.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await authApi.login(password);
      if (res.token) localStorage.setItem('auth_token', res.token);
      onSuccess();
      window.location.reload();
    } catch (e: any) {
      // 401 / 业务错误 = 密码错误；网络 / 服务端异常显示真实原因（例如服务未启动）
      setError(e?.name === 'AuthError' || /密码|password|401/i.test(String(e?.message)) ? '密码错误' : (e?.message || '登录失败'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <Background />
      <motion.div initial={{ opacity: 0, y: 24, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={spring} className="sf-low relative w-full max-w-[380px] rounded-[28px] p-8 shadow-elev-2">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary-container text-on-primary-container"><Lock className="size-6" /></div>
          <h2 className="text-headline-s">访问验证</h2>
          <p className="mt-1 text-body-m text-on-surface-variant">请输入访问密码以继续</p>
        </div>
        <form className="space-y-3" onSubmit={e => { e.preventDefault(); login(); }}>
          <Input type="password" value={password} onChange={e => { setPassword(e.target.value); setError(''); }} placeholder="访问密码" autoFocus />
          {error && <p className="px-1 text-body-s text-error">{error}</p>}
          <Button type="submit" variant="filled" size="lg" className="w-full" disabled={loading || !password.trim()}>{loading ? '验证中…' : '继续'}</Button>
        </form>
      </motion.div>
    </div>
  );
}
