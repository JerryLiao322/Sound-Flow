import { createContext, useContext } from 'react';
import type { AudioEngine } from './AudioEngine';

export const EngineContext = createContext<AudioEngine | null>(null);

export function useEngine(): AudioEngine {
  const engine = useContext(EngineContext);
  if (!engine) throw new Error('useEngine 必须在 <EngineContext.Provider> 里使用');
  return engine;
}
