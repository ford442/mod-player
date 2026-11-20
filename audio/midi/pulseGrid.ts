/**
 * The MIDI Clock pulse grid (#538): the audio-clock times of the 24-per-beat pulses.
 *
 * Pure bookkeeping, no I/O. The caller (`MidiOutController`) anchors the grid at a known instant — the
 * first rendered row of a play, the resume point after a pause — and each scheduler tick asks for every
 * pulse up to a lookahead horizon. The interval comes from libopenmpt's estimated BPM at that tick, so a
 * tempo or speed change (Fxx / Txx / Axx) takes effect from the next pulse that has not been handed out:
 * pulses already scheduled cannot be recalled (`MIDIOutput.clear()` is not implemented in Chromium), so
 * a change is followed within one lookahead window. It is never deferred to a row boundary.
 */
import { CLOCKS_PER_BEAT } from './midiMessages';

/** The BPM range the grid accepts; anything else (NaN, 0, a runaway value) keeps the previous interval. */
export const MIN_CLOCK_BPM = 10;
export const MAX_CLOCK_BPM = 1000;

/** Seconds between two pulses at `bpm`. */
export function pulseIntervalSec(bpm: number): number {
  return 60 / (bpm * CLOCKS_PER_BEAT);
}

export interface AdvanceResult {
  /** Pulses handed to `emit`. */
  emitted: number;
  /** Pulses dropped because they were already too late (a stalled main thread); the phase is kept. */
  skipped: number;
}

export class PulseGrid {
  private next: number | null = null;
  private last: number | null = null;
  private interval = pulseIntervalSec(125);

  /** Audio time of the next pulse to hand out, or null when the grid is not running. */
  get nextPulseSec(): number | null {
    return this.next;
  }

  /** Audio time of the latest pulse handed out since the last `stop()`, or null. */
  get lastPulseSec(): number | null {
    return this.last;
  }

  get intervalSec(): number {
    return this.interval;
  }

  get running(): boolean {
    return this.next !== null;
  }

  /** Stop handing out pulses. The last-emitted time is kept: a later `anchor` must not overlap it. */
  stop(): void {
    this.next = null;
  }

  /** Forget the previous run entirely (a new module, a fault). */
  reset(): void {
    this.next = null;
    this.last = null;
  }

  /**
   * Start (or move) the grid so its next pulse falls at `audioSec`. Pulses already handed out beyond
   * that time are still on their way to the receiver, so the new phase waits for them: when
   * `audioSec` falls inside the span they cover, the next pulse moves to the first slot that keeps at
   * least half an interval after the last one. The receiver sees one stretched interval at most,
   * never two pulses on top of each other. Returns the time of the next pulse.
   */
  anchor(audioSec: number): number {
    let at = audioSec;
    const last = this.last;
    if (last !== null) {
      const earliest = last + this.interval * 0.5;
      if (at < earliest) at += Math.ceil((earliest - at) / this.interval) * this.interval;
    }
    this.next = at;
    return at;
  }

  /** Update the interval from a BPM reading; an unusable reading leaves it as it was. */
  setBpm(bpm: number): void {
    if (Number.isFinite(bpm) && bpm >= MIN_CLOCK_BPM && bpm <= MAX_CLOCK_BPM) {
      this.interval = pulseIntervalSec(bpm);
    }
  }

  /**
   * Seconds from `atSec` to the first pulse at or after it, on the current grid — what a pause needs to
   * keep so the resume continues the beat where it left off. Null when the grid is not running.
   */
  untilNextPulse(atSec: number): number | null {
    if (this.next === null) return null;
    const gap = this.next - atSec;
    if (gap >= 0) {
      // Step back over pulses that were already handed out beyond `atSec`.
      const whole = Math.floor(gap / this.interval);
      return gap - whole * this.interval;
    }
    const behind = Math.ceil(-gap / this.interval);
    return gap + behind * this.interval;
  }

  /**
   * Hand every pulse with time ≤ `horizonSec` to `emit`, oldest first. Pulses earlier than `floorSec`
   * are dropped (whole intervals, so the phase survives); `emit` gets the audio time of each.
   */
  advance(horizonSec: number, floorSec: number, emit: (audioSec: number) => void): AdvanceResult {
    const result: AdvanceResult = { emitted: 0, skipped: 0 };
    let next = this.next;
    if (next === null) return result;
    if (next < floorSec) {
      const behind = Math.ceil((floorSec - next) / this.interval);
      next += behind * this.interval;
      result.skipped = behind;
    }
    while (next <= horizonSec) {
      emit(next);
      this.last = next;
      next += this.interval;
      result.emitted += 1;
    }
    this.next = next;
    return result;
  }
}
