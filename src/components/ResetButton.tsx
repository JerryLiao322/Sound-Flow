import { useEffect, useState } from 'react';

const CONFIRM_WINDOW_MS = 3000;

/** 参考图里「退出登录」样式的危险操作按钮：点第一下变成确认，3 秒内再点才执行 */
export function ResetButton({ onConfirm }: { onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), CONFIRM_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <button
      type="button"
      className="danger-pill"
      title="所有应用改回默认设备，声音曲线恢复平直"
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
        }
      }}
    >
      {armed ? '再点一次确认' : '重置路由'}
    </button>
  );
}
