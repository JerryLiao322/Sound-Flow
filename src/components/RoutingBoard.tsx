import { useRef, type Dispatch } from 'react';
import { useConnectDrag } from '../hooks/useConnectDrag';
import { usePortLayout } from '../hooks/usePortLayout';
import type { Action, SoundFlowState } from '../state/reducer';
import { DeviceGroup } from './DeviceGroup';
import { Inspector } from './Inspector';
import { ResetButton } from './ResetButton';
import { SourceList } from './SourceList';
import { PendingWireLayer, Wires } from './Wires';

interface Props {
  state: SoundFlowState;
  dispatch: Dispatch<Action>;
}

/** 输出路由面板：左边应用、中间设备、右边控制单元，应用和设备之间用连线表示路由 */
export function RoutingBoard({ state, dispatch }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const { ports, registerPort, track } = usePortLayout(bodyRef);
  const { pending, portHandlers } = useConnectDrag(
    bodyRef,
    (id) => dispatch({ type: 'select', id }),
    (sourceId, deviceId) => dispatch({ type: 'route', sourceId, deviceId }),
  );

  const selected = state.sources.find((s) => s.id === state.selectedId) ?? state.sources[0];
  if (!selected) {
    return <section className="board board--empty">还没有检测到任何正在使用音频的应用。</section>;
  }
  const selectedDevice = state.devices.find((d) => d.id === selected.deviceId);

  return (
    <section className="board" aria-labelledby="board-title">
      <header className="board-head">
        <div>
          <div className="eyebrow">Routing · 输出路由</div>
          <h1 id="board-title" className="board-title">
            把声音连到想要的设备
          </h1>
          <p className="board-sub">
            <span className="hint-wide">拖动应用右侧的端口连到设备上，或者选中应用后直接点设备</span>
            <span className="hint-narrow">选中一个应用，再点设备，就能把它的声音切过去</span>
          </p>
        </div>
        <ResetButton onConfirm={() => dispatch({ type: 'resetRoutes' })} />
      </header>

      <div className="board-body" ref={bodyRef}>
        <Wires sources={state.sources} selectedId={selected.id} ports={ports} pending={pending} />

        <div className="col col--sources">
          <SourceList
            sources={state.sources}
            devices={state.devices}
            selectedId={selected.id}
            connectingId={pending?.sourceId ?? null}
            onSelect={(id) => dispatch({ type: 'select', id })}
            onToggle={(id) => dispatch({ type: 'toggle', id })}
            onReorder={(from, to) => dispatch({ type: 'reorder', from, to })}
            onReorderActive={track}
            registerPort={registerPort}
            portHandlers={portHandlers}
          />
          <p className="board-hint">按住 ☰ 可以拖动排序；拖线时按 Esc 取消</p>
        </div>

        <div className="col col--gap" aria-hidden />

        <div className="col col--devices">
          <DeviceGroup
            devices={state.devices}
            sources={state.sources}
            selected={selected}
            dropTargetId={pending?.overDeviceId ?? null}
            onPick={(deviceId) => dispatch({ type: 'route', sourceId: selected.id, deviceId })}
            registerPort={registerPort}
          />
        </div>

        <div className="col col--inspector">
          <Inspector source={selected} device={selectedDevice} dispatch={dispatch} />
        </div>

        {pending && <PendingWireLayer pending={pending} ports={ports} />}
      </div>
    </section>
  );
}
