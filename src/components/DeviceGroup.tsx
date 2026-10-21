import { cx } from '../lib/cx';
import type { AudioSource, OutputDevice } from '../model/types';

interface Props {
  devices: OutputDevice[];
  sources: AudioSource[];
  selected: AudioSource;
  defaultDeviceId: string;
  /** 拖线时指针正悬停的设备 */
  dropTargetId: string | null;
  onPick: (deviceId: string) => void;
  /** 设为系统默认输出设备 */
  onSetDefault: (deviceId: string) => void;
  registerPort: (key: string) => (el: HTMLElement | null) => void;
}

/**
 * 中列：本机的输出设备，对应参考图右侧的分组卡片。
 * 每一行左边缘有一个输入端口；点一下某行 = 把当前选中的应用接到这台设备。
 */
export function DeviceGroup(props: Props) {
  const { devices, sources, selected, defaultDeviceId, dropTargetId, onPick, onSetDefault, registerPort } = props;
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
            {selected.routable
              ? `${devices.length} 个设备 · ${flows} 路声音流正在输出`
              : `${selected.name}跟随系统默认设备，不能单独切换`}
          </p>
        </div>
      </header>

      <ul className="device-list">
        {devices.map((d) => {
          const isTarget = selected.enabled && selected.deviceId === d.id;
          const isDefault = d.id === defaultDeviceId;
          const count = linked.get(d.id) ?? 0;
          return (
            <li key={d.id} className={cx('device-item', !isDefault && 'can-set-default')}>
              <button
                type="button"
                className={cx(
                  'device-row',
                  isTarget && 'is-target',
                  dropTargetId === d.id && 'is-drop',
                  !selected.routable && 'is-locked',
                )}
                data-device-id={d.id}
                aria-pressed={isTarget}
                aria-disabled={!selected.routable}
                aria-label={`把 ${selected.name} 输出到 ${d.name}`}
                title={isDefault ? '系统默认输出设备：连到这里就是跟随系统默认' : undefined}
                onClick={() => selected.routable && onPick(d.id)}
              >
                <span
                  className={cx('port port--in', count > 0 && 'is-linked', isTarget && 'is-hot')}
                  ref={registerPort(`dev:${d.id}`)}
                  aria-hidden
                />
                <span className="tile tile--sm">{d.code}</span>
                <span className="device-text">
                  <span className="device-name-row">
                    <span className="device-name">{d.name}</span>
                    {isDefault && <span className="default-tag">默认</span>}
                  </span>
                  <span className="device-detail">{d.detail}</span>
                </span>
                {count > 0 && (
                  <span className="device-count" title={`${count} 路声音流`}>
                    {count}
                  </span>
                )}
              </button>
              {!isDefault && (
                <button
                  type="button"
                  className="set-default"
                  title={`把 ${d.name} 设为 Windows 的默认输出设备；跟随默认的应用会一起切过去`}
                  onClick={() => onSetDefault(d.id)}
                >
                  设为默认
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
