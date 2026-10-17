import { PlayerEngine } from './PlayerEngine';

let instance: PlayerEngine | null = null;

/**
 * The page's player engine, created on first use. One per page, like the AudioContext it drives
 * (pitfall 12). React reaches it through `usePlayerEngineInstance()` (hooks/usePlayerEngine.ts), which a
 * test can point at another engine with `PlayerEngineProvider`; the command bus gets it at startup.
 */
export function getPlayerEngine(): PlayerEngine {
  instance ??= new PlayerEngine({ strictTransport: import.meta.env.DEV });
  return instance;
}
