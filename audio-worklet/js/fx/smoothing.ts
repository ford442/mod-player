/**
 * Parameter smoothing for the character stage (#453).
 *
 * The fields are public on purpose: the stage loops in characterChannel.ts copy
 * them into locals, advance them inline per sample and write them back once
 * per block. A per-sample method call that passes or returns a double is only
 * free while TurboFan inlines it; when it doesn't, the double is boxed — an
 * allocation on the audio thread. The methods here are for setup and tests.
 *
 * Every numeric field has a numeric initializer. The worklet bundle targets
 * ES2020, so a bare `value: number;` is emitted as a define-to-undefined; V8
 * then stores the field as tagged, and every later double write allocates.
 */

/** One-pole glide toward `target`; snaps once within `epsilon`. */
export class OnePoleSmoother {
  value = 0;
  target = 0;
  readonly coeff: number = 0;
  readonly epsilon: number = 1e-6;

  constructor(initial: number, seconds: number, sampleRate: number, epsilon = 1e-6) {
    this.value = initial;
    this.target = initial;
    this.coeff = Math.exp(-1 / (seconds * sampleRate));
    this.epsilon = epsilon;
  }

  next(): number {
    if (this.value !== this.target) {
      this.value = this.target + (this.value - this.target) * this.coeff;
      if (Math.abs(this.value - this.target) < this.epsilon) this.value = this.target;
    }
    return this.value;
  }

  snap(): void {
    this.value = this.target;
  }
}

/** Linear 0↔1 ramp of fixed duration — a click-free switch between two paths. */
export class LinearSwitch {
  value = 0;
  target = 0;
  readonly step: number = 0;

  constructor(initial: 0 | 1, seconds: number, sampleRate: number) {
    this.value = initial;
    this.target = initial;
    this.step = 1 / Math.max(1, Math.round(seconds * sampleRate));
  }

  set(on: boolean): void {
    this.target = on ? 1 : 0;
  }

  next(): number {
    const v = this.value;
    const t = this.target;
    if (v !== t) this.value = v < t ? (v + this.step > t ? t : v + this.step) : v - this.step < t ? t : v - this.step;
    return this.value;
  }

  snap(): void {
    this.value = this.target;
  }
}
