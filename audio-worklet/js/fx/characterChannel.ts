/**
 * One channel of the FX rack's character stage (#453):
 *
 *   crush → Amiga RC (A500) → LED 2-pole → ×2 up → tape (tanh + DC block) → ×2 down → trim
 *
 * Every sub-stage runs all the time and is blended in with a 10 ms linear
 * switch, so toggling a sub-stage is a crossfade between two warm signals, CPU
 * is constant, and latency (CHARACTER_LATENCY_FRAMES) never changes.
 *
 * Processing is staged: each stage is one tight loop over a block in
 * preallocated Float64 scratch (chunks of CHARACTER_MAX_BLOCK frames, so any
 * render quantum size works), with its state copied into locals, the
 * recursions / switches / smoothers advanced inline, and the state written back
 * once per block. No per-sample call passes or returns a double: such a call is
 * free only while TurboFan inlines it, and otherwise boxes the double — an
 * allocation on the audio thread (seen while params glide, e.g. a knob drag).
 */
import {
  A500_RC_CUTOFF_HZ,
  CHARACTER_SMOOTH_SECONDS,
  CHARACTER_SWITCH_SECONDS,
  LED_CUTOFF_HZ,
  LED_MODEL_A500,
  P_BIAS,
  P_CRUSH_BITS,
  P_CRUSH_ON,
  P_CRUSH_RATE,
  P_DRIVE,
  P_LED_MODEL,
  P_LED_ON,
  P_OUTPUT_GAIN,
  P_TAPE_ON,
  TAPE_DC_BLOCK_HZ,
} from '../../fxCharacterParams';
import { Crusher } from './crusher';
import { BiquadLowpass, OnePoleLowpass } from './filters';
import { HalfbandDownsampler, HalfbandUpsampler } from './halfband';
import { LinearSwitch, OnePoleSmoother } from './smoothing';
import { DRIVE_RANGE_DB, DcBlocker, K_AT_ZERO_DRIVE, SaturatorCurve, driveToK } from './saturator';

const BUTTERWORTH_Q = Math.SQRT1_2;

/** Largest chunk the scratch buffers hold; longer quanta are processed in chunks. */
export const CHARACTER_MAX_BLOCK = 1024;

