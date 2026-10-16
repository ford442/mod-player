/**
 * Click metrics for FX rack crossfades (#453 acceptance: no discontinuity
 * above −60 dBFS when a module toggles). Pure functions over rendered
 * buffers — the vitest Web Audio tests and the Chromium harness both use them.
 *
 * M1 (conformance) — for slot crossfades, which are linear by construction:
 *   r(t) = y_toggled − [(1 − g)·y_dry + g·y_wet]
 *   y_dry: the module never enabled; y_wet: hard-switched on at the fade start
 *   and kept on (same wet-path history as the toggled render); g: the spec'd
 *   fade curve, rendered by the same engine from a DC probe. max|r| ≤ 1e-3
 *   proves the output followed exactly the 10 ms crossfade it should.
 *
 * M2 (discontinuity) — for everything, incl. the room's send ramp where M1's
 *   linearity doesn't hold: the 8 kHz 4th-order Butterworth high-passed peak of
 *   the toggled render around each toggle may exceed that of the static dry and
 *   wet renders by at most 1e-3. A step shows up at about its full height;
 *   the corners of a 10 ms linear fade on a low sine stay far below it.
 */

/** −60 dBFS. */
export const CLICK_LIMIT = 1e-3;

export type Channels = readonly ArrayLike<number>[];

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

function highpassSection(sampleRate: number, fc: number, q: number): Biquad {
  const w0 = (2 * Math.PI * fc) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: (1 + cos) / 2 / a0,
    b1: -(1 + cos) / a0,
    b2: (1 + cos) / 2 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

function runBiquad(x: ArrayLike<number>, f: Biquad): Float64Array {
  const y = new Float64Array(x.length);
  let z1 = 0;
  let z2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i]!;
    const out = f.b0 * v + z1;
    z1 = f.b1 * v - f.a1 * out + z2;
    z2 = f.b2 * v - f.a2 * out;
    y[i] = out;
  }
  return y;
}

/** 4th-order Butterworth high-pass (two RBJ sections, Q = 0.5412 and 1.3066). */
export function highpass4(x: ArrayLike<number>, sampleRate: number, fc = 8000): Float64Array {
  const first = runBiquad(x, highpassSection(sampleRate, fc, 0.5411961));
  return runBiquad(first, highpassSection(sampleRate, fc, 1.3065630));
}

export function maxAbsIn(x: ArrayLike<number>, from = 0, to = x.length): number {
  let max = 0;
  const end = Math.min(to, x.length);
  for (let i = Math.max(0, from); i < end; i++) {
    const v = Math.abs(x[i]!);
    if (v > max) max = v;
  }
  return max;
}

/** M1: max |y_toggled − ((1−g)·y_dry + g·y_wet)| over all channels. */
export function conformanceResidual(
  toggled: Channels,
  dry: Channels,
  wet: Channels,
  g: ArrayLike<number>,
  from = 0,
  to = Number.POSITIVE_INFINITY,
): number {
  let max = 0;
  for (let c = 0; c < toggled.length; c++) {
    const y = toggled[c]!;
    const d = dry[c]!;
    const w = wet[c]!;
    const end = Math.min(to, y.length, d.length, w.length, g.length);
    for (let i = Math.max(0, from); i < end; i++) {
      const gi = g[i]!;
      const r = Math.abs(y[i]! - ((1 - gi) * d[i]! + gi * w[i]!));
      if (r > max) max = r;
    }
  }
  return max;
}

export interface DiscontinuityResult {
  /** High-passed peak of the toggled render inside the windows. */
  peak: number;
  /** Larger high-passed peak of the static references in the same windows. */
  ref: number;
  /** peak − ref; the gate is `excess ≤ CLICK_LIMIT`. */
  excess: number;
}

/** M2 over `[from, to)` frame windows (one per toggle). */
export function discontinuity(
  toggled: Channels,
  references: readonly Channels[],
  sampleRate: number,
  windows: readonly (readonly [number, number])[],
): DiscontinuityResult {
  const peakOf = (chs: Channels) => {
    let max = 0;
    for (const ch of chs) {
      const hp = highpass4(ch, sampleRate);
      for (const [from, to] of windows) max = Math.max(max, maxAbsIn(hp, from, to));
    }
    return max;
  };
  const peak = peakOf(toggled);
  const ref = Math.max(0, ...references.map(peakOf));
  return { peak, ref, excess: peak - ref };
}
