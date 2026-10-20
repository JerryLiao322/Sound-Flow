import { cx } from '../lib/cx';
import type { AudioSource, OutputDevice } from '../model/types';

interface Props {
  devices: OutputDevice[];
  sources: AudioSource[];
  selected: AudioSource;
  /** 拖线时指针正悬停的设备 */
  dropTargetId: string | null;
  onPick: (deviceId: string) => void;
  registerPort: (key: string) => (el: HTMLElement | null) => void;
}

/**
 * 中列：本机的输出设备，对应参考图右侧的分组卡片。
 * 每一行左边缘有一个输入端口；点一下某行 = 把当前选中的应用接到这台设备。
 */
export function DeviceGroup({ devices, sources, selected, dropTargetId, onPick, registerPort }: Props) {
  const linked = new Map<string, number>();
  for (const s of sources) {
    if (s.enabled) linked.set(s.deviceId, (linked.get(s.deviceId) ?? 0) + 1);
  }
  const flows = sources.filter((s) => s.enabled).length;

  return (
    <section className="device-group" aria-labelledby="device-group-title">
      <header className="group-head">
        <span className="tile">PC</span>
        <div className="group-titles">
          <h2 id="device-group-title" className="group-title">
            本机输出
          </h2>
          <p className="group-sub">
            {devices.length} 个设备 · {flows} 路声音流正在输出
          </p>
        </div>
      </header>

      <ul className="device-list">
        {devices.map((d) => {
          const isTarget = selected.enabled && selected.deviceId === d.id;
          const count = linked.get(d.id) ?? 0;
          return (
            <li key={d.id}>
              <button
                type="button"
                className={cx('device-row', isTarget && 'is-target', dropTargetId === d.id && 'is-drop')}
                data-device-id={d.id}
                aria-pressed={isTarget}
                aria-label={`把 ${selected.name} 输出到 ${d.name}`}
                onClick={() => onPick(d.id)}
              >
                <span
                  className={cx('port port--in', count > 0 && 'is-linked', isTarget && 'is-hot')}
                  ref={registerPort(`dev:${d.id}`)}
                  aria-hidden
                />
                <span className="tile tile--sm">{d.code}</span>
                <span className="device-text">
                  <span className="device-name">{d.name}</span>
                  <span className="device-detail">{d.detail}</span>
                </span>
                {count > 0 && (
                  <span className="device-count" title={`${count} 路声音流`}>
                    {count}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
