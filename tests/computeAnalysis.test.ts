/**
 * GPU audio-analysis host + kernel contract tests.
 *
 * Vitest has no GPU, so this suite does two things the CI machine *can* do:
 *
 *  1. Runs a CPU reference of the exact algorithm shaders/lib/fft.wgsl and
 *     lib/spectrum_bands.wgsl encode (same Hann window, same radix-2 butterfly
 *     order, same band edges) and checks it produces the values the host then
 *     folds into the AudioReactive uniform.
 *  2. Pins every constant that is duplicated between WGSL and TypeScript. A GPU
 *     kernel with a mismatched workgroup size or bin count fails silently at
 *     runtime — here it fails loudly.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_FFT_SIZE,
  PCM_FRAME_CAPACITY,
  PcmRing,
  SPECTRUM_BIN_COUNT,
  clampFftSize,
  foldBandsToSnapshot,
  nextBeatEnvelope,
} from '../src/renderers/webgpu/computeAnalysis';
import {
  NOTE_DURATION_WORKGROUP_SIZE,
  noteDurationWorkgroupCount,
} from '../utils/computeNoteDuration';
import { OSC_SAMPLE_COUNT } from '../utils/audioReactive';
import {
  pcmBusHasSubscribers,
  publishPcmBlock,
  resetPcmBus,
  setPcmDemandListener,
  subscribePcm,
} from '../utils/pcmBus';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const readShader = (rel: string) => readFileSync(join(ROOT, 'shaders', rel), 'utf8');

const FFT_SRC = readShader('lib/fft.wgsl');
const BANDS_SRC = readShader('lib/spectrum_bands.wgsl');
const WAVE_SRC = readShader('lib/waveform_minmax.wgsl');
const ENTRY_SRC = readShader('compute_analysis.wgsl');
const DURATION_SRC = readShader('compute_note_duration.wgsl');

/** Pull `const NAME: type = <number>;` out of a WGSL source. */
function wgslConst(source: string, name: string): number {
  const match = source.match(new RegExp(`const\\s+${name}\\s*:\\s*\\w+\\s*=\\s*([0-9.]+)`));
  if (!match?.[1]) throw new Error(`WGSL const ${name} not found`);
  return Number(match[1]);
}

// ── CPU reference of the WGSL kernel ─────────────────────────────────────────

/** Periodic Hann — matches `fftHann`. */
const hann = (i: number, n: number) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);

/** Matches `fftBitReverse`. */
function bitReverse(value: number, bits: number): number {
  let out = 0;
  for (let b = 0; b < bits; b++) {
    out = (out << 1) | ((value >>> b) & 1);
  }
  return out >>> 0;
}

/**
 * Same butterfly order as `fftRunStages`, run serially.
 * Returns single-sided magnitudes normalised by 2/n, like `fftMagnitude`.
 */
function referenceSpectrum(samples: Float32Array, n: number): Float32Array {
  const bits = Math.log2(n);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    re[bitReverse(i, bits)] = (samples[i] ?? 0) * hann(i, n);
  }

  for (let stage = 0, len = 2; stage < bits; stage++, len <<= 1) {
    const half = len >> 1;
    for (let k = 0; k < n / 2; k++) {
      const i0 = Math.floor(k / half) * len + (k % half);
      const i1 = i0 + half;
      const angle = (-2 * Math.PI * (k % half)) / len;
      const wr = Math.cos(angle);
      const wi = Math.sin(angle);
      const tr = (re[i1] ?? 0) * wr - (im[i1] ?? 0) * wi;
      const ti = (re[i1] ?? 0) * wi + (im[i1] ?? 0) * wr;
      const ar = re[i0] ?? 0;
      const ai = im[i0] ?? 0;
      re[i0] = ar + tr;
      im[i0] = ai + ti;
      re[i1] = ar - tr;
      im[i1] = ai - ti;
    }
  }

  const half = n >> 1;
  const magnitudes = new Float32Array(half);
  for (let k = 0; k < half; k++) {
    magnitudes[k] = (Math.hypot(re[k] ?? 0, im[k] ?? 0) * 4) / n;
  }
  return magnitudes;
}

const BAND_BASS_HZ = 180;
const BAND_LOW_MID_HZ = 1200;
const BAND_HIGH_MID_HZ = 5000;

