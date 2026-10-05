/**
 * Analysis-bus contract tests.
 *
 * The bus is the one place chassis bands, the channel scope and the Project-M
 * bridge agree on what the audio is doing, so the rules that matter here are
 * the arbitration ones: a GPU producer must be able to shut the AnalyserNode
 * fallback up, the fallback must come back when the GPU goes quiet, and neither
 * may stall the others by throwing. No DOM — snapshots go in as plain objects.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  activeAnalysisSource,
  analysisBusHasSubscribers,
  gpuAnalysisIsLive,
  publishAnalysis,
  readAnalysis,
  resetAnalysisBus,
  startAnalyserAnalysis,
  subscribeAnalysis,
  type AnalysisSnapshot,
  type AnalysisSource,
} from '../utils/audioAnalysisBus';

function snapshot(
  source: AnalysisSource,
  overrides: Partial<AnalysisSnapshot> = {},
): AnalysisSnapshot {
  return {
    audioTime: 0,
    sampleRate: 44100,
    pcm: new Float32Array(8),
    channels: 2,
    bands: { bass: 0.1, lowMid: 0.2, highMid: 0.3, treble: 0.4 },
    rms: 0.5,
    peak: 0.9,
    source,
    ...overrides,
  };
}

/**
 * The bus coalesces its fan-out to 60 Hz off `performance.now()`, so tests that
 * want to observe consecutive publishes drive that clock themselves.
 */
let clock = 0;
const advance = (ms: number) => {
  clock += ms;
};

beforeEach(() => {
  clock = 1_000;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  resetAnalysisBus();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetAnalysisBus();
});

describe('analysis bus distribution', () => {
  it('starts empty', () => {
    expect(readAnalysis()).toBeNull();
    expect(activeAnalysisSource()).toBeNull();
    expect(analysisBusHasSubscribers()).toBe(false);
    expect(gpuAnalysisIsLive()).toBe(false);
  });

  it('delivers one snapshot to every subscriber', () => {
    const seen: AnalysisSnapshot[] = [];
    subscribeAnalysis((s) => seen.push(s));
    subscribeAnalysis((s) => seen.push(s));

    const published = snapshot('gpu-compute');
    expect(publishAnalysis(published)).toBe(true);

    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(published);
    expect(seen[1]).toBe(published);
    expect(readAnalysis()).toBe(published);
    expect(activeAnalysisSource()).toBe('gpu-compute');
  });

  it('stops delivering after unsubscribe', () => {
    const seen: AnalysisSnapshot[] = [];
    const unsubscribe = subscribeAnalysis((s) => seen.push(s));
    publishAnalysis(snapshot('gpu-compute'));
    unsubscribe();
    advance(100);
    publishAnalysis(snapshot('gpu-compute'));

    expect(seen).toHaveLength(1);
    expect(analysisBusHasSubscribers()).toBe(false);
  });

  it('publishes with no subscribers without throwing', () => {
    expect(() => publishAnalysis(snapshot('gpu-compute'))).not.toThrow();
    expect(readAnalysis()?.source).toBe('gpu-compute');
  });

  it('isolates a throwing subscriber', () => {
    const healthy = vi.fn();
    subscribeAnalysis(() => {
      throw new Error('boom');
    });
    subscribeAnalysis(healthy);

    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => publishAnalysis(snapshot('gpu-compute'))).not.toThrow();
    expect(healthy).toHaveBeenCalledTimes(1);
  });
});

describe('60 Hz coalescing', () => {
  it('drops the fan-out for a publish inside the frame window', () => {
    const seen: AnalysisSnapshot[] = [];
    subscribeAnalysis((s) => seen.push(s));

    publishAnalysis(snapshot('gpu-compute', { audioTime: 1 }));
    advance(2);
    publishAnalysis(snapshot('gpu-compute', { audioTime: 2 }));
    advance(2);
    publishAnalysis(snapshot('gpu-compute', { audioTime: 3 }));

    expect(seen).toHaveLength(1);
  });

  it('still advances the polled snapshot for every publish', () => {
    subscribeAnalysis(() => {});
    publishAnalysis(snapshot('gpu-compute', { audioTime: 1 }));
    advance(2);
    publishAnalysis(snapshot('gpu-compute', { audioTime: 2 }));

    // A RAF consumer polling readAnalysis() must never see the dropped frame.
    expect(readAnalysis()?.audioTime).toBe(2);
  });

  it('fans out again once a frame has passed', () => {
    const seen: AnalysisSnapshot[] = [];
    subscribeAnalysis((s) => seen.push(s));

    publishAnalysis(snapshot('gpu-compute'));
    advance(20);
    publishAnalysis(snapshot('gpu-compute'));

    expect(seen).toHaveLength(2);
  });
});

