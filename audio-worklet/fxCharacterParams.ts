/**
 * Shared contract for the FX rack's character stage (#453): processor name,
 * AudioParams, fixed latency and filter corners.
 *
 * Imported by the worklet source (audio-worklet/js/fx-character-processor.ts,
 * bundled in by scripts/build-js-worklet.mjs) and by the main-thread rack, so
 * the two can't drift. DOM-free and global-free: it type-checks under both the
 * app tsconfig and tsconfig.worklet.json.
 */

export const CHARACTER_PROCESSOR_NAME = 'xasm-fx-character';

export const CHARACTER_PARAM_NAMES = [
  'tapeOn',
  'drive',
  'bias',
  'ledOn',
  'ledModel',
  'crushOn',
  'crushRate',
  'crushBits',
  'outputGain',
] as const;

export type CharacterParamName = (typeof CHARACTER_PARAM_NAMES)[number];

export type CharacterParamValues = Record<CharacterParamName, number>;

/** Structurally an `AudioParamDescriptor`. All k-rate: the kernels smooth internally. */
export interface CharacterParamDescriptor {
  readonly name: CharacterParamName;
  readonly defaultValue: number;
  readonly minValue: number;
  readonly maxValue: number;
  readonly automationRate: 'k-rate';
}

/** `ledModel` values. A500 adds its fixed RC output filter in front of the LED filter. */
export const LED_MODEL_A500 = 0;
export const LED_MODEL_A1200 = 1;

export const CHARACTER_PARAM_DESCRIPTORS: readonly CharacterParamDescriptor[] = [
  /** Tape saturation stage on (≥ 0.5) / off. */
  { name: 'tapeOn', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
  /** 0…1 → 0…+24 dB into the saturator. */
  { name: 'drive', defaultValue: 0.3, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
  /** Saturator asymmetry (even harmonics). */
  { name: 'bias', defaultValue: 0.1, minValue: 0, maxValue: 0.5, automationRate: 'k-rate' },
  /** Amiga LED filter on (≥ 0.5) / off — like Paula's E0x toggle. */
  { name: 'ledOn', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
  /** LED_MODEL_A500 (0) or LED_MODEL_A1200 (1). */
  { name: 'ledModel', defaultValue: LED_MODEL_A500, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
  /** Sample-and-hold + bit-depth crush on (≥ 0.5) / off. */
  { name: 'crushOn', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
  /** Hold rate in Hz. */
  { name: 'crushRate', defaultValue: 11025, minValue: 1000, maxValue: 48000, automationRate: 'k-rate' },
  /** Quantizer depth in bits (fractional values allowed). */
  { name: 'crushBits', defaultValue: 8, minValue: 2, maxValue: 16, automationRate: 'k-rate' },
  /** Output trim in dB. */
  { name: 'outputGain', defaultValue: 0, minValue: -24, maxValue: 12, automationRate: 'k-rate' },
];

export function defaultCharacterParams(): CharacterParamValues {
  const out = {} as CharacterParamValues;
  for (const d of CHARACTER_PARAM_DESCRIPTORS) out[d.name] = d.defaultValue;
  return out;
}

/**
 * Index of each param in CHARACTER_PARAM_DESCRIPTORS. The processor keeps the
 * live values in a Float64Array at these indices: keyed stores of doubles onto
 * an object can box them, and process() must not allocate.
 */
export const P_TAPE_ON = 0;
export const P_DRIVE = 1;
export const P_BIAS = 2;
export const P_LED_ON = 3;
export const P_LED_MODEL = 4;
export const P_CRUSH_ON = 5;
export const P_CRUSH_RATE = 6;
export const P_CRUSH_BITS = 7;
export const P_OUTPUT_GAIN = 8;
export const CHARACTER_PARAM_COUNT = 9;

/** Pack named values into the processor's index layout. */
export function characterParamArray(values: Partial<CharacterParamValues> = {}): Float64Array {
  const out = new Float64Array(CHARACTER_PARAM_COUNT);
  CHARACTER_PARAM_DESCRIPTORS.forEach((d, i) => {
    out[i] = values[d.name] ?? d.defaultValue;
  });
  return out;
}

/**
 * ×2 oversampling through a 47-tap halfband, up and down: 23 taps of group
 * delay each at 2·fs, i.e. 23 frames at fs. Constant while the stage is slotted
 * in (oversampling runs even with every sub-stage off).
 */
export const CHARACTER_LATENCY_FRAMES = 23;

/** Amiga LED filter: 2-pole Butterworth low-pass. */
export const LED_CUTOFF_HZ = 3275;
/** Amiga 500 fixed output RC low-pass (6 dB/oct). The A1200's sits above Nyquist. */
export const A500_RC_CUTOFF_HZ = 4420;
/** DC blocker after the asymmetric saturator (at 2·fs). */
export const TAPE_DC_BLOCK_HZ = 10;
/** Sub-stage on/off and model switches are linear crossfades of this length. */
export const CHARACTER_SWITCH_SECONDS = 0.01;
/** One-pole smoothing for continuous params (drive, bias, output gain). */
export const CHARACTER_SMOOTH_SECONDS = 0.005;

/** Main thread → processor messages. */
export const CHARACTER_MSG_RESET = 'reset';
export const CHARACTER_MSG_DISPOSE = 'dispose';
