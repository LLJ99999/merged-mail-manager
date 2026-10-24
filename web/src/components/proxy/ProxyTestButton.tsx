import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Activity } from 'lucide-react';
import type { ProxyTestResult } from '../../types';
import { Button } from '../common/Button';

export default function ProxyTestButton({ proxyId, onTest }: { proxyId: number; onTest: (id: number) => Promise<ProxyTestResult> }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ProxyTestResult | null>(null);
  const run = async () => {
    setTesting(true);
    setResult(null);
    try { setResult(await onTest(proxyId)); } catch { setResult({ ip: '', latency: 0, status: 'failed' }); } finally { setTesting(false); }
  };
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="tonal" onClick={run} disabled={testing}><Activity className={testing ? 'animate-pulse' : ''} />{testing ? '测试中' : '测试连通'}</Button>
      <AnimatePresence>
        {result && !testing && (
          <motion.span initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className={`tabular text-label-l ${result.status === 'active' ? 'text-success' : 'text-error'}`}>
            {result.status === 'active' ? `${result.latency}ms` : '失败'}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