describe('producer arbitration', () => {
  it('drops analyser-fallback publishes while the GPU is live', () => {
    publishAnalysis(snapshot('gpu-compute', { audioTime: 1 }));
    expect(gpuAnalysisIsLive()).toBe(true);

    advance(50);
    expect(publishAnalysis(snapshot('analyser-fallback', { audioTime: 2 }))).toBe(false);

    expect(activeAnalysisSource()).toBe('gpu-compute');
    expect(readAnalysis()?.audioTime).toBe(1);
  });

  it('lets the fallback take over once the GPU goes quiet', () => {
    publishAnalysis(snapshot('gpu-compute'));
    advance(251);
    expect(gpuAnalysisIsLive()).toBe(false);
    expect(publishAnalysis(snapshot('analyser-fallback'))).toBe(true);
    expect(activeAnalysisSource()).toBe('analyser-fallback');
  });

  it('hands the bus straight back to the GPU', () => {
    advance(400);
    publishAnalysis(snapshot('analyser-fallback'));
    expect(activeAnalysisSource()).toBe('analyser-fallback');

    advance(20);
    publishAnalysis(snapshot('gpu-compute'));
    expect(activeAnalysisSource()).toBe('gpu-compute');
  });
});

describe('startAnalyserAnalysis', () => {
  /** Minimal AnalyserNode stand-in; vitest runs in node, there is no WebAudio. */
  function fakeAnalyser(wave: (i: number) => number) {
    return {
      fftSize: 8,
      frequencyBinCount: 4,
      context: { sampleRate: 44100, currentTime: 12.5 },
      getByteFrequencyData: vi.fn((out: Uint8Array) => out.fill(255)),
      getFloatTimeDomainData: vi.fn((out: Float32Array) => {
        for (let i = 0; i < out.length; i++) out[i] = wave(i);
      }),
    } as unknown as AnalyserNode;
  }

  let frame: (() => void) | null = null;

  beforeEach(() => {
    frame = null;
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      frame = cb;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {
      frame = null;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is a no-op without an analyser', () => {
    const stop = startAnalyserAnalysis(null);
    expect(frame).toBeNull();
    expect(() => stop()).not.toThrow();
  });

  it('reads nothing while no surface is subscribed', () => {
    const analyser = fakeAnalyser(() => 0.5);
    startAnalyserAnalysis(analyser);
    frame?.();

    expect(analyser.getByteFrequencyData).not.toHaveBeenCalled();
    expect(readAnalysis()).toBeNull();
  });

  it('reads nothing while the GPU producer owns the bus', () => {
    subscribeAnalysis(() => {});
    publishAnalysis(snapshot('gpu-compute'));

    const analyser = fakeAnalyser(() => 0.5);
    startAnalyserAnalysis(analyser);
    frame?.();

    expect(analyser.getByteFrequencyData).not.toHaveBeenCalled();
  });

  it('publishes bands, rms and peak once subscribed', () => {
    const seen: AnalysisSnapshot[] = [];
    subscribeAnalysis((s) => seen.push(s));

    // Alternating ±0.5: rms is 0.5 and peak is 0.5.
    startAnalyserAnalysis(fakeAnalyser((i) => (i % 2 === 0 ? 0.5 : -0.5)));
    frame?.();

    expect(seen).toHaveLength(1);
    const s = seen[0]!;
    expect(s.source).toBe('analyser-fallback');
    expect(s.audioTime).toBe(12.5);
    expect(s.sampleRate).toBe(44100);
    expect(s.channels).toBe(1);
    expect(s.rms).toBeCloseTo(0.5, 6);
    expect(s.peak).toBeCloseTo(0.5, 6);
    // Every bin pinned at 255 → every band saturates.
    expect(s.bands.bass).toBeCloseTo(1, 6);
    expect(s.bands.treble).toBeCloseTo(1, 6);
  });

  it('copies the time-domain buffer so a held snapshot cannot mutate', () => {
    let amplitude = 1;
    const seen: AnalysisSnapshot[] = [];
    subscribeAnalysis((s) => seen.push(s));
    startAnalyserAnalysis(fakeAnalyser(() => amplitude));

    frame?.();
    const first = seen[0]!.pcm;
    amplitude = -1;
    advance(20);
    frame?.();

    expect(Array.from(first)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it('stops reading after cleanup', () => {
    subscribeAnalysis(() => {});
    const analyser = fakeAnalyser(() => 0.5);
    const stop = startAnalyserAnalysis(analyser);
    stop();

    expect(frame).toBeNull();
  });
});
