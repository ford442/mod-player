/**
 * React binding for the PlayerEngine (#492): components select the snapshot fields they need and
 * re-render only when those change, instead of every consumer re-rendering on every row through one
 * big context value.
 *
 *   const isPlaying = usePlayerEngine((s) => s.isPlaying);
 *   const { title, bpm } = usePlayerEngine((s) => s.moduleInfo);
 *   const meta = usePlayerEngine((s) => ({ a: s.moduleFormat, b: s.moduleFileName }), shallowEqual);
 *
 * High-rate data (playhead, VU) is not in the snapshot; read the engine's refs in render loops
 * (`usePlayerEngineInstance().playbackStateRef`).
 */
import { createContext, createElement, useContext, useRef, useSyncExternalStore, type ReactNode } from 'react';
import type { PlayerEngine, PlayerSnapshot } from '../audio/engine/PlayerEngine';
import { getPlayerEngine } from '../audio/engine/playerEngineInstance';

const PlayerEngineContext = createContext<PlayerEngine | null>(null);

/** Point a subtree at a specific engine (tests, a second player); defaults to the page's engine. */
export function PlayerEngineProvider({ engine, children }: { engine: PlayerEngine; children?: ReactNode }) {
  return createElement(PlayerEngineContext.Provider, { value: engine }, children);
}

export function usePlayerEngineInstance(): PlayerEngine {
  return useContext(PlayerEngineContext) ?? getPlayerEngine();
}

/** Shallow equality for selectors that return a fresh object or array of fields. */
export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false;
  }
  return true;
}

/**
 * Subscribe to a slice of the engine snapshot. `isEqual` decides whether a newly selected value is
 * "the same" (default `Object.is`; pass `shallowEqual` for object/array selections) — when it is, the
 * previous value is returned, so `useSyncExternalStore` sees a stable result and skips the render.
 */
export function usePlayerEngine<T>(
  selector: (snapshot: PlayerSnapshot) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const engine = usePlayerEngineInstance();
  const memo = useRef<{ value: T } | null>(null);
  const getSelection = (): T => {
    const next = selector(engine.getSnapshot());
    const previous = memo.current;
    if (previous && isEqual(previous.value, next)) return previous.value;
    memo.current = { value: next };
    return next;
  };
  return useSyncExternalStore(engine.subscribe, getSelection, getSelection);
}
