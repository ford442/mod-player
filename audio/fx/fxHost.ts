/**
 * The live attachment point for the FX rack (#453).
 *
 * hooks/audioGraph/masterGraph.ts publishes the master nodes once they exist
 * for a context, and `null` on teardown. The lazily loaded rack controller
 * subscribes here instead of reaching into React refs, so the main chunk never
 * imports rack code.
 *
 *   engine → masterInput ─┬─▶ masterDirect ─────────────┬─▶ analyser → …
 *                         └─▶ rack.input … rack.output ─┘
 *
 * `masterDirect.gain` belongs to the rack controller: 1 while the rack is
 * collapsed, crossfaded to 0 while the rack carries the signal.
 */

export interface FxHost {
  readonly ctx: BaseAudioContext;
  /** Unity gain; every engine connects here. Never automated. */
  readonly masterInput: GainNode;
  /** Dry path around the rack (1 = rack collapsed). */
  readonly masterDirect: GainNode;
  /** Rack output target; also the start of the shared master chain. */
  readonly analyser: AnalyserNode;
}

type FxHostListener = (host: FxHost | null) => void;

let current: FxHost | null = null;
const listeners = new Set<FxHostListener>();

function sameHost(a: FxHost | null, b: FxHost | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.ctx === b.ctx
    && a.masterInput === b.masterInput
    && a.masterDirect === b.masterDirect
    && a.analyser === b.analyser;
}

/** Publish the current host (deduplicated by node identity; every play re-publishes). */
export function publishFxHost(host: FxHost | null): void {
  if (sameHost(current, host)) return;
  current = host;
  for (const listener of [...listeners]) listener(host);
}

export function getFxHost(): FxHost | null {
  return current;
}

/** Listen for host changes. The listener is not called with the current value. */
export function subscribeFxHost(listener: FxHostListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
