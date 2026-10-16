/**
 * AudioParam scheduling for the FX rack (#453).
 *
 * Fades are append-only: a fade never cancels automation that is already in
 * flight (that is a discontinuity per spec, and Firefox has no
 * cancelAndHoldAtTime). A fade requested while another is running starts when
 * that one ends, from exactly its end value — reversing mid-fade costs at most
 * one extra fade length, and the curve stays continuous in every engine.
 */

/** Slot / attach crossfade length. */
export const FX_CROSSFADE_S = 0.01;
/** Schedule live changes this far ahead of `currentTime`, so they land in the future. */
export const FX_LOOKAHEAD_S = 0.005;
/** Time constant for continuous parameter changes (setTargetAtTime). */
export const FX_PARAM_TAU_S = 0.015;

export interface FadeWindow {
  start: number;
  end: number;
}

/** Owns one gain-like AudioParam's fade timeline. */
export class FadeScheduler {
  private endTime = 0;
  private endValue: number;

  constructor(
    private readonly param: AudioParam,
    initial: number,
    private readonly fadeSeconds = FX_CROSSFADE_S,
  ) {
    this.endValue = initial;
    param.value = initial;
  }

  /** The value the param holds (or will hold) once queued fades finish. */
  get target(): number {
    return this.endValue;
  }

  /** When the last queued fade ends (0 if none was scheduled). */
  get settlesAt(): number {
    return this.endTime;
  }

  /**
   * Linear fade to `target`, starting no earlier than `earliest` and never
   * before the previous fade ends. A no-op if the param is already headed there.
   */
  fadeTo(target: number, earliest: number): FadeWindow {
    if (target === this.endValue) return { start: this.endTime, end: this.endTime };
    const start = Math.max(earliest, this.endTime);
    const end = start + this.fadeSeconds;
    this.param.setValueAtTime(this.endValue, start);
    if (this.fadeSeconds > 0) this.param.linearRampToValueAtTime(target, end);
    else this.param.setValueAtTime(target, start);
    this.endTime = end;
    this.endValue = target;
    return { start, end };
  }

  /** Jump immediately, dropping any queued fades (static builds, initial state). */
  setStatic(value: number): void {
    this.param.cancelScheduledValues(0);
    this.param.value = value;
    this.endTime = 0;
    this.endValue = value;
  }
}

/** Glide a continuous param toward `value` (live), or set it outright (static). */
export function setParam(param: AudioParam, value: number, at: number, immediate: boolean): void {
  if (immediate) {
    param.cancelScheduledValues(0);
    param.value = value;
    return;
  }
  // setTargetAtTime events start at or before `at`, so cancelling from `at`
  // never removes the curve currently being followed.
  param.cancelScheduledValues(at);
  param.setTargetAtTime(value, at, FX_PARAM_TAU_S);
}

/** Step a param at `at` (live) or now (static) — for values the processor smooths itself. */
export function stepParam(param: AudioParam, value: number, at: number, immediate: boolean): void {
  if (immediate) {
    param.cancelScheduledValues(0);
    param.value = value;
    return;
  }
  param.setValueAtTime(value, at);
}
