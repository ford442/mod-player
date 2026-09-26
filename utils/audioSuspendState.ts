/**
 * "The shared AudioContext left `running` while we expected it to be playing"
 * state (#runtime-hardening / CLAUDE.md pitfall #12).
 *
 * iOS/Safari `interrupted` (phone call, Siri, another app grabbing the audio
 * session) and arbitrary OS suspends land the context in `suspended` or
 * `interrupted` with nothing watching for it — `resume()` used to only run
 * inside `play()`, so the UI kept showing "Playing" over silence until the
 * user happened to click play again. `utils/audioContextFactory.ts` reports
 * transitions here; `hooks/useAudioGraph.ts` (which has the refs/callbacks
 * this framework-free module intentionally doesn't) subscribes to drive the
 * UI and the gesture-triggered resume + playhead re-anchor.
 */

export interface AudioSuspendState {
  suspended: boolean;
  /** `ctx.state` at the time `suspended` was last set true (diagnostic only). */
  contextState: AudioContextState | null;
}

type Listener = (state: AudioSuspendState) => void;

const INITIAL_STATE: AudioSuspendState = { suspended: false, contextState: null };

let state: AudioSuspendState = INITIAL_STATE;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) listener(state);
}

/** Current suspend state (immutable snapshot). */
export function getAudioSuspendState(): AudioSuspendState {
  return state;
}

/** Subscribe to suspend-state changes. Returns an unsubscribe function. */
export function subscribeAudioSuspend(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Report the context leaving/rejoining `running` while playback was expected. */
export function setAudioSuspended(suspended: boolean, contextState: AudioContextState | null = null): void {
  if (state.suspended === suspended) return;
  state = { suspended, contextState: suspended ? contextState : null };
  notify();
}

/** Test-only: reset the module-level singleton so each case starts clean. */
export function __resetAudioSuspendStateForTests(): void {
  state = INITIAL_STATE;
  listeners.clear();
}
