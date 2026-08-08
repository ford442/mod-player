/**
 * CVD-safe (colour-vision-deficiency) note/pitch palettes.
 *
 * Each palette is a 12-entry RGBA Uint8Array (one colour per semitone class,
 * C through B), sized to be uploaded directly as a 12×1 `rgba8unorm` GPU
 * texture or consumed by JavaScript renderers.
 *
 * Palette IDs (cvdPalette):
 *   0 – default pitch-hue (full rainbow, not CVD-safe)
 *   1 – deuteranopia / protanopia-safe (blue–orange diverging, no red/green)
 *   2 – tritanopia-safe (red–green diverging, no blue/yellow)
 *   3 – high-luminance monochrome (accessible for all CVDs)
 *
 * References:
 *   Wong (2011) "Points of view: Color blindness", Nature Methods 8, 441.
 *   Paul Tol's colour schemes: https://personal.sron.nl/~pault/
 */

export const CVD_PALETTE_NAMES = [
  'Default (pitch-hue)',
  'Deuteranopia / Protanopia-safe',
  'Tritanopia-safe',
  'Monochrome (high-contrast)',
] as const;

export type CvdPaletteId = 0 | 1 | 2 | 3;

/** Number of semitones in an octave. */
const SEMITONES = 12;

/** Build a flat Uint8Array (SEMITONES × 4 bytes RGBA) from an RGB tuple array. */
function buildPalette(entries: ReadonlyArray<readonly [number, number, number]>): Uint8Array {
  const buf = new Uint8Array(SEMITONES * 4);
  for (let i = 0; i < SEMITONES; i++) {
    const [r, g, b] = entries[i % entries.length]!;
    buf[i * 4 + 0] = r;
    buf[i * 4 + 1] = g;
    buf[i * 4 + 2] = b;
    buf[i * 4 + 3] = 255;
  }
  return buf;
}

/**
 * Default pitch-hue palette — full rainbow, NOT CVD-safe.
 * Included so all palettes share the same 12×4 byte format.
 */
export const PALETTE_DEFAULT: Uint8Array = buildPalette([
  [255, 80, 80],   // C
  [255, 140, 60],  // C#
  [240, 210, 50],  // D
  [160, 240, 50],  // D#
  [60,  230, 100], // E
  [40,  220, 180], // F
  [40,  180, 255], // F#
  [80,  100, 255], // G
  [150,  60, 255], // G#
  [220,  60, 220], // A
  [255,  60, 160], // A#
  [255,  60,  90], // B
]);

/**
 * Deuteranopia / protanopia-safe palette.
 * Uses a blue–orange diverging sequence (Wong 2011 palette #1).
 * Avoids green/red distinctions that are lost in green-blind viewers.
 */
export const PALETTE_DEUTAN: Uint8Array = buildPalette([
  [  0, 114, 178], // C      – blue
  [  0, 158, 115], // C#     – bluish-green
  [230, 159,   0], // D      – orange
  [ 86, 180, 233], // D#     – sky blue
  [213,  94,   0], // E      – vermilion
  [204, 121, 167], // F      – reddish-purple (safe for protan)
  [  0, 114, 178], // F#     – blue (repeat cycle)
  [  0, 158, 115], // G      – bluish-green
  [240, 228,  66], // G#     – yellow (distinguishable for deutans)
  [ 86, 180, 233], // A      – sky blue
  [213,  94,   0], // A#     – vermilion
  [204, 121, 167], // B      – reddish-purple
]);

/**
 * Tritanopia-safe palette.
 * Uses a red–green diverging sequence; avoids blue/yellow confusions.
 */
export const PALETTE_TRITAN: Uint8Array = buildPalette([
  [215,  25,  28], // C      – red
  [253, 174,  97], // C#     – orange
  [255, 255, 191], // D      – pale yellow-white
  [171, 221, 164], // D#     – pale green
  [ 43, 131, 186], // E      – medium blue
  [215,  48,  39], // F      – deep red
  [244, 109,  67], // F#     – orange-red
  [253, 253, 191], // G      – near-white
  [166, 217, 106], // G#     – light green
  [ 26, 150,  65], // A      – deep green
  [ 69, 117, 180], // A#     – blue
  [215,  25,  28], // B      – red (cycle)
]);

/**
 * High-luminance monochrome palette.
 * 12 evenly-spaced luminance steps; safe for all CVD types and most low-vision.
 */
export const PALETTE_MONO: Uint8Array = buildPalette(
  Array.from({ length: SEMITONES }, (_, i) => {
    const v = Math.round(60 + (i / (SEMITONES - 1)) * 180);
    return [v, v, v] as const;
  }),
);

/**
 * All CVD palettes in ID order.
 */
export const CVD_PALETTES: Readonly<Record<CvdPaletteId, Uint8Array>> = {
  0: PALETTE_DEFAULT,
  1: PALETTE_DEUTAN,
  2: PALETTE_TRITAN,
  3: PALETTE_MONO,
};

/**
 * Returns the CVD-safe palette Uint8Array for a given ID.
 * Falls back to the default palette for unknown IDs.
 */
export function getCvdPalette(id: CvdPaletteId | number): Uint8Array {
  const palette = CVD_PALETTES[id as CvdPaletteId];
  return palette ?? PALETTE_DEFAULT;
}
