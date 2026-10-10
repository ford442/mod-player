/**
 * Deterministic test signals for FX rack tests (#453) — shared by the vitest
 * Web Audio tests and the Chromium harness. Not shipped.
 */

export interface SignalOptions {
  sampleRate: number;
  seconds: number;
  channels?: number;
}

/** Low sine (+ optional DC): almost no content above a few hundred Hz, so a high-passed render exposes clicks. */
export function lowSine(
  opts: SignalOptions & { freq?: number; amp?: number; dc?: number },
): Float32Array<ArrayBuffer>[] {
  const { sampleRate, seconds, channels = 2, freq = 55, amp = 0.25, dc = 0 } = opts;
  const n = Math.round(sampleRate * seconds);
  return Array.from({ length: channels }, (_, c) => {
    const out = new Float32Array(n);
    // Channels a quarter cycle apart, so stereo paths are exercised independently.
    const phase = (c * Math.PI) / 2;
    for (let i = 0; i < n; i++) out[i] = dc + amp * Math.sin((2 * Math.PI * freq * i) / sampleRate + phase);
    return out;
  });
}

/** Seeded white noise (LCG), one independent stream per channel. */
export function noise(opts: SignalOptions & { amp?: number; seed?: number }): Float32Array<ArrayBuffer>[] {
  const { sampleRate, seconds, channels = 2, amp = 0.1, seed = 1 } = opts;
  const n = Math.round(sampleRate * seconds);
  return Array.from({ length: channels }, (_, c) => {
    const out = new Float32Array(n);
    let s = (seed * 2654435761 + c * 40503) >>> 0;
    for (let i = 0; i < n; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      out[i] = amp * (2 * (s / 0xffffffff) - 1);
    }
    return out;
  });
}

/** "Program" material: a few partials plus noise — what parity / null tests push through. */
export function program(opts: SignalOptions & { seed?: number }): Float32Array<ArrayBuffer>[] {
  const { sampleRate, seconds, channels = 2, seed = 7 } = opts;
  const hiss = noise({ sampleRate, seconds, channels, amp: 0.03, seed });
  const partials = [
    [55, 0.3],
    [220, 0.15],
    [1250, 0.08],
    [5100, 0.04],
  ] as const;
  return hiss.map((ch, c) => {
    for (let i = 0; i < ch.length; i++) {
      let v = ch[i]!;
      for (const [f, a] of partials) v += a * Math.sin((2 * Math.PI * f * i) / sampleRate + c);
      ch[i] = v;
    }
    return ch;
  });
}
