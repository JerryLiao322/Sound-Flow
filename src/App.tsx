import { useEffect, useState } from 'react';
import { RoutingBoard } from './components/RoutingBoard';
import { LogoMark } from './components/Icons';
import { Toasts } from './components/Toasts';
import type { AudioEngine, EngineSnapshot } from './engine/AudioEngine';
import { EngineContext } from './engine/EngineContext';
import { MockAudioEngine } from './engine/MockAudioEngine';
import { TauriAudioEngine, isTauri } from './engine/TauriAudioEngine';
import { useSoundFlow } from './state/useSoundFlow';

type Boot = { status: 'loading' } | { status: 'ready'; snapshot: EngineSnapshot } | { status: 'error'; message: string };

function createEngine(): AudioEngine {
  return isTauri() ? new TauriAudioEngine() : new MockAudioEngine();
}

export function App() {
  const [engine, setEngine] = useState<AudioEngine>(createEngine);
  const [attempt, setAttempt] = useState(0);
  const [boot, setBoot] = useState<Boot>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setBoot({ status: 'loading' });
    engine.load().then(
      (snapshot) => !cancelled && setBoot({ status: 'ready', snapshot }),
      (e: unknown) => !cancelled && setBoot({ status: 'error', message: typeof e === 'string' ? e : String(e) }),
    );
    return () => {
      cancelled = true;
    };
  }, [engine, attempt]);

  return (
    <EngineContext.Provider value={engine}>
      <div className="app">
        {boot.status === 'ready' ? (
          <Workspace key={engine.label} engine={engine} snapshot={boot.snapshot} />
        ) : (
          <>
            <TopBar engine={engine} />
            <section className="board board--empty" aria-live="polite">
              {boot.status === 'loading' ? (
                <p>正在读取系统里的应用和输出设备…</p>
              ) : (
                <div className="boot-error">
                  <h1 className="board-title">没能连接到系统音频</h1>
                  <p className="board-sub">{boot.message}</p>
                  <div className="boot-actions">
                    <button type="button" className="chip is-on" onClick={() => setAttempt((n) => n + 1)}>
                      重试
                    </button>
                    {engine.native && (
                      <button type="button" className="chip" onClick={() => setEngine(new MockAudioEngine())}>
                        用演示数据看看界面
                      </button>
                    )}
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </EngineContext.Provider>
  );
}

function Workspace({ engine, snapshot }: { engine: AudioEngine; snapshot: EngineSnapshot }) {
  const [state, dispatch] = useSoundFlow(engine, snapshot);
  const live = state.sources.filter((s) => s.enabled);
  const devicesInUse = new Set(live.map((s) => s.deviceId)).size;

  return (
    <>
      <TopBar engine={engine} flows={live.length} devices={devicesInUse} />
      <main>
        <RoutingBoard state={state} dispatch={dispatch} />
      </main>
      <Toasts />
    </>
  );
}

function TopBar({ engine, flows, devices }: { engine: AudioEngine; flows?: number; devices?: number }) {
  return (
    <header className="topbar">
      <div className="brand">
        <LogoMark />
        <div>
          <div className="brand-name">Sound Flow</div>
          <div className="brand-sub">声音流管理</div>
        </div>
      </div>
      <div className="topbar-stats">
        {flows !== undefined && (
          <span className="stat">
            <b>{flows}</b> 路声音流
          </span>
        )}
        {devices !== undefined && (
          <span className="stat">
            <b>{devices}</b> 个设备在用
          </span>
        )}
        <span
          className={engine.native ? 'engine-chip is-native' : 'engine-chip'}
          title={engine.native ? '正在控制这台电脑的真实音频' : '没有接入系统音频，所有改动只在界面里生效'}
        >
          <i aria-hidden />
          {engine.label}
        </span>
      </div>
    </header>
  );
}