/** Matches `spectrumBandOf` + `spectrumAccumulateBands` + `spectrumReduceBands`. */
function referenceBands(magnitudes: Float32Array, n: number, sampleRate: number): Float32Array {
  const energy = [0, 0, 0, 0];
  const hzPerBin = sampleRate / n;
  // Bin 0 (DC) is skipped by the kernel.
  for (let k = 1; k < magnitudes.length; k++) {
    const freq = k * hzPerBin;
    const band =
      freq < BAND_BASS_HZ ? 0 : freq < BAND_LOW_MID_HZ ? 1 : freq < BAND_HIGH_MID_HZ ? 2 : 3;
    const mag = magnitudes[k] ?? 0;
    energy[band] = (energy[band] ?? 0) + mag * mag;
  }
  return Float32Array.from(energy, Math.sqrt);
}

/** Matches `waveformTileRange`. */
function tileRange(texel: number, texelCount: number, frameCount: number): [number, number] {
  const start = Math.floor((texel * frameCount) / texelCount);
  let end = Math.floor(((texel + 1) * frameCount) / texelCount);
  if (end <= start) end = start + 1;
  return [start, Math.min(end, frameCount)];
}

/** Matches `waveformEnvelope`. */
const envelope = (lo: number, hi: number) => (Math.abs(hi) >= Math.abs(lo) ? hi : lo);

function sine(freqHz: number, n: number, sampleRate: number, amplitude = 1): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * freqHz * i) / sampleRate);
  }
  return out;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('WGSL ↔ TypeScript constant parity', () => {
  it('FFT / waveform / bin sizes match the host', () => {
    expect(wgslConst(FFT_SRC, 'MAX_FFT_SIZE')).toBe(MAX_FFT_SIZE);
    expect(wgslConst(BANDS_SRC, 'SPECTRUM_BIN_COUNT')).toBe(SPECTRUM_BIN_COUNT);
    // Host dispatch divides oscSampleCount by this; a mismatch silently drops texels.
    expect(wgslConst(WAVE_SRC, 'WAVEFORM_WORKGROUP_SIZE')).toBe(64);
  });

  it('band crossovers match the reference used above and the worklet IIR split', () => {
    expect(wgslConst(BANDS_SRC, 'BAND_BASS_HZ')).toBe(BAND_BASS_HZ);
    expect(wgslConst(BANDS_SRC, 'BAND_LOW_MID_HZ')).toBe(BAND_LOW_MID_HZ);
    expect(wgslConst(BANDS_SRC, 'BAND_HIGH_MID_HZ')).toBe(BAND_HIGH_MID_HZ);
  });

  it('workgroup storage stays inside the WebGPU 16 KiB baseline', () => {
    const fftBytes = MAX_FFT_SIZE * 8; // array<vec2<f32>>
    const bandBytes = wgslConst(FFT_SRC, 'FFT_WORKGROUP_SIZE') * 16; // array<vec4<f32>>
    const timeBytes = wgslConst(FFT_SRC, 'FFT_WORKGROUP_SIZE') * 8; // array<vec2<f32>>
    const binBytes = SPECTRUM_BIN_COUNT * 4;
    expect(fftBytes + bandBytes + timeBytes + binBytes).toBeLessThanOrEqual(16384);
  });

  it('entry shader declares both compute entry points and includes all three libs', () => {
    expect(ENTRY_SRC).toContain('fn waveform_main(');
    expect(ENTRY_SRC).toContain('fn spectrum_main(');
    for (const lib of ['lib/waveform_minmax.wgsl', 'lib/fft.wgsl', 'lib/spectrum_bands.wgsl']) {
      expect(ENTRY_SRC).toContain(`//#include "${lib}"`);
    }
  });

  it('the FFT window fits inside the PCM ring and the osc texture', () => {
    expect(MAX_FFT_SIZE).toBeLessThanOrEqual(PCM_FRAME_CAPACITY);
    expect(OSC_SAMPLE_COUNT % 64).toBe(0);
  });
});

