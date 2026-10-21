import type { Dispatch } from 'react';
import { useEngine } from '../engine/EngineContext';
import { EQ_PRESETS, presetLabel } from '../model/eq';
import type { AudioSource, EqStatus, OutputDevice } from '../model/types';
import type { Action } from '../state/reducer';
import { cx } from '../lib/cx';
import { hueStyle } from '../lib/theme';
import { EqEditor } from './EqEditor';
import { EqStatusNote } from './EqStatusNote';
import { LevelBar } from './Meters';
import { VolumeSlider } from './VolumeSlider';

interface Props {
  source: AudioSource;
  /** 这一路在列表里的位置，决定它的专属颜色 */
  hue: number;
  device: OutputDevice | undefined;
  eqStatus: EqStatus;
  autostart: boolean | null;
  dispatch: Dispatch<Action>;
}

/** 右列「控制单元」：当前选中这一路的音量、声音曲线，以及它所连设备的主音量 */
export function Inspector({ source, hue, device, eqStatus, autostart, dispatch }: Props) {
  const { native } = useEngine();
  return (
    <section className="inspector" aria-labelledby="inspector-title" style={hueStyle(hue)}>
      <div className="eyebrow">控制单元</div>

      <header className="group-head">
        <span className="tile">{source.code}</span>
        <div className="group-titles">
          <h2 id="inspector-title" className="group-title">
            {source.name}
          </h2>
          <p className="group-sub">
            {source.enabled ? (
              <>
                输出至 <strong>{device?.name ?? '未知设备'}</strong>
                {!source.routable && ' · 跟随系统默认'}
              </>
            ) : (
              '输出已关闭'
            )}
          </p>
        </div>
        <LevelBar sourceId={source.id} />
      </header>

      {!source.enabled && (
        <div className="notice">
          <span>这一路声音流现在听不到。</span>
          <button type="button" className="notice-action" onClick={() => dispatch({ type: 'toggle', id: source.id })}>
            打开输出
          </button>
        </div>
      )}

      <div className="inspector-body">
        <div className="inspector-col">
          <div className="control">
            <VolumeSlider
              label="应用音量"
              value={source.volume}
              onChange={(volume) => dispatch({ type: 'sourceVolume', id: source.id, volume })}
            />
          </div>
          {device && (
            <div className="control">
              <VolumeSlider
                label={
                  <>
                    设备主音量 <span className="control-hint">{device.name}</span>
                  </>
                }
                value={device.volume}
                onChange={(volume) => dispatch({ type: 'deviceVolume', id: device.id, volume })}
              />
            </div>
          )}
        </div>

        <div className="inspector-col">
          <div className="control">
            <div className="control-head">
              <span className="control-label">声音曲线</span>
              <span className="control-value">{presetLabel(source.eqPreset)}</span>
            </div>
            <EqEditor gains={source.eq} onChange={(band, gain) => dispatch({ type: 'eqBand', id: source.id, band, gain })} />
            <EqStatusNote native={native} status={eqStatus} source={source} autostart={autostart} />
            <div className="preset-row" role="group" aria-label="曲线预设">
              {EQ_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={cx('chip', source.eqPreset === p.id && 'is-on')}
                  aria-pressed={source.eqPreset === p.id}
                  onClick={() => dispatch({ type: 'eqPreset', id: source.id, preset: p.id })}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
