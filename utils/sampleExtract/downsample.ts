import { WAVEFORM_POINTS } from '../../types/instruments';

/**
 * Min/max peak envelope downsample for waveform thumbnails.
 * Accepts signed 8-bit PCM (÷128) or signed 16-bit PCM (÷32768).
 */
export function downsamplePeaks(
  pcm: Int8Array | Int16Array,
  points = WAVEFORM_POINTS,
): Float32Array {
  const out = new Float32Array(points);
  if (pcm.length === 0) return out;

  const scale = pcm instanceof Int16Array ? 32768 : 128;
  const blockSize = pcm.length / points;
  for (let i = 0; i < points; i++) {
    const start = Math.floor(i * blockSize);
    const end = Math.max(start + 1, Math.floor((i + 1) * blockSize));
    let min = 0;
    let max = 0;
    for (let j = start; j < end && j < pcm.length; j++) {
      const v = pcm[j]! / scale;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    out[i] = Math.abs(max) >= Math.abs(min) ? max : min;
  }
  return out;
}
