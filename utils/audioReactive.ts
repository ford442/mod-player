/**
 * SharedArrayBuffer layout for worklet → main-thread → GPU audio reactivity.
 *
 * Float layout (total OSC_SAMPLES + AUDIO_REACTIVE_FLOATS floats):
 *   [0 .. OSC_SAMPLES-1]           — oscilloscope ring buffer (mono, left channel)
 *   [OSC_SAMPLES .. +META-1]        — band energy + meters (see indices below)
 */

export const OSC_SAMPLE_COUNT = 2048;
export const AUDIO_REACTIVE_FLOATS = 16;
export const AUDIO_SAB_FLOATS = OSC_SAMPLE_COUNT + AUDIO_REACTIVE_FLOATS;
export const AUDIO_SAB_BYTES = AUDIO_SAB_FLOATS * 4;

/** Metadata float indices (offset = OSC_SAMPLE_COUNT). */
export const AR_BASS = 0;
export const AR_MID = 1;
export const AR_HIGH = 2;
export const AR_AMPLITUDE = 3;
export const AR_BEAT = 4;
export const AR_PEAK_L = 5;
export const AR_PEAK_R = 6;
export const AR_RMS_L = 7;
export const AR_RMS_R = 8;
export const AR_FLAGS = 9;

/** Bit 0 of AR_FLAGS — worklet used coarse VU instead of band split. */
export const AR_FLAG_LITE = 1;

/** GPU uniform size (std140-aligned AudioReactive struct). */
export const AUDIO_REACTIVE_UNIFORM_BYTES = 64;

export interface AudioBandSnapshot {
  bass: number;
  mid: number;
  high: number;
  amplitude: number;
  beat: number;
  peakL: number;
  peakR: number;
  rmsL: number;
  rmsR: number;
}

export function viewsFromAudioSab(buffer: SharedArrayBuffer): {
  osc: Float32Array;
  meta: Float32Array;
} {
  return {
    osc: new Float32Array(buffer, 0, OSC_SAMPLE_COUNT),
    meta: new Float32Array(buffer, OSC_SAMPLE_COUNT * 4, AUDIO_REACTIVE_FLOATS),
  };
}

export function readAudioBands(meta: Float32Array): AudioBandSnapshot {
  return {
    bass: meta[AR_BASS] ?? 0,
    mid: meta[AR_MID] ?? 0,
    high: meta[AR_HIGH] ?? 0,
    amplitude: meta[AR_AMPLITUDE] ?? 0,
    beat: meta[AR_BEAT] ?? 0,
    peakL: meta[AR_PEAK_L] ?? 0,
    peakR: meta[AR_PEAK_R] ?? 0,
    rmsL: meta[AR_RMS_L] ?? 0,
    rmsR: meta[AR_RMS_R] ?? 0,
  };
}

/** Pack band snapshot into a 64-byte GPU uniform (16 × f32). */
export function packAudioReactiveUniform(
  bands: AudioBandSnapshot,
  enabled: boolean,
  bloomDrive: number,
  out: Float32Array,
): void {
  out[0] = bands.bass;
  out[1] = bands.mid;
  out[2] = bands.high;
  out[3] = bands.amplitude;
  out[4] = bands.beat;
  out[5] = bands.peakL;
  out[6] = bands.peakR;
  out[7] = bands.rmsL;
  out[8] = bands.rmsR;
  out[9] = enabled ? 1 : 0;
  out[10] = bloomDrive;
  out[11] = 0;
  out[12] = 0;
  out[13] = 0;
  out[14] = 0;
  out[15] = 0;
}