function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export class CharacterChannel {
  private readonly crusher: Crusher;
  private readonly rc = new OnePoleLowpass();
  private readonly led = new BiquadLowpass();
  private readonly up = new HalfbandUpsampler();
  private readonly down = new HalfbandDownsampler();
  private readonly dc = new DcBlocker();
  private readonly curve: SaturatorCurve;

  private readonly crushMix: LinearSwitch;
  private readonly rcMix: LinearSwitch;
  private readonly ledMix: LinearSwitch;
  private readonly tapeMix: LinearSwitch;
  private readonly k: OnePoleSmoother;
  private readonly bias: OnePoleSmoother;
  private readonly gain: OnePoleSmoother;

  private crushRate = Number.NaN;
  private crushBits = Number.NaN;

  /** Base-rate scratch (input → crush → Amiga → … → downsampled output). */
  private readonly base = new Float64Array(CHARACTER_MAX_BLOCK);
  /** 2·fs scratch between the resamplers. */
  private readonly over = new Float64Array(2 * CHARACTER_MAX_BLOCK);

  /** `initial` uses the fxCharacterParams index layout (see characterParamArray). */
  constructor(sampleRate: number, initial: ArrayLike<number>) {
    this.crusher = new Crusher(sampleRate);
    this.rc.setLowpass(A500_RC_CUTOFF_HZ, sampleRate);
    this.led.setLowpass(LED_CUTOFF_HZ, BUTTERWORTH_Q, sampleRate);
    this.dc.setCutoff(TAPE_DC_BLOCK_HZ, sampleRate * 2);

    this.crushMix = new LinearSwitch(0, CHARACTER_SWITCH_SECONDS, sampleRate);
    this.rcMix = new LinearSwitch(0, CHARACTER_SWITCH_SECONDS, sampleRate);
    this.ledMix = new LinearSwitch(0, CHARACTER_SWITCH_SECONDS, sampleRate);
    this.tapeMix = new LinearSwitch(0, CHARACTER_SWITCH_SECONDS, sampleRate);
    this.k = new OnePoleSmoother(driveToK(initial[P_DRIVE]!), CHARACTER_SMOOTH_SECONDS, sampleRate);
    this.bias = new OnePoleSmoother(initial[P_BIAS]!, CHARACTER_SMOOTH_SECONDS, sampleRate);
    this.gain = new OnePoleSmoother(dbToGain(initial[P_OUTPUT_GAIN]!), CHARACTER_SMOOTH_SECONDS, sampleRate);
    this.curve = new SaturatorCurve(this.k.value, this.bias.value);

    this.setTargets(initial);
    this.snap();
  }

  /** Point every switch / smoother at the current params (they glide there). */
  setTargets(p: ArrayLike<number>): void {
    // @noalloc:begin
    this.crushMix.target = p[P_CRUSH_ON]! >= 0.5 ? 1 : 0;
    // The A500's fixed RC output filter sits in front of its LED filter.
    this.rcMix.target = Math.round(p[P_LED_MODEL]!) === LED_MODEL_A500 ? 1 : 0;
    this.ledMix.target = p[P_LED_ON]! >= 0.5 ? 1 : 0;
    this.tapeMix.target = p[P_TAPE_ON]! >= 0.5 ? 1 : 0;
    // driveToK / dbToGain, inlined: a call returning a double may box it.
    this.k.target = K_AT_ZERO_DRIVE * Math.pow(10, (DRIVE_RANGE_DB * p[P_DRIVE]!) / 20);
    this.bias.target = p[P_BIAS]!;
    this.gain.target = Math.pow(10, p[P_OUTPUT_GAIN]! / 20);
    if (p[P_CRUSH_RATE]! !== this.crushRate || p[P_CRUSH_BITS]! !== this.crushBits) {
      this.crushRate = p[P_CRUSH_RATE]!;
      this.crushBits = p[P_CRUSH_BITS]!;
      this.crusher.configureFrom(p);
    }
    // @noalloc:end
  }

  /** Jump every switch / smoother to its target (initial state, after a reset). */
  snap(): void {
    this.crushMix.snap();
    this.rcMix.snap();
    this.ledMix.snap();
    this.tapeMix.snap();
    this.k.snap();
    this.bias.snap();
    this.gain.snap();
    this.curve.update(this.k.value, this.bias.value);
  }

  /** Zero all signal state (filters, resampler rings, hold). Params are kept. */
  reset(): void {
    this.crusher.reset();
    this.rc.reset();
    this.led.reset();
    this.up.reset();
    this.down.reset();
    this.dc.reset();
  }

  /** Render `frames` samples; a null input is silence (lets tails ring out). */
  process(input: Float32Array | null, output: Float32Array, frames: number): void {
    // @noalloc:begin
    for (let off = 0; off < frames; off += CHARACTER_MAX_BLOCK) {
      const n = frames - off < CHARACTER_MAX_BLOCK ? frames - off : CHARACTER_MAX_BLOCK;
      this.loadInput(input, off, n);
      this.crusher.processBlock(this.base, n, this.crushMix);
      this.amigaStage(n);
      this.up.processBlock(this.base, this.over, n);
      this.tapeStage(n);
      this.down.processBlock(this.over, this.base, n);
      this.writeOutput(output, off, n);
    }
    // @noalloc:end
  }

  private loadInput(input: Float32Array | null, off: number, n: number): void {
    // @noalloc:begin
    const a = this.base;
    if (input === null) {
      for (let i = 0; i < n; i++) a[i] = 0;
    } else {
      for (let i = 0; i < n; i++) a[i] = input[off + i]!;
    }
    // @noalloc:end
  }

  /** RC (A500 only, switched) into the LED biquad (switched), in place. */
  private amigaStage(n: number): void {
    // @noalloc:begin
    const a = this.base;
    const rc = this.rc;
    const led = this.led;
    const rcB = rc.b;
    const rcA1 = rc.a1;
    let rcX1 = rc.x1;
    let rcY1 = rc.y1;
    const b0 = led.b0;
    const b1 = led.b1;
    const b2 = led.b2;
    const a1 = led.a1;
    const a2 = led.a2;
    let z1 = led.z1;
    let z2 = led.z2;
    let rm = this.rcMix.value;
    const rt = this.rcMix.target;
    const rs = this.rcMix.step;
    let lm = this.ledMix.value;
    const lt = this.ledMix.target;
    const ls = this.ledMix.step;
    for (let i = 0; i < n; i++) {
      const x = a[i]!;
      const rcOut = rcB * (x + rcX1) - rcA1 * rcY1;
      rcX1 = x;
      rcY1 = rcOut;
      if (rm !== rt) rm = rm < rt ? (rm + rs > rt ? rt : rm + rs) : rm - rs < rt ? rt : rm - rs;
      const ledIn = x + rm * (rcOut - x);
      const ledOut = b0 * ledIn + z1;
      z1 = b1 * ledIn - a1 * ledOut + z2;
      z2 = b2 * ledIn - a2 * ledOut;
      if (lm !== lt) lm = lm < lt ? (lm + ls > lt ? lt : lm + ls) : lm - ls < lt ? lt : lm - ls;
      a[i] = x + lm * (ledOut - x);
    }
    rc.x1 = rcX1;
    rc.y1 = rcY1;
    led.z1 = z1;
    led.z2 = z2;
    this.rcMix.value = rm;
    this.ledMix.value = lm;
    // @noalloc:end
  }

  /** At 2·fs; the switch and the drive/bias glide advance once per base-rate frame. */
  private tapeStage(n: number): void {
    // @noalloc:begin
    const b = this.over;
    const curve = this.curve;
    const dc = this.dc;
    const r = dc.r;
    let x1 = dc.x1;
    let y1 = dc.y1;
    let k = curve.k;
    let bias = curve.b;
    let offset = curve.offset;
    let invNorm = curve.invNorm;
    const ks = this.k;
    const bs = this.bias;
    let kv = ks.value;
    const kt = ks.target;
    const kc = ks.coeff;
    const ke = ks.epsilon;
    let bv = bs.value;
    const bt = bs.target;
    const bc = bs.coeff;
    const be = bs.epsilon;
    let m = this.tapeMix.value;
    const mt = this.tapeMix.target;
    const ms = this.tapeMix.step;
    for (let i = 0; i < n; i++) {
      if (kv !== kt || bv !== bt) {
        if (kv !== kt) {
          kv = kt + (kv - kt) * kc;
          if (Math.abs(kv - kt) < ke) kv = kt;
        }
        if (bv !== bt) {
          bv = bt + (bv - bt) * bc;
          if (Math.abs(bv - bt) < be) bv = bt;
        }
        k = kv;
        bias = bv;
        offset = Math.tanh(k * bias);
        const pos = Math.tanh(k * (1 + bias)) - offset;
        const neg = offset - Math.tanh(k * (bias - 1));
        const norm = pos > neg ? pos : neg;
        invNorm = norm > 0 ? 1 / norm : 1;
      }
      if (m !== mt) m = m < mt ? (m + ms > mt ? mt : m + ms) : m - ms < mt ? mt : m - ms;

      const even = b[2 * i]!;
      const satEven = (Math.tanh(k * (even + bias)) - offset) * invNorm;
      const dcEven = satEven - x1 + r * y1;
      x1 = satEven;
      y1 = dcEven;
      b[2 * i] = even + m * (dcEven - even);

      const odd = b[2 * i + 1]!;
      const satOdd = (Math.tanh(k * (odd + bias)) - offset) * invNorm;
      const dcOdd = satOdd - x1 + r * y1;
      x1 = satOdd;
      y1 = dcOdd;
      b[2 * i + 1] = odd + m * (dcOdd - odd);
    }
    dc.x1 = x1;
    dc.y1 = y1;
    curve.k = k;
    curve.b = bias;
    curve.offset = offset;
    curve.invNorm = invNorm;
    ks.value = kv;
    bs.value = bv;
    this.tapeMix.value = m;
    // @noalloc:end
  }

  private writeOutput(output: Float32Array, off: number, n: number): void {
    // @noalloc:begin
    const a = this.base;
    const gs = this.gain;
    let g = gs.value;
    const gt = gs.target;
    const gc = gs.coeff;
    const ge = gs.epsilon;
    for (let i = 0; i < n; i++) {
      if (g !== gt) {
        g = gt + (g - gt) * gc;
        if (Math.abs(g - gt) < ge) g = gt;
      }
      output[off + i] = a[i]! * g;
    }
    gs.value = g;
    // @noalloc:end
  }

  /** Once per block: subnormal state costs 10–100× on x86. */
  flushDenormals(): void {
    this.rc.flushDenormals();
    this.led.flushDenormals();
    this.dc.flushDenormals();
  }
}
