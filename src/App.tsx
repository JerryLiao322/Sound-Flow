import { useState } from 'react';
import { RoutingBoard } from './components/RoutingBoard';
import { LogoMark } from './components/Icons';
import { EngineContext } from './engine/EngineContext';
import { MockAudioEngine } from './engine/MockAudioEngine';
import { useSoundFlow } from './state/useSoundFlow';

export function App() {
  const [engine] = useState(() => new MockAudioEngine());
  const [state, dispatch] = useSoundFlow(engine);

  const live = state.sources.filter((s) => s.enabled);
  const devicesInUse = new Set(live.map((s) => s.deviceId)).size;

  return (
    <EngineContext.Provider value={engine}>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <LogoMark />
            <div>
              <div className="brand-name">Sound Flow</div>
              <div className="brand-sub">声音流管理</div>
            </div>
          </div>
          <div className="topbar-stats">
            <span className="stat">
              <b>{live.length}</b> 路声音流
            </span>
            <span className="stat">
              <b>{devicesInUse}</b> 个设备在用
            </span>
            <span className="engine-chip" title="当前没有接入真实的系统音频，所有改动只在界面里生效">
              <i aria-hidden />
              {engine.label}
            </span>
          </div>
        </header>

        <main>
          <RoutingBoard state={state} dispatch={dispatch} />
        </main>
      </div>
    </EngineContext.Provider>
  );
}
