import { PlayerEngine } from './PlayerEngine';

let instance: PlayerEngine | null = null;

/**
 * The page's player engine, created on first use. One per page, like the AudioContext it drives
 * (pitfall 12). React reaches it through `usePlayerEngineInstance()` (hooks/usePlayerEngine.ts), which a
 * test can point at another engine with `PlayerEngineProvider`; the command bus gets it at startup.
 */
export function getPlayerEngine(): PlayerEngine {
  if (!instance) {
    instance = new PlayerEngine({ strictTransport: import.meta.env.DEV });
    if (import.meta.env.DEV && typeof window !== 'undefined') window.__PLAYER_ENGINE__ = instance;
  }
  return instance;
}
