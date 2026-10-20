import { VB_CABLE_URL, openExternal } from '../engine/desktop';
import type { AudioSource, EqStatus } from '../model/types';

interface Props {
  native: boolean;
  status: EqStatus;
  source: AudioSource;
  /** 开机自启是否已开；不知道时为 null */
  autostart: boolean | null;
}

/** 「CABLE Input (VB-Audio Virtual Cable)」→「CABLE Input」 */
function shortName(name: string | null): string {
  return name?.split(' (')[0] || '虚拟声卡';
}

/** 声音曲线下方的状态说明：能不能生效、正在生效、出错了、要先装什么 */
export function EqStatusNote({ native, status, source, autostart }: Props) {
  // 浏览器里用模拟数据开发界面，没什么要说明的
  if (!native) return null;

  if (!source.routable) {
    return <p className="control-note">系统声音不能单独加声音曲线。</p>;
  }

  if (!status.available) {
    return (
      <div className="eq-setup">
        <p>
          要让曲线真正改变声音，需要先装一个免费的虚拟声卡 <strong>VB-CABLE</strong>：Sound Flow
          会把这个应用的原声送进去，按曲线处理好再送到你选的设备。装好后重启电脑，曲线会自动生效。
        </p>
        <button type="button" className="notice-action" onClick={() => openExternal(VB_CABLE_URL)}>
          下载 VB-CABLE
        </button>
      </div>
    );
  }

  if (source.eqError) {
    return <p className="control-note is-error">曲线处理出错：{source.eqError}。稍后会自动重试。</p>;
  }

  const flat = source.eq.every((g) => Math.abs(g) < 0.05);
  if (flat) {
    return (
      <p className="control-note">
        调整曲线后立即生效：这一路会经 {shortName(status.sinkName)} 处理，延迟约增加 30 毫秒。平直时不做处理。
      </p>
    );
  }

  if (!source.eqActive) {
    return <p className="control-note">正在启用曲线…</p>;
  }

  return (
    <p className="control-note is-ok">
      ✓ 曲线已生效（经 {shortName(status.sinkName)} 处理）。
      {autostart === false && '建议打开右上角的「开机启动」：Sound Flow 没在运行时，这个应用会没有声音。'}
    </p>
  );
}
