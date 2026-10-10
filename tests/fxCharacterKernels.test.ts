/**
 * DSP kernels of the FX rack's character stage (#453), tested directly in TS
 * at both rates the app renders at (48 kHz live, 44.1 kHz export).
 */
import { describe, expect, it } from 'vitest';
import {
  A500_RC_CUTOFF_HZ,
  CHARACTER_LATENCY_FRAMES,
  CHARACTER_PARAM_COUNT,
  CHARACTER_PARAM_DESCRIPTORS,
  CHARACTER_PARAM_NAMES,
  LED_CUTOFF_HZ,
  characterParamArray,
  type CharacterParamValues,
} from '../audio-worklet/fxCharacterParams';
import { CharacterChannel } from '../audio-worklet/js/fx/characterChannel';
import { Crusher, quantizerStep } from '../audio-worklet/js/fx/crusher';
import { LinearSwitch } from '../audio-worklet/js/fx/smoothing';
import { BiquadLowpass, OnePoleLowpass } from '../audio-worklet/js/fx/filters';
import {
  HALFBAND_CENTER,
  HalfbandDownsampler,
  HalfbandUpsampler,
  designHalfband,
} from '../audio-worklet/js/fx/halfband';
import { SaturatorCurve, driveToK, saturate } from '../audio-worklet/js/fx/saturator';

const RATES = [44100, 48000] as const;
const db = (m: number) => 20 * Math.log10(m);

function render(
  sampleRate: number,
  params: Partial<CharacterParamValues>,
  input: Float32Array,
  blockSize = input.length,
): Float32Array {
  const ch = new CharacterChannel(sampleRate, characterParamArray(params));
  const out = new Float32Array(input.length);
  for (let off = 0; off < input.length; off += blockSize) {
    const n = Math.min(blockSize, input.length - off);
    ch.process(input.subarray(off, off + n), out.subarray(off, off + n), n);
    ch.flushDenormals();
  }
  return out;
}

/** Magnitude of the DFT of `x` at an exact frequency (Hz). */
function dtftMag(x: Float32Array, hz: number, sampleRate: number): number {
  let re = 0;
  let im = 0;
  for (let n = 0; n < x.length; n++) {
    const a = (2 * Math.PI * hz * n) / sampleRate;
    re += x[n]! * Math.cos(a);
    im -= x[n]! * Math.sin(a);
  }
  return Math.hypot(re, im);
}

/** Power at DFT bin `bin` of an N-periodic signal. */
function binPower(x: ArrayLike<number>, bin: number): number {
  const n = x.length;
  let re = 0;
  let im = 0;
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * bin * i) / n;
    re += x[i]! * Math.cos(a);
    im -= x[i]! * Math.sin(a);
  }
  return re * re + im * im;
}

describe('character params contract', () => {
  it('descriptor order matches the index layout', () => {
    expect(CHARACTER_PARAM_DESCRIPTORS.map((d) => d.name)).toEqual([...CHARACTER_PARAM_NAMES]);
    expect(CHARACTER_PARAM_DESCRIPTORS).toHaveLength(CHARACTER_PARAM_COUNT);
    for (const d of CHARACTER_PARAM_DESCRIPTORS) {
      expect(d.automationRate).toBe('k-rate');
      expect(d.defaultValue).toBeGreaterThanOrEqual(d.minValue);
      expect(d.defaultValue).toBeLessThanOrEqual(d.maxValue);
    }
    const packed = characterParamArray({ drive: 0.75 });
    expect(packed[1]).toBe(0.75);
    expect(packed[6]).toBe(11025);
  });
});

