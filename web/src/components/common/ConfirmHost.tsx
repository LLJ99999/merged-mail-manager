import { AlertTriangle, HelpCircle } from 'lucide-react';
import { useUi } from '../../stores/ui';
import { Dialog } from './Dialog';
import { Button } from './Button';

/** 全局确认对话框宿主：配合 confirmDialog() 使用 */
export function ConfirmHost() {
  const req = useUi(s => s.confirmReq);
  const set = useUi(s => s.setConfirmReq);
  const done = (ok: boolean) => { req?.resolve(ok); set(null); };
  return (
    <Dialog
      open={!!req}
      onOpenChange={o => !o && done(false)}
      icon={req?.danger ? AlertTriangle : HelpCircle}
      title={req?.title ?? ''}
      description={req?.message}
      className="max-w-sm"
      footer={
        <>
          <Button variant="text" onClick={() => done(false)}>取消</Button>
          <Button variant={req?.danger ? 'danger' : 'filled'} onClick={() => done(true)}>{req?.confirmText || '确定'}</Button>
        </>
      }
    />
  );
}
