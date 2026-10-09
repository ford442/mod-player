/**
 * Audio-clock bookkeeping for pause / resume.
 *
 * The visual playhead is not read from the engine every frame: it is *extrapolated* from the last
 * worklet position sample on the audio clock (`predictPlayheadFromSample`, see playheadPrediction.ts).
 * The audio clock keeps running when the transport pauses, and a paused worklet posts no new
 * samples, so left alone:
 *
 *  - while paused the extrapolation keeps advancing (up to MAX_EXTRAPOLATION_SEC) over silent audio;
 *  - on resume the last sample is stale by the whole pause, so the playhead would jump forward by
 *    the pause length, then snap back when the first fresh sample arrives.
 *
 * Both are fixed by clamping the "heard" time used for prediction (`effectiveHeardTime`) and by
 * rebasing the stale sample to the paused position at the resume instant (`rebaseSampleForResume`).
 *
 * Times are AudioContext.currentTime values (the same domain as `WorkletPositionSample.workletTime`).
 */

import {
  predictPlayheadFromSample,
  type WorkletPositionSample,
} from './playheadPrediction';

/** `isPlaying` and `isPaused` are mutually exclusive; neither set means stopped. */
export type TransportState = 'stopped' | 'playing' | 'paused';

export function deriveTransportState(isPlaying: boolean, isPaused: boolean): TransportState {
  return isPlaying ? 'playing' : isPaused ? 'paused' : 'stopped';
}

/**
 * `navigator.mediaSession.playbackState` for a transport state. Paused must NOT map to 'none': that
 * dismisses the OS media card / lock-screen controls, so the user couldn't resume from them.
 */
export function mediaSessionPlaybackState(state: TransportState): 'none' | 'paused' | 'playing' {
  return state === 'playing' ? 'playing' : state === 'paused' ? 'paused' : 'none';
}

/**
 * Should `play()` resume a paused engine instead of starting one? Yes while paused — the engine kept
 * its cursor, and the full start path would reload the module from order 0 row 0. The one exception is
 * an explicit module load (`forceModuleLoad`), which really must (re)load and then comes up cued.
 */
export function playShouldResume(isPaused: boolean, options?: { forceModuleLoad?: boolean }): boolean {
  return isPaused && !options?.forceModuleLoad;
}

/**
 * Zero the per-channel levels the GPU meters/shaders read. A paused engine posts no more VU data, so
 * without this the last levels stay lit; a position report already in flight when the pause lands would
 * re-light them, so the position handlers call this too while paused.
 */
export function silenceChannelStates(states: ReadonlyArray<{ volume: number; trigger: number }>): void {
  for (const channel of states) {
    channel.volume = 0;
    channel.trigger = 0;
  }
}

export interface PauseClock {
  /** `currentTime` when the pause was issued — the instant the engine stopped rendering. Null unless paused. */
  pausedAt: number | null;
  /** `currentTime` when the latest resume was issued. Null until the first resume of this session. */
  resumedAt: number | null;
}

export function createPauseClock(): PauseClock {
  return { pausedAt: null, resumedAt: null };
}

/**
 * The heard time to feed `predictPlayheadFromSample` / the drift detector.
 *
 * - Paused: capped at `pausedAt`. The ear keeps hearing the already-rendered audio for one output
 *   latency after the pause, so the playhead keeps following it, then holds at where rendering stopped.
 * - Resumed: floored at `resumedAt`. New audio is not heard until one output latency after resume, and
 *   without the floor the (deliberately allowed) negative extrapolation would pull the playhead
 *   *backwards* from the paused position for that window.
 */
export function effectiveHeardTime(heardTime: number, clock: PauseClock): number {
  if (clock.pausedAt != null) return Math.min(heardTime, clock.pausedAt);
  if (clock.resumedAt != null) return Math.max(heardTime, clock.resumedAt);
  return heardTime;
}

/**
 * Re-base the last position sample so that, at `resumeAt`, it predicts exactly the paused position.
 *
 * The paused position is the stale sample extrapolated to `pausedAt`. The rebased sample carries that
 * row / song-position and is stamped `resumeAt`, so with `effectiveHeardTime` flooring heard time at
 * `resumeAt` the very first frame after resume shows the paused position (dt = 0, drift = 0) and the
 * playhead advances from there. The first fresh sample from the engine replaces it.
 */
export function rebaseSampleForResume(
  sample: WorkletPositionSample,
  rowsPerSecond: number,
  pausedAt: number,
  resumeAt: number,
): WorkletPositionSample {
  const atPause = predictPlayheadFromSample(sample, pausedAt, rowsPerSecond);
  return {
    ...sample,
    row: atPause.playheadRow,
    rowInt: Math.floor(atPause.playheadRow),
    positionSeconds: atPause.positionSeconds,
    workletTime: resumeAt,
  };
}