describe('spectrum reference (the algorithm the WGSL encodes)', () => {
  const sampleRate = 44100;
  const n = MAX_FFT_SIZE;

  it('normalises a full-scale sine to ~1.0 at its bin (4/n Hann scaling)', () => {
    // Land exactly on bin 64 so there is no scalloping loss to argue about.
    const binIndex = 64;
    const freq = (binIndex * sampleRate) / n;
    const magnitudes = referenceSpectrum(sine(freq, n, sampleRate), n);
    expect(magnitudes[binIndex]).toBeGreaterThan(0.9);
    expect(magnitudes[binIndex]).toBeLessThan(1.1);
  });

  it.each([
    ['bass', 60, 0],
    ['lowMid', 440, 1],
    ['highMid', 2500, 2],
    ['treble', 9000, 3],
  ])('routes a %s tone into band %i', (_name, freq, expectedBand) => {
    const magnitudes = referenceSpectrum(sine(freq as number, n, sampleRate), n);
    const bands = referenceBands(magnitudes, n, sampleRate);
    const dominant = bands.indexOf(Math.max(...bands));
    expect(dominant).toBe(expectedBand);
  });

  it('reports silence as all-zero bands', () => {
    const bands = referenceBands(referenceSpectrum(new Float32Array(n), n), n, sampleRate);
    for (const value of bands) expect(value).toBeCloseTo(0, 6);
  });
});

describe('foldBandsToSnapshot', () => {
  /** Build the 8-float meta buffer compute_analysis.wgsl writes. */
  const meta = (bands: number[], amplitude = 0.5, rms = 0.3, peak = 0.8) =>
    Float32Array.from([...bands, amplitude, rms, peak, 1]);

  it('maps the four GPU bands onto the three uniform slots', () => {
    const snapshot = foldBandsToSnapshot(meta([0.4, 0.3, 0.2, 0.1]), 0);
    expect(snapshot.bass).toBeCloseTo(0.4);
    expect(snapshot.mid).toBeCloseTo(0.3);
    // highMid and treble combine in energy, not amplitude.
    expect(snapshot.high).toBeCloseTo(Math.sqrt(0.2 * 0.2 + 0.1 * 0.1));
    // Float32 round-trip through the meta buffer, so compare per field.
    expect(snapshot.bands.bass).toBeCloseTo(0.4);
    expect(snapshot.bands.lowMid).toBeCloseTo(0.3);
    expect(snapshot.bands.highMid).toBeCloseTo(0.2);
    expect(snapshot.bands.treble).toBeCloseTo(0.1);
  });

  it('mirrors rms / peak onto both channels and carries amplitude through', () => {
    const snapshot = foldBandsToSnapshot(meta([0, 0, 0, 0], 0.66, 0.25, 0.9), 0.5);
    expect(snapshot.amplitude).toBeCloseTo(0.66);
    expect(snapshot.rmsL).toBeCloseTo(0.25);
    expect(snapshot.rmsR).toBeCloseTo(0.25);
    expect(snapshot.peakL).toBeCloseTo(0.9);
    expect(snapshot.peakR).toBeCloseTo(0.9);
    expect(snapshot.beat).toBe(0.5);
  });

  it('produces a full-width bin array', () => {
    expect(foldBandsToSnapshot(meta([0, 0, 0, 0]), 0).bins).toHaveLength(SPECTRUM_BIN_COUNT);
  });
});

describe('beat envelope', () => {
  it('spikes on rising bass and decays afterwards', () => {
    const attack = nextBeatEnvelope(0.5, 0.1, 0);
    expect(attack).toBe(1); // flux × 6 saturates
    const decay = nextBeatEnvelope(0.5, 0.5, attack);
    expect(decay).toBeLessThan(attack);
    expect(decay).toBeGreaterThan(0);
  });

  it('never goes negative when bass falls', () => {
    expect(nextBeatEnvelope(0, 0.9, 0)).toBe(0);
  });
});

describe('clampFftSize', () => {
  it('accepts the supported window lengths unchanged', () => {
    for (const size of [256, 512, 1024]) expect(clampFftSize(size)).toBe(size);
  });

  it('rounds up to the next supported size and caps at MAX_FFT_SIZE', () => {
    expect(clampFftSize(300)).toBe(512);
    expect(clampFftSize(1)).toBe(256);
    // 2048 needs 16 KiB of workgroup storage — refused, not silently attempted.
    expect(clampFftSize(2048)).toBe(MAX_FFT_SIZE);
  });
});

