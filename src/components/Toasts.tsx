import { useEffect, useState } from 'react';
import { useEngine } from '../engine/EngineContext';

const SHOW_MS = 4500;

interface Toast {
  id: number;
  message: string;
}

/** 引擎报错时在底部弹出提示，几秒后自动消失；相同的提示不叠加 */
export function Toasts() {
  const engine = useEngine();
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    let nextId = 0;
    return engine.onError((message) => {
      const id = ++nextId;
      setToasts((list) => [...list.filter((t) => t.message !== message), { id, message }].slice(-3));
      setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), SHOW_MS);
    });
  }, [engine]);

  if (toasts.length === 0) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          {t.message}
        </div>
      ))}
    </div>
  );
}
