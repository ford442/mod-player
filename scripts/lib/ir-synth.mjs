/**
 * Deterministic synthetic room impulse responses for the FX rack (#453).
 *
 * Wet-only (no direct impulse — the room module carries the dry signal, and
 * Opus would smear a lone impulse anyway): a handful of early reflections,
 * then a decorrelated noise tail decaying faster in the highs than the lows,
 * a 20 ms end fade, normalized to unit energy per channel.
 *
 * Used by scripts/generate-irs.mjs (→ public/ir/*.opus) and by the vitest room
 * tests, which synthesize the same IRs at any sample rate (node-web-audio-api
 * cannot decode Opus).
 */

/** Bump when the algorithm changes (part of every IR's sourceHash). */
export const IR_SYNTH_VERSION = 1;

export const IR_SPECS = {
  small: { seconds: 0.35, rt60Low: 0.45, rt60High: 0.22, reflections: 6, firstMs: 2, lastMs: 18, seed: 101 },
  medium: { seconds: 0.7, rt60Low: 0.9, rt60High: 0.45, reflections: 9, firstMs: 3, lastMs: 26, seed: 202 },
  large: { seconds: 1.0, rt60Low: 1.4, rt60High: 0.7, reflections: 12, firstMs: 4, lastMs: 34, seed: 303 },
};

export const IR_IDS = /** @type {(keyof typeof IR_SPECS)[]} */ (Object.keys(IR_SPECS));

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {keyof typeof IR_SPECS} id
 * @param {number} sampleRate
 * @returns {Float32Array[]} two channels
 */
export function synthIr(id, sampleRate = 48000) {
  const spec = IR_SPECS[id];
  if (!spec) throw new Error(`unknown IR ${id}`);
  const n = Math.round(spec.seconds * sampleRate);
  const fadeIn = Math.round(0.006 * sampleRate);
  const fadeOut = Math.round(0.02 * sampleRate);
  // 1-pole split at ~1.8 kHz into the two decay bands.
  const split = Math.exp((-2 * Math.PI * 1800) / sampleRate);
  return [0, 1].map((channel) => {
    const rand = mulberry32(spec.seed * 31 + channel * 7919);
    const out = new Float64Array(n);
    let low = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate;
      const white = rand() * 2 - 1;
      low = white + split * (low - white);
      const high = white - low;
      const envLow = Math.pow(10, (-3 * t) / spec.rt60Low);
      const envHigh = Math.pow(10, (-3 * t) / spec.rt60High);
      const onset = i < fadeIn ? i / fadeIn : 1;
      out[i] = onset * (low * envLow * 1.6 + high * envHigh);
    }
    for (let r = 0; r < spec.reflections; r++) {
      const ms = spec.firstMs + (spec.lastMs - spec.firstMs) * rand();
      const at = Math.min(n - 1, Math.round((ms / 1000) * sampleRate));
      const amp = (0.6 - (0.4 * r) / spec.reflections) * (rand() < 0.5 ? -1 : 1);
      // A short smoothed spike (3 taps) instead of a lone sample.
      out[at] += amp;
      if (at > 0) out[at - 1] += amp * 0.4;
      if (at + 1 < n) out[at + 1] += amp * 0.4;
    }
    for (let i = 0; i < fadeOut; i++) {
      const k = n - fadeOut + i;
      out[k] *= 0.5 * (1 + Math.cos((Math.PI * (i + 1)) / fadeOut));
    }
    let energy = 0;
    for (let i = 0; i < n; i++) energy += out[i] * out[i];
    const scale = 1 / Math.sqrt(energy);
    const f32 = new Float32Array(n);
    for (let i = 0; i < n; i++) f32[i] = out[i] * scale;
    return f32;
  });
}
