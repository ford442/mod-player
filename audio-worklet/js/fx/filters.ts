/**
 * Amiga output filters for the character stage (#453): coefficients + state.
 * Both are bilinear with pre-warping, so the −3 dB corner lands exactly on the
 * requested frequency. The per-sample recursion runs inline in
 * characterChannel.ts (see smoothing.ts for why); fields are public for that.
 */

/** 2-pole low-pass, transposed direct form II (RBJ cookbook = prewarped bilinear). */
export class BiquadLowpass {
  b0 = 1;
  b1 = 0;
  b2 = 0;
  a1 = 0;
  a2 = 0;
  z1 = 0;
  z2 = 0;

  /** Q = 1/√2 gives a Butterworth response. */
  setLowpass(cutoffHz: number, q: number, sampleRate: number): void {
    const w0 = (2 * Math.PI * Math.min(cutoffHz, sampleRate * 0.49)) / sampleRate;
    const cos = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * q);
    const a0 = 1 + alpha;
    this.b0 = (1 - cos) / 2 / a0;
    this.b1 = (1 - cos) / a0;
    this.b2 = this.b0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  /** |H(e^{jω})| at `hz`. */
  magnitudeAt(hz: number, sampleRate: number): number {
    const w = (2 * Math.PI * hz) / sampleRate;
    const nr = this.b0 + this.b1 * Math.cos(w) + this.b2 * Math.cos(2 * w);
    const ni = -(this.b1 * Math.sin(w) + this.b2 * Math.sin(2 * w));
    const dr = 1 + this.a1 * Math.cos(w) + this.a2 * Math.cos(2 * w);
    const di = -(this.a1 * Math.sin(w) + this.a2 * Math.sin(2 * w));
    return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
  }

  flushDenormals(): void {
    if (Math.abs(this.z1) < 1e-25) this.z1 = 0;
    if (Math.abs(this.z2) < 1e-25) this.z2 = 0;
  }

  reset(): void {
    this.z1 = 0;
    this.z2 = 0;
  }
}

/** 1-pole low-pass (an RC network): y = b·(x + x₁) − a₁·y₁. */
export class OnePoleLowpass {
  b = 1;
  a1 = 0;
  x1 = 0;
  y1 = 0;

  setLowpass(cutoffHz: number, sampleRate: number): void {
    const k = Math.tan((Math.PI * Math.min(cutoffHz, sampleRate * 0.49)) / sampleRate);
    this.b = k / (1 + k);
    this.a1 = (k - 1) / (k + 1);
  }

  magnitudeAt(hz: number, sampleRate: number): number {
    const w = (2 * Math.PI * hz) / sampleRate;
    const nr = this.b * (1 + Math.cos(w));
    const ni = -this.b * Math.sin(w);
    const dr = 1 + this.a1 * Math.cos(w);
    const di = -this.a1 * Math.sin(w);
    return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
  }

  flushDenormals(): void {
    if (Math.abs(this.x1) < 1e-25) this.x1 = 0;
    if (Math.abs(this.y1) < 1e-25) this.y1 = 0;
  }

  reset(): void {
    this.x1 = 0;
    this.y1 = 0;
  }
}