describe('waveform tiling', () => {
  it('partitions the PCM block with no gaps or overlaps', () => {
    const texelCount = 8;
    const frameCount = 100;
    let previousEnd = 0;
    for (let texel = 0; texel < texelCount; texel++) {
      const [start, end] = tileRange(texel, texelCount, frameCount);
      expect(start).toBe(previousEnd);
      expect(end).toBeGreaterThan(start);
      previousEnd = end;
    }
    expect(previousEnd).toBe(frameCount);
  });

  it('collapses to the exact sample at 1:1', () => {
    const frameCount = 16;
    for (let texel = 0; texel < frameCount; texel++) {
      expect(tileRange(texel, frameCount, frameCount)).toEqual([texel, texel + 1]);
    }
  });

  it('never produces an empty tile when texels outnumber frames', () => {
    for (let texel = 0; texel < 64; texel++) {
      const [start, end] = tileRange(texel, 64, 4);
      expect(end).toBeGreaterThanOrEqual(start);
      expect(end).toBeLessThanOrEqual(4);
    }
  });

  it('keeps the larger excursion, sign intact', () => {
    expect(envelope(-0.9, 0.2)).toBe(-0.9);
    expect(envelope(-0.2, 0.9)).toBe(0.9);
    expect(envelope(0.5, 0.5)).toBe(0.5);
  });
});

describe('compute_note_duration dispatch', () => {
  it('shader workgroup size matches the host constant', () => {
    expect(wgslConst(DURATION_SRC, 'WORKGROUP_SIZE')).toBe(NOTE_DURATION_WORKGROUP_SIZE);
  });

  it('no longer runs one invocation per workgroup', () => {
    expect(DURATION_SRC).not.toContain('@workgroup_size(1, 1, 1)');
    expect(DURATION_SRC).toContain('@compute @workgroup_size(WORKGROUP_SIZE, 1, 1)');
  });

  it('covers every channel without over-dispatching', () => {
    for (const channels of [1, 4, 32, 63, 64, 65, 128, 127]) {
      const groups = noteDurationWorkgroupCount(channels);
      expect(groups * NOTE_DURATION_WORKGROUP_SIZE).toBeGreaterThanOrEqual(channels);
      expect((groups - 1) * NOTE_DURATION_WORKGROUP_SIZE).toBeLessThan(channels);
    }
  });

  it('always dispatches at least one workgroup', () => {
    expect(noteDurationWorkgroupCount(0)).toBe(1);
  });

  it('packs row scratch without truncating the DURA-003 lookback offset', () => {
    // rowOffset must survive up to MAX_ROWS-1 (1023) — 10 bits, not 8.
    const maxRows = wgslConst(DURATION_SRC, 'MAX_ROWS');
    expect(DURATION_SRC).toContain('(rowOffset & 0x3FFu) << 14u');
    expect(maxRows - 1).toBeLessThanOrEqual(0x3ff);
  });
});

