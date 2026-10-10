/**
 * Asymmetric tanh tape saturation (#453), run at 2·fs.
 *
 *   f(x) = (tanh(k·(x + b)) − tanh(k·b)) / norm
 *
 * f(0) = 0; the bias b tilts the curve (even harmonics, hence the DC blocker).
 * `norm` scales the larger of |f(±1)| to 1, so full-scale input stays within
 * ±1 at any drive. Drive 0 (k = 0.25) is close to linear (+0.12 dB small-signal
 * gain at the default bias); drive 1 (k ≈ 4) saturates hard.
 *
 * The per-sample evaluation runs inline in characterChannel.ts; `saturate` is
 * the reference used by tests.
 */

export const K_AT_ZERO_DRIVE = 0.25;
export const DRIVE_RANGE_DB = 24;

/** Map the 0…1 `drive` param to the tanh slope k. */
export function driveToK(drive: number): number {
  return K_AT_ZERO_DRIVE * Math.pow(10, (DRIVE_RANGE_DB * drive) / 20);
}

export class SaturatorCurve {
  k = 1;
  b = 0;
  /** tanh(k·b) */
  offset = 0;
  /** 1 / norm */
  invNorm = 1;

  constructor(k: number, b: number) {
    this.update(k, b);
  }

  /** Recompute the curve constants (on k / b change, not per sample). */
  update(k: number, b: number): void {
    const offset = Math.tanh(k * b);
    const pos = Math.tanh(k * (1 + b)) - offset;
    const neg = offset - Math.tanh(k * (b - 1));
    const norm = pos > neg ? pos : neg;
    this.k = k;
    this.b = b;
    this.offset = offset;
    this.invNorm = norm > 0 ? 1 / norm : 1;
  }
}

export function saturate(curve: SaturatorCurve, x: number): number {
  return (Math.tanh(curve.k * (x + curve.b)) - curve.offset) * curve.invNorm;
}

/** One-pole DC blocker state: y = x − x₁ + R·y₁. */
export class DcBlocker {
  r = 0.999;
  x1 = 0;
  y1 = 0;

  setCutoff(hz: number, sampleRate: number): void {
    this.r = Math.exp((-2 * Math.PI * hz) / sampleRate);
  }

  flushDenormals(): void {
    if (Math.abs(this.y1) < 1e-25) this.y1 = 0;
    if (Math.abs(this.x1) < 1e-25) this.x1 = 0;
  }

  reset(): void {
    this.x1 = 0;
    this.y1 = 0;
  }
}
