/**
 * Cross-module "the audio engine crashed" state (#runtime-hardening).
 *
 * A wasm trap inside the JS AudioWorklet's process() (openmpt-processor.ts) or
 * a native `node.onprocessorerror` is caught at the audio-graph boundary
 * (hooks/audioGraph/startJsWorkletPlayback.ts) and recorded here so any UI
 * that wants to show "audio crashed, restarting…" can subscribe without the
 * audio graph code needing to know about React state.
 *
 * Deliberately framework-free (same pattern as utils/pcmBus.ts) — the audio
 * graph and any UI consumer can both depend on it without a cycle.
 */

export type AudioFaultReason = 'processor-error' | 'process-trap' | 'restart-failed';

export interface AudioFaultState {
  faulted: boolean;
  reason: AudioFaultReason | null;
  message: string | null;
  /** Consecutive automatic restarts attempted for the current fault episode. */
  restartAttempts: number;
}

type Listener = (state: AudioFaultState) => void;

const INITIAL_STATE: AudioFaultState = {
  faulted: false,
  reason: null,
  message: null,
  restartAttempts: 0,
};

let state: AudioFaultState = INITIAL_STATE;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) listener(state);
}

/** Current fault state (immutable snapshot). */
export function getAudioFaultState(): AudioFaultState {
  return state;
}

/** Subscribe to fault-state changes. Returns an unsubscribe function. */
export function subscribeAudioFault(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Mark the engine faulted (node crashed, restart in progress or exhausted). */
export function setAudioFaulted(reason: AudioFaultReason, message: string): void {
  state = { ...state, faulted: true, reason, message };
  notify();
}

/** Clear the fault (a restart succeeded and is rendering again). */
export function clearAudioFault(): void {
  if (!state.faulted && state.restartAttempts === 0) return;
  state = INITIAL_STATE;
  notify();
}

/** Record one more automatic restart attempt for the current episode; returns the new count. */
export function noteAudioRestartAttempt(): number {
  state = { ...state, restartAttempts: state.restartAttempts + 1 };
  notify();
  return state.restartAttempts;
}

/** Test-only: reset the module-level singleton so each case starts clean. */
export function __resetAudioFaultStateForTests(): void {
  state = INITIAL_STATE;
  listeners.clear();
}
