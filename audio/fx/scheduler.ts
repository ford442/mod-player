/** Run main-thread work at an audio-clock time (#453): deferred disconnects, rewires. */
export interface FxScheduler {
  /** Call `fn` once `ctx.currentTime ≥ time` (best effort; never before). */
  at(time: number, fn: () => void): void;
}

/** setTimeout-driven, re-checking the audio clock (it can run slow or suspend). */
export function createContextScheduler(ctx: BaseAudioContext): FxScheduler {
  return {
    at(time, fn) {
      const tick = () => {
        if ((ctx as AudioContext).state === 'closed') return;
        const wait = time - ctx.currentTime;
        if (wait <= 0) fn();
        else setTimeout(tick, Math.max(5, wait * 1000));
      };
      tick();
    },
  };
}