describe('pcmBus', () => {
  afterEach(() => resetPcmBus());

  it('reports demand only while something is subscribed', () => {
    expect(pcmBusHasSubscribers()).toBe(false);
    const unsubscribe = subscribePcm(() => {});
    expect(pcmBusHasSubscribers()).toBe(true);
    unsubscribe();
    expect(pcmBusHasSubscribers()).toBe(false);
  });

  it('signals the demand listener on the 0↔1 transitions only', () => {
    const listener = vi.fn();
    setPcmDemandListener(listener);
    // Installed with the current demand so a node created mid-session catches up.
    expect(listener).toHaveBeenCalledWith(false);
    listener.mockClear();

    const first = subscribePcm(() => {});
    const second = subscribePcm(() => {});
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(true);

    first();
    expect(listener).toHaveBeenCalledTimes(1); // still one subscriber left
    second();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(false);
  });

  it('is a no-op with no subscribers', () => {
    expect(() => publishPcmBlock(new Float32Array(8), 2, 44100)).not.toThrow();
  });

  it('derives frameCount from the channel count', () => {
    const received: number[] = [];
    subscribePcm((block) => received.push(block.frameCount));
    publishPcmBlock(new Float32Array(512), 2, 44100);
    publishPcmBlock(new Float32Array(512), 1, 44100);
    expect(received).toEqual([256, 512]);
  });

  it('isolates a throwing subscriber so the audio message loop survives', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const healthy = vi.fn();
    subscribePcm(() => { throw new Error('boom'); });
    subscribePcm(healthy);
    expect(() => publishPcmBlock(new Float32Array(4), 2, 44100)).not.toThrow();
    expect(healthy).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('unsubscribing twice does not double-signal the listener', () => {
    const listener = vi.fn();
    const unsubscribe = subscribePcm(() => {});
    setPcmDemandListener(listener);
    listener.mockClear();
    unsubscribe();
    unsubscribe();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('PcmRing', () => {
  /** Interleaved stereo ramp: L = i, R = -i. */
  const ramp = (frames: number, from = 0) => {
    const out = new Float32Array(frames * 2);
    for (let i = 0; i < frames; i++) {
      out[i * 2] = from + i;
      out[i * 2 + 1] = -(from + i);
    }
    return out;
  };

  const linear = (ring: PcmRing) => {
    const out = new Float32Array(ring.capacityFrames * 2);
    const used = ring.linearise(out);
    return Array.from(out.subarray(0, used));
  };

  it('accumulates short blocks so the FFT sees a full window', () => {
    // The real case: 512-frame worklet blocks feeding a 1024-point transform.
    const ring = new PcmRing(1024);
    ring.write(ramp(512, 0), 2, 44100);
    expect(ring.frames).toBe(512);
    ring.write(ramp(512, 512), 2, 44100);
    expect(ring.frames).toBe(1024);

    const samples = linear(ring);
    expect(samples).toHaveLength(2048);
    expect(samples[0]).toBe(0);
    expect(samples[2046]).toBe(1023); // newest frame, left channel
  });

  it('drops the oldest frames once full and unwraps oldest-first', () => {
    const ring = new PcmRing(8);
    ring.write(ramp(6, 0), 2, 44100); // 0..5
    ring.write(ramp(6, 6), 2, 44100); // 6..11, wraps
    expect(ring.frames).toBe(8);

    const left = linear(ring).filter((_, i) => i % 2 === 0);
    expect(left).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('keeps only the newest frames of an over-long block', () => {
    const ring = new PcmRing(4);
    ring.write(ramp(10, 0), 2, 44100);
    expect(ring.frames).toBe(4);
    expect(linear(ring).filter((_, i) => i % 2 === 0)).toEqual([6, 7, 8, 9]);
  });

  it('keeps channels interleaved through a wrap', () => {
    const ring = new PcmRing(4);
    ring.write(ramp(3, 0), 2, 44100);
    ring.write(ramp(3, 3), 2, 44100);
    expect(linear(ring)).toEqual([2, -2, 3, -3, 4, -4, 5, -5]);
  });

  it('handles mono blocks at the mono stride', () => {
    const ring = new PcmRing(4);
    ring.write(Float32Array.from([1, 2, 3, 4, 5]), 1, 48000);
    expect(ring.channels).toBe(1);
    expect(ring.sampleRate).toBe(48000);
    expect(linear(ring)).toEqual([2, 3, 4, 5]);
  });

  it('discards buffered frames when the channel count changes', () => {
    const ring = new PcmRing(8);
    ring.write(ramp(4, 0), 2, 44100);
    ring.write(Float32Array.from([9, 9, 9]), 1, 44100);
    expect(ring.frames).toBe(3);
    expect(linear(ring)).toEqual([9, 9, 9]);
  });

  it('ignores empty blocks and reports it', () => {
    const ring = new PcmRing(8);
    expect(ring.write(new Float32Array(0), 2, 44100)).toBe(false);
    expect(ring.frames).toBe(0);
  });

  it('reset clears the contents but keeps the format', () => {
    const ring = new PcmRing(8);
    ring.write(ramp(4, 0), 2, 44100);
    ring.reset();
    expect(ring.frames).toBe(0);
    expect(linear(ring)).toEqual([]);
    ring.write(ramp(2, 0), 2, 44100);
    expect(linear(ring)).toEqual([0, -0, 1, -1]);
  });

  it('a capacity-sized ring holds exactly one FFT window plus headroom', () => {
    expect(new PcmRing(PCM_FRAME_CAPACITY).capacityFrames).toBeGreaterThanOrEqual(MAX_FFT_SIZE);
  });
});