describe('halfband ×2', () => {
  it('is a 47-tap halfband with exactly unity DC gain per polyphase branch', () => {
    const h = designHalfband();
    expect(h).toHaveLength(47);
    expect(h[HALFBAND_CENTER]).toBe(0.5);
    let even = 0;
    for (let k = 0; k < h.length; k++) {
      const n = k - HALFBAND_CENTER;
      if (n !== 0 && n % 2 === 0) expect(h[k]).toBe(0);
      if (k % 2 === 0) even += h[k]!;
      expect(h[k]).toBeCloseTo(h[h.length - 1 - k]!, 15); // linear phase
    }
    expect(even).toBeCloseTo(0.5, 14);
  });

  it('up → down passes DC at unity after the 23-frame latency', () => {
    const up = new HalfbandUpsampler();
    const down = new HalfbandDownsampler();
    const src = new Float64Array(200).fill(1);
    const over = new Float64Array(400);
    const out = new Float64Array(200);
    up.processBlock(src, over, 200);
    down.processBlock(over, out, 200);
    expect(Math.abs(out[0]!)).toBeLessThan(1e-6); // only the window-edge tap so far
    expect(out[199]).toBeCloseTo(1, 12);
  });

  it('block kernels are invariant to how a stream is split into blocks', () => {
    const src = Float64Array.from({ length: 300 }, (_, i) => Math.sin(i * 0.7));
    const whole = new Float64Array(300);
    {
      const up = new HalfbandUpsampler();
      const down = new HalfbandDownsampler();
      const over = new Float64Array(600);
      up.processBlock(src, over, 300);
      down.processBlock(over, whole, 300);
    }
    const split = new Float64Array(300);
    const up = new HalfbandUpsampler();
    const down = new HalfbandDownsampler();
    for (let off = 0; off < 300; off += 7) {
      const n = Math.min(7, 300 - off);
      const over = new Float64Array(2 * n);
      const out = new Float64Array(n);
      up.processBlock(src.subarray(off, off + n), over, n);
      down.processBlock(over, out, n);
      split.set(out, off);
    }
    expect(split).toEqual(whole);
  });

  for (const sr of RATES) {
    it(`all-off chain is a linear-phase ${CHARACTER_LATENCY_FRAMES}-frame delay, flat to 0.36·fs (${sr} Hz)`, () => {
      const impulse = new Float32Array(512);
      impulse[0] = 1;
      const out = render(sr, {}, impulse);
      let peakAt = 0;
      for (let i = 0; i < out.length; i++) if (Math.abs(out[i]!) > Math.abs(out[peakAt]!)) peakAt = i;
      expect(peakAt).toBe(CHARACTER_LATENCY_FRAMES);
      for (let j = 1; j <= CHARACTER_LATENCY_FRAMES; j++) {
        expect(out[CHARACTER_LATENCY_FRAMES - j]).toBe(out[CHARACTER_LATENCY_FRAMES + j]);
      }
      expect(out[2 * CHARACTER_LATENCY_FRAMES + 1]).toBe(0);
      for (let hz = 20; hz <= 0.36 * sr; hz += 97) {
        expect(Math.abs(db(dtftMag(out, hz, sr)))).toBeLessThan(0.01);
      }
      expect(db(dtftMag(out, 0.45 * sr, sr))).toBeLessThan(-1);
    });
  }
});

describe('Amiga filters', () => {
  for (const sr of RATES) {
    it(`LED filter is a Butterworth with −3.01 dB at ${LED_CUTOFF_HZ} Hz (${sr} Hz)`, () => {
      const led = new BiquadLowpass();
      led.setLowpass(LED_CUTOFF_HZ, Math.SQRT1_2, sr);
      expect(db(led.magnitudeAt(LED_CUTOFF_HZ, sr))).toBeCloseTo(-3.0103, 3);
      expect(db(led.magnitudeAt(100, sr))).toBeGreaterThan(-0.001);
      // 2nd order: ≥ 12 dB/oct (bilinear warping makes it steeper toward Nyquist).
      const slope = db(led.magnitudeAt(4 * LED_CUTOFF_HZ, sr)) - db(led.magnitudeAt(2 * LED_CUTOFF_HZ, sr));
      expect(slope).toBeLessThan(-11);
    });

    it(`A500 RC filter is −3.01 dB at ${A500_RC_CUTOFF_HZ} Hz, 6 dB/oct (${sr} Hz)`, () => {
      const rc = new OnePoleLowpass();
      rc.setLowpass(A500_RC_CUTOFF_HZ, sr);
      expect(db(rc.magnitudeAt(A500_RC_CUTOFF_HZ, sr))).toBeCloseTo(-3.0103, 3);
      expect(db(rc.magnitudeAt(50, sr))).toBeGreaterThan(-0.001);
    });
  }

  it('the A500 model adds its RC filter in front of the LED filter; A1200 does not', () => {
    const sr = 48000;
    const tone = new Float32Array(sr / 4);
    for (let i = 0; i < tone.length; i++) tone[i] = 0.5 * Math.sin((2 * Math.PI * 4000 * i) / sr);
    const rms = (x: Float32Array) => Math.sqrt(x.subarray(2000).reduce((s, v) => s + v * v, 0) / (x.length - 2000));
    const a500 = rms(render(sr, { ledOn: 1, ledModel: 0 }, tone));
    const a1200 = rms(render(sr, { ledOn: 1, ledModel: 1 }, tone));
    const off = rms(render(sr, { ledOn: 0, ledModel: 0 }, tone));
    expect(a500).toBeLessThan(a1200);
    expect(a1200).toBeLessThan(off);
  });
});

