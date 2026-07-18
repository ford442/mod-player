import { describe, expect, it } from 'vitest';
import {
  encodeStereoWav,
  EXPORT_SAMPLE_RATE,
  isDurationWithinFrameTolerance,
  wavDurationSeconds,
} from '../utils/wavEncoder';

describe('wavEncoder', () => {
  it('encodes stereo PCM16 WAV with correct RIFF header', () => {
    const frames = 128;
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      left[i] = Math.sin((i / frames) * Math.PI * 2) * 0.5;
      right[i] = Math.cos((i / frames) * Math.PI * 2) * 0.5;
    }

    const blob = encodeStereoWav(left, right);
    expect(blob.type).toBe('audio/wav');
    expect(blob.size).toBe(44 + frames * 4);
  });

  it('computes duration from frame count', () => {
    const seconds = wavDurationSeconds(44100, EXPORT_SAMPLE_RATE);
    expect(seconds).toBeCloseTo(1, 6);
  });

  it('passes within one 30fps frame of metadata duration', () => {
    expect(isDurationWithinFrameTolerance(120.0, 120.0 + 1 / 60)).toBe(true);
    expect(isDurationWithinFrameTolerance(120.0, 120.0 + 1 / 20)).toBe(false);
  });
});
