import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSharedAudioContext,
  PREFERRED_AUDIO_SAMPLE_RATE,
} from '../hooks/audioGraph/createSharedAudioContext';

describe('createSharedAudioContext', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests the preferred sample rate at construction', () => {
    const ctorOptions: AudioContextOptions[] = [];
    class MockAudioContext {
      sampleRate = PREFERRED_AUDIO_SAMPLE_RATE;
      constructor(options?: AudioContextOptions) {
        if (options) ctorOptions.push(options);
      }
    }
    vi.stubGlobal('AudioContext', MockAudioContext);

    const ctx = createSharedAudioContext();
    expect(ctx.sampleRate).toBe(PREFERRED_AUDIO_SAMPLE_RATE);
    expect(ctorOptions[0]).toEqual({
      latencyHint: 'playback',
      sampleRate: PREFERRED_AUDIO_SAMPLE_RATE,
    });
  });

  it('falls back when the browser refuses the requested rate', () => {
    let callCount = 0;
    class MockAudioContext {
      sampleRate = 48000;
      constructor(options?: AudioContextOptions) {
        callCount += 1;
        if (options?.sampleRate === PREFERRED_AUDIO_SAMPLE_RATE) {
          throw new Error('sampleRate not supported');
        }
      }
    }
    vi.stubGlobal('AudioContext', MockAudioContext);

    const ctx = createSharedAudioContext();
    expect(callCount).toBe(2);
    expect(ctx.sampleRate).toBe(48000);
  });
});