describe('crusher', () => {
  /** Run the crusher fully switched in over `input`. */
  function crush(c: Crusher, input: Float64Array): Float64Array {
    const buf = Float64Array.from(input);
    c.processBlock(buf, buf.length, new LinearSwitch(1, 0.01, 48000));
    return buf;
  }
  const ramp = (n: number) => Float64Array.from({ length: n }, (_, i) => i + 1);

  it('quantizes to a 2^(1−bits) grid (8 bits → k/128)', () => {
    expect(quantizerStep(8)).toBe(1 / 128);
    const c = new Crusher(48000);
    c.configure(48000, 8);
    const out = crush(c, Float64Array.from({ length: 1000 }, (_, i) => Math.sin(i * 0.37) * 0.9));
    for (const y of out) expect(Number.isInteger(y * 128)).toBe(true);
  });

  it('holds for exactly fs/rate samples at integer ratios', () => {
    const c = new Crusher(48000);
    c.configure(4000, 16);
    const out = crush(c, ramp(1200));
    const runs: number[] = [];
    let run = 1;
    for (let i = 1; i < out.length; i++) {
      if (out[i] !== out[i - 1]) {
        runs.push(run);
        run = 0;
      }
      run++;
    }
    expect(new Set(runs)).toEqual(new Set([12]));
  });

  it('averages fs/rate at non-integer ratios', () => {
    const c = new Crusher(44100);
    c.configure(11025.5, 16);
    const out = crush(c, ramp(441000));
    let changes = 1;
    for (let i = 1; i < out.length; i++) if (out[i] !== out[i - 1]) changes++;
    expect(out.length / changes).toBeCloseTo(44100 / 11025.5, 2);
  });
});

describe('tape saturation', () => {
  it('maps 0 → 0 and keeps full-scale input within ±1 at any drive', () => {
    for (const drive of [0, 0.5, 1]) {
      for (const bias of [0, 0.1, 0.5]) {
        const curve = new SaturatorCurve(driveToK(drive), bias);
        expect(saturate(curve, 0)).toBeCloseTo(0, 15);
        expect(Math.max(Math.abs(saturate(curve, 1)), Math.abs(saturate(curve, -1)))).toBeCloseTo(1, 12);
      }
    }
  });

  it('the channel\'s inlined drive mapping matches driveToK', () => {
    // setTargets inlines driveToK (a double-returning call may allocate); keep them in step.
    const ch = new CharacterChannel(48000, characterParamArray({ drive: 0.37 }));
    expect((ch as unknown as { k: { target: number } }).k.target).toBe(driveToK(0.37));
  });

  it('is nearly transparent at zero drive (+0.12 dB small-signal at the default bias)', () => {
    const curve = new SaturatorCurve(driveToK(0), 0.1);
    const gain = saturate(curve, 1e-4) / 1e-4;
    expect(db(gain)).toBeGreaterThan(0);
    expect(db(gain)).toBeLessThan(0.2);
  });

  // ×2 oversampling only removes harmonics that land between fs/2 and fs;
  // higher ones still fold inside the 2·fs domain, so the gain depends on the
  // tone. Thresholds are measured values minus ~2 dB of margin.
  const N = 16384;
  const SR = 48000;
  const cases = [
    { bin: 1709, drive: 0.6, amp: 0.6, maxDbc: -60, minGainDb: 8 }, // 5007 Hz: OS −63.7, naive −53.0
    { bin: 1709, drive: 1, amp: 0.6, maxDbc: -36, minGainDb: 8 }, //   5007 Hz: OS −38.8, naive −26.6
    { bin: 2731, drive: 1, amp: 0.6, maxDbc: -19, minGainDb: 4 }, //   8001 Hz: OS −21.1, naive −14.3
  ];
  for (const c of cases) {
    it(`×2 oversampling suppresses aliasing (f0 ${((c.bin * SR) / N).toFixed(0)} Hz, drive ${c.drive})`, () => {
      const total = N * 4;
      const input = new Float32Array(total);
      for (let i = 0; i < total; i++) input[i] = c.amp * Math.sin((2 * Math.PI * c.bin * i) / N);
      const os = render(SR, { tapeOn: 1, drive: c.drive, bias: 0.1 }, input).subarray(total - N);
      const curve = new SaturatorCurve(driveToK(c.drive), 0.1);
      const naive = new Float64Array(N);
      for (let i = 0; i < N; i++) naive[i] = saturate(curve, input[total - N + i]!);

      let aliasOs = 0;
      let aliasNaive = 0;
      const seen = new Set<number>();
      for (let m = 2; m <= 80; m++) {
        const harmonic = m * c.bin;
        if (harmonic < N / 2) continue; // a real harmonic, not an alias
        let folded = harmonic % N;
        if (folded > N / 2) folded = N - folded;
        if (seen.has(folded)) continue;
        seen.add(folded);
        aliasOs += binPower(os, folded);
        aliasNaive += binPower(naive, folded);
      }
      const osDbc = 10 * Math.log10(aliasOs / binPower(os, c.bin));
      const naiveDbc = 10 * Math.log10(aliasNaive / binPower(naive, c.bin));
      expect(osDbc).toBeLessThan(c.maxDbc);
      expect(naiveDbc - osDbc).toBeGreaterThan(c.minGainDb);
    });
  }
});

