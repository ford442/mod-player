/**
 * Audio time → `performance.now()` time, for `MIDIOutput.send(data, timestamp)` (#538).
 *
 * A MIDI message for the instant `T` on the audio clock (the clock `AudioContext.currentTime` and the
 * worklet's position samples use, read as "what is at the speakers": see utils/playheadPrediction.ts)
 * must be stamped with the matching `performance.now()` value. The browser answers that through
 * `getOutputTimestamp()`, but each reading carries a few ms of jitter (it moves with the render
 * callbacks), and sent straight into `send()` that jitter would become jitter in the clock a DAW
 * follows. The audio and performance clocks only drift against each other by ppm, so the offset
 * between them is nearly constant: this keeps it as a slow exponential average over many readings.
 *
 *   offsetMs = performanceMs − audioSec × 1000      (one reading)
 *
 * Readings are (heard time, `performance.now()` at that read) pairs — `resolveAudioHeardTime` returns
 * the first, the caller samples the second — so the same code serves `getOutputTimestamp()` and the
 * `currentTime − latency` fallback.
 */

export interface AudioPerfClockOptions {
  /** Weight of a new reading once converged (default 0.02: ~1 s time constant at a 20 ms reading rate). */
  alpha?: number;
  /** A reading this far from the average (ms) is an outlier — a stale timestamp, not the clock moving. */
  outlierMs?: number;
  /** This many outliers in a row on the same side are a real step (device switch, resumed context). */
  stepAfter?: number;
}

const DEFAULT_ALPHA = 0.02;
const DEFAULT_OUTLIER_MS = 25;
const DEFAULT_STEP_AFTER = 6;

export class AudioPerfClock {
  private offsetMs: number | null = null;
  private readings = 0;
  private outlierRun = 0;
  private outlierSign = 0;
  private readonly alpha: number;
  private readonly outlierMs: number;
  private readonly stepAfter: number;

  constructor(options: AudioPerfClockOptions = {}) {
    this.alpha = options.alpha ?? DEFAULT_ALPHA;
    this.outlierMs = options.outlierMs ?? DEFAULT_OUTLIER_MS;
    this.stepAfter = options.stepAfter ?? DEFAULT_STEP_AFTER;
  }

  /** True once at least one reading has been taken. */
  get ready(): boolean {
    return this.offsetMs !== null;
  }

  /** Readings absorbed since the last reset (diagnostics, tests). */
  get count(): number {
    return this.readings;
  }

  /** Forget everything: the output moved (new device) or the context was recreated. */
  reset(): void {
    this.offsetMs = null;
    this.readings = 0;
    this.outlierRun = 0;
    this.outlierSign = 0;
  }

  /** One reading: the instant `audioSec` on the audio clock coincided with `performanceMs`. */
  observe(audioSec: number, performanceMs: number): void {
    if (!Number.isFinite(audioSec) || !Number.isFinite(performanceMs)) return;
    const reading = performanceMs - audioSec * 1000;
    if (this.offsetMs === null) {
      this.offsetMs = reading;
      this.readings = 1;
      return;
    }
    const deviation = reading - this.offsetMs;
    if (Math.abs(deviation) > this.outlierMs) {
      const sign = Math.sign(deviation);
      this.outlierRun = sign === this.outlierSign ? this.outlierRun + 1 : 1;
      this.outlierSign = sign;
      if (this.outlierRun >= this.stepAfter) {
        // A sustained step is the new truth, not noise.
        this.offsetMs = reading;
        this.readings = 1;
        this.outlierRun = 0;
        this.outlierSign = 0;
      }
      return;
    }
    this.outlierRun = 0;
    this.outlierSign = 0;
    this.readings += 1;
    // A running mean for the first readings (fast convergence), the fixed-weight average after.
    const weight = Math.max(this.alpha, 1 / this.readings);
    this.offsetMs += deviation * weight;
  }

  /** `performance.now()` value for the instant `audioSec`, or null before the first reading. */
  toPerformanceMs(audioSec: number): number | null {
    if (this.offsetMs === null) return null;
    return audioSec * 1000 + this.offsetMs;
  }
}
