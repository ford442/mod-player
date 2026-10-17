import { useEffect } from 'react';
import type { PlayerEngine } from '../audio/engine/PlayerEngine';
import { usePlayerUiStore } from '../store/playerUiStore';
import { usePlayerEngineInstance } from './usePlayerEngine';

/**
 * Mounts the PlayerEngine (#492; see audio/engine/PlayerEngine.ts) in the React tree: init on mount,
 * dispose on unmount, and the UI's lite mode forwarded to the worklet. This hook used to *be* the
 * player — ~63 refs and 20+ pieces of state — and returned all of it; components now select what they
 * need with `usePlayerEngine(selector)` and call the engine (or `usePlayerActions()`) directly.
 */
export function useLibOpenMPT(): PlayerEngine {
  const engine = usePlayerEngineInstance();
  const liteMode = usePlayerUiStore((s) => s.liteMode);

  useEffect(() => {
    void engine.init();
    return () => engine.dispose();
  }, [engine]);

  useEffect(() => {
    engine.setLiteMode(liteMode);
  }, [engine, liteMode]);

  return engine;
}