describe('character channel', () => {
  const sr = 48000;
  const noise = (n: number, seed = 1) => {
    const out = new Float32Array(n);
    let s = seed;
    for (let i = 0; i < n; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      out[i] = (s / 0xffffffff - 0.5) * 1.6;
    }
    return out;
  };
  const allOn: Partial<CharacterParamValues> = { tapeOn: 1, drive: 0.8, ledOn: 1, crushOn: 1, crushRate: 8000, crushBits: 6 };

  it('is bit-identical at any block size when params are constant', () => {
    const input = noise(8192);
    const ref = render(sr, allOn, input, 128);
    for (const block of [37, 1024, 2048, 8192]) {
      expect(render(sr, allOn, input, block)).toEqual(ref);
    }
  });

  it('decays to exact zeros after an impulse (denormals flushed)', () => {
    const input = new Float32Array(1 << 17);
    input[0] = 1;
    const out = render(sr, { ...allOn, crushOn: 0 }, input, 128);
    for (let i = out.length - 1024; i < out.length; i++) expect(out[i]).toBe(0);
  });

  it('stays finite with extreme params and ±4 input', () => {
    const input = noise(4096).map((v) => v * 5);
    for (const params of [
      { tapeOn: 1, drive: 1, bias: 0.5, outputGain: 12 },
      { crushOn: 1, crushRate: 1000, crushBits: 2 },
      { ledOn: 1, ledModel: 0, tapeOn: 1, drive: 1 },
    ]) {
      for (const v of render(sr, params, input)) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('toggling a sub-stage crossfades over 10 ms instead of stepping', () => {
    const ch = new CharacterChannel(sr, characterParamArray());
    const block = 480; // 10 ms
    const dc = new Float32Array(block).fill(0.3); // 2 bits (step 0.5) quantizes 0.3 → 0.5
    const out = new Float32Array(block);
    for (let i = 0; i < 20; i++) ch.process(dc, out, block); // settle at 0.3
    expect(out[block - 1]).toBeCloseTo(0.3, 6);
    ch.setTargets(characterParamArray({ crushOn: 1, crushRate: 48000, crushBits: 2 }));
    const fade = new Float32Array(block * 2);
    ch.process(dc, fade.subarray(0, block), block);
    ch.process(dc, fade.subarray(block), block);
    let maxStep = 0;
    for (let i = 1; i < fade.length; i++) maxStep = Math.max(maxStep, Math.abs(fade[i]! - fade[i - 1]!));
    expect(fade[fade.length - 1]).toBeCloseTo(0.5, 6); // the full 0.2 move happened…
    expect(maxStep).toBeLessThan(0.002); //               …as a ramp, not a 0.2 step
  });
});
