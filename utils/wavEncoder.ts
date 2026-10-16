import { CD_SAMPLE_RATE, PLAYER_SAMPLE_RATE, type PlayerSampleRate } from './sampleRates';

/**
 * Default WAV export rate = the live render rate (#490). Export at the rate you
 * heard: libopenmpt's resampler, the 48 kHz-authored room IRs and the character
 * stage's halfband then run exactly as they did live.
 */
export const EXPORT_SAMPLE_RATE = PLAYER_SAMPLE_RATE;

export type ExportSampleRate = PlayerSampleRate;

/** Export rate choices, default first. 44.1 kHz is an explicit "CD rate" option. */
export const EXPORT_SAMPLE_RATE_OPTIONS: readonly { rate: ExportSampleRate; label: string }[] = [
  { rate: PLAYER_SAMPLE_RATE, label: '48 kHz (as heard)' },
  { rate: CD_SAMPLE_RATE, label: '44.1 kHz (CD)' },
];

/** One video frame at 30 fps — used as duration parity tolerance. */
export const EXPORT_FRAME_SECONDS = 1 / 30;

export interface WavEncodeOptions {
  sampleRate?: number;
  /** When true, input is interleaved LRLR…; otherwise separate left/right arrays. */
  interleaved?: boolean;
}

function clampSample(sample: number): number {
  if (sample > 1) return 1;
  if (sample < -1) return -1;
  return sample;
}

function floatToPcm16(sample: number): number {
  const clamped = clampSample(sample);
  const scaled = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  return Math.round(scaled);
}

/**
 * Encode stereo float PCM (−1…1) into a 16-bit little-endian WAV blob.
 */
export function encodeStereoWav(
  left: Float32Array,
  right: Float32Array,
  options: WavEncodeOptions = {},
): Blob {
  const sampleRate = options.sampleRate ?? EXPORT_SAMPLE_RATE;
  const frameCount = Math.min(left.length, right.length);
  const dataBytes = frameCount * 4;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let i = 0; i < frameCount; i++) {
    view.setInt16(offset, floatToPcm16(left[i] ?? 0), true);
    offset += 2;
    view.setInt16(offset, floatToPcm16(right[i] ?? 0), true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

export function encodeInterleavedStereoWav(
  interleaved: Float32Array,
  options: WavEncodeOptions = {},
): Blob {
  const sampleRate = options.sampleRate ?? EXPORT_SAMPLE_RATE;
  const frameCount = Math.floor(interleaved.length / 2);
  const left = new Float32Array(frameCount);
  const right = new Float32Array(frameCount);
  for (let i = 0; i < frameCount; i++) {
    left[i] = interleaved[i * 2] ?? 0;
    right[i] = interleaved[i * 2 + 1] ?? 0;
  }
  return encodeStereoWav(left, right, { sampleRate, interleaved: true });
}

/** Duration of a stereo WAV blob from its sample count. */
export function wavDurationSeconds(
  frameCount: number,
  sampleRate: number = EXPORT_SAMPLE_RATE,
): number {
  return frameCount / sampleRate;
}

/** True when rendered duration is within one 30 fps frame of metadata. */
export function isDurationWithinFrameTolerance(
  renderedSeconds: number,
  metadataSeconds: number,
  frameSeconds: number = EXPORT_FRAME_SECONDS,
): boolean {
  return Math.abs(renderedSeconds - metadataSeconds) <= frameSeconds;
}
