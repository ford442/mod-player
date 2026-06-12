/**
 * Dynamic per-instrument color palette generator.
 *
 * Produces a deterministic, stable RGB color for every instrument index in a
 * tracker module. Colors are derived with a golden-ratio hue rotation so
 * adjacent indices are visually distinct. Instrument names are hashed to add
 * module-specific variance while keeping the same module stable across reloads.
 *
 * Output is sized for a small 1-D GPU texture (rgba8unorm). Unused slots are
 * filled with a muted dark gray so out-of-range reads degrade gracefully.
 */

export const MAX_INSTRUMENT_PALETTE_SIZE = 64;

const GOLDEN_ANGLE = 0.618033988749895; // fractional turn

function hashStringTo01(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
  }
  // Normalize to [0, 1] using the lower 32 bits
  const normalized = (hash & 0x7fffffff) / 0x7fffffff;
  return Number.isFinite(normalized) ? normalized : 0;
}

function fract(n: number): number {
  return n - Math.floor(n);
}

/**
 * Convert HSV (hue in turns, saturation/value in [0,1]) to RGB ([0,1]).
 */
export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const hueTurns = fract(h);
  const hi = Math.floor(hueTurns * 6);
  const f = hueTurns * 6 - hi;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);

  switch (hi % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}

/**
 * Generate a per-instrument palette.
 *
 * @param count   Number of instruments in the module. Clamped to MAX_INSTRUMENT_PALETTE_SIZE.
 * @param names   Optional instrument names used to perturb hues deterministically.
 * @returns       A Uint8Array of length MAX_INSTRUMENT_PALETTE_SIZE * 4 (RGBA).
 */
export function generateInstrumentPalette(
  count: number,
  names: string[] = [],
): Uint8Array {
  const size = MAX_INSTRUMENT_PALETTE_SIZE;
  const data = new Uint8Array(size * 4);

  const activeCount = Math.max(0, Math.min(count, size));
  for (let i = 0; i < size; i++) {
    const offset = i * 4;
    if (i < activeCount) {
      const nameOffset = hashStringTo01(names[i] ?? '');
      const hue = fract((i * GOLDEN_ANGLE) + nameOffset);
      // Keep saturation high but not neon-overwhelming; value bright enough for LEDs.
      const [r, g, b] = hsvToRgb(hue, 0.78, 0.92);
      data[offset] = Math.round(r * 255);
      data[offset + 1] = Math.round(g * 255);
      data[offset + 2] = Math.round(b * 255);
      data[offset + 3] = 255;
    } else {
      // Unused slot: dark neutral gray so texture sampling is safe.
      data[offset] = 20;
      data[offset + 1] = 20;
      data[offset + 2] = 22;
      data[offset + 3] = 255;
    }
  }

  return data;
}

/**
 * Generate a fallback palette for modules that report no instruments.
 * This is the same shape as a module-derived palette but every slot is muted.
 */
export function generateEmptyInstrumentPalette(): Uint8Array {
  return generateInstrumentPalette(0, []);
}
