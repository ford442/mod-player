// generated — do not edit.
// Source: audio-worklet/js/fx-character-processor.ts
// Regenerate with: npm run build:js-worklet
"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // audio-worklet/fxCharacterParams.ts
  var CHARACTER_PROCESSOR_NAME = "xasm-fx-character";
  var LED_MODEL_A500 = 0;
  var CHARACTER_PARAM_DESCRIPTORS = [
    /** Tape saturation stage on (≥ 0.5) / off. */
    { name: "tapeOn", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
    /** 0…1 → 0…+24 dB into the saturator. */
    { name: "drive", defaultValue: 0.3, minValue: 0, maxValue: 1, automationRate: "k-rate" },
    /** Saturator asymmetry (even harmonics). */
    { name: "bias", defaultValue: 0.1, minValue: 0, maxValue: 0.5, automationRate: "k-rate" },
    /** Amiga LED filter on (≥ 0.5) / off — like Paula's E0x toggle. */
    { name: "ledOn", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
    /** LED_MODEL_A500 (0) or LED_MODEL_A1200 (1). */
    { name: "ledModel", defaultValue: LED_MODEL_A500, minValue: 0, maxValue: 1, automationRate: "k-rate" },
    /** Sample-and-hold + bit-depth crush on (≥ 0.5) / off. */
    { name: "crushOn", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
    /** Hold rate in Hz. */
    { name: "crushRate", defaultValue: 11025, minValue: 1e3, maxValue: 48e3, automationRate: "k-rate" },
    /** Quantizer depth in bits (fractional values allowed). */
    { name: "crushBits", defaultValue: 8, minValue: 2, maxValue: 16, automationRate: "k-rate" },
    /** Output trim in dB. */
    { name: "outputGain", defaultValue: 0, minValue: -24, maxValue: 12, automationRate: "k-rate" }
  ];
  var P_TAPE_ON = 0;
  var P_DRIVE = 1;
  var P_BIAS = 2;
  var P_LED_ON = 3;
  var P_LED_MODEL = 4;
  var P_CRUSH_ON = 5;
  var P_CRUSH_RATE = 6;
  var P_CRUSH_BITS = 7;
  var P_OUTPUT_GAIN = 8;
  var CHARACTER_PARAM_COUNT = 9;
  function characterParamArray(values = {}) {
    const out = new Float64Array(CHARACTER_PARAM_COUNT);
    CHARACTER_PARAM_DESCRIPTORS.forEach((d, i) => {
      out[i] = values[d.name] ?? d.defaultValue;
    });
    return out;
  }
  var LED_CUTOFF_HZ = 3275;
  var A500_RC_CUTOFF_HZ = 4420;
  var TAPE_DC_BLOCK_HZ = 10;
  var CHARACTER_SWITCH_SECONDS = 0.01;
  var CHARACTER_SMOOTH_SECONDS = 5e-3;
  var CHARACTER_MSG_RESET = "reset";
  var CHARACTER_MSG_DISPOSE = "dispose";

  // audio-worklet/js/fx/crusher.ts
  function quantizerStep(bits) {
    return Math.pow(2, 1 - bits);
  }
  var Crusher = class {
    constructor(sampleRate2) {
      __publicField(this, "sampleRate", sampleRate2);
      __publicField(this, "phase", 0);
      __publicField(this, "held", 0);
      __publicField(this, "rate", 48e3);
      __publicField(this, "step", 1 / 128);
      /** Next sample starts a fresh hold period (after construction / reset). */
      __publicField(this, "fresh", true);
      this.rate = sampleRate2;
    }
    configure(rateHz, bits) {
      const fs = this.sampleRate;
      this.rate = rateHz < 1 ? 1 : rateHz > fs ? fs : rateHz;
      this.step = quantizerStep(bits);
    }
    /**
     * configure() from the processor's param array (fxCharacterParams layout).
     * Called from process(): no double crosses a call boundary, so nothing is
     * boxed even if this isn't inlined.
     */
    configureFrom(p) {
      const fs = this.sampleRate;
      const rateHz = p[P_CRUSH_RATE];
      this.rate = rateHz < 1 ? 1 : rateHz > fs ? fs : rateHz;
      this.step = Math.pow(2, 1 - p[P_CRUSH_BITS]);
    }
    /** In place: buf[i] ← buf[i] + mix·(crush(buf[i]) − buf[i]). */
    processBlock(buf, n, mix) {
      const rate = this.rate;
      const fs = this.sampleRate;
      const step = this.step;
      let phase = this.phase;
      let held = this.held;
      let fresh = this.fresh;
      let m = mix.value;
      const mt = mix.target;
      const ms = mix.step;
      for (let i = 0; i < n; i++) {
        const x = buf[i];
        if (fresh) {
          fresh = false;
          phase = 0;
          held = Math.round(x / step) * step;
        } else {
          phase += rate;
          if (phase >= fs) {
            phase -= fs;
            held = Math.round(x / step) * step;
          }
        }
        if (m !== mt) m = m < mt ? m + ms > mt ? mt : m + ms : m - ms < mt ? mt : m - ms;
        buf[i] = x + m * (held - x);
      }
      this.phase = phase;
      this.held = held;
      this.fresh = fresh;
      mix.value = m;
    }
    reset() {
      this.fresh = true;
      this.held = 0;
    }
  };

  // audio-worklet/js/fx/filters.ts
  var BiquadLowpass = class {
    constructor() {
      __publicField(this, "b0", 1);
      __publicField(this, "b1", 0);
      __publicField(this, "b2", 0);
      __publicField(this, "a1", 0);
      __publicField(this, "a2", 0);
      __publicField(this, "z1", 0);
      __publicField(this, "z2", 0);
    }
    /** Q = 1/√2 gives a Butterworth response. */
    setLowpass(cutoffHz, q, sampleRate2) {
      const w0 = 2 * Math.PI * Math.min(cutoffHz, sampleRate2 * 0.49) / sampleRate2;
      const cos = Math.cos(w0);
      const alpha = Math.sin(w0) / (2 * q);
      const a0 = 1 + alpha;
      this.b0 = (1 - cos) / 2 / a0;
      this.b1 = (1 - cos) / a0;
      this.b2 = this.b0;
      this.a1 = -2 * cos / a0;
      this.a2 = (1 - alpha) / a0;
    }
    /** |H(e^{jω})| at `hz`. */
    magnitudeAt(hz, sampleRate2) {
      const w = 2 * Math.PI * hz / sampleRate2;
      const nr = this.b0 + this.b1 * Math.cos(w) + this.b2 * Math.cos(2 * w);
      const ni = -(this.b1 * Math.sin(w) + this.b2 * Math.sin(2 * w));
      const dr = 1 + this.a1 * Math.cos(w) + this.a2 * Math.cos(2 * w);
      const di = -(this.a1 * Math.sin(w) + this.a2 * Math.sin(2 * w));
      return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
    }
    flushDenormals() {
      if (Math.abs(this.z1) < 1e-25) this.z1 = 0;
      if (Math.abs(this.z2) < 1e-25) this.z2 = 0;
    }
    reset() {
      this.z1 = 0;
      this.z2 = 0;
    }
  };
  var OnePoleLowpass = class {
    constructor() {
      __publicField(this, "b", 1);
      __publicField(this, "a1", 0);
      __publicField(this, "x1", 0);
      __publicField(this, "y1", 0);
    }
    setLowpass(cutoffHz, sampleRate2) {
      const k = Math.tan(Math.PI * Math.min(cutoffHz, sampleRate2 * 0.49) / sampleRate2);
      this.b = k / (1 + k);
      this.a1 = (k - 1) / (k + 1);
    }
    magnitudeAt(hz, sampleRate2) {
      const w = 2 * Math.PI * hz / sampleRate2;
      const nr = this.b * (1 + Math.cos(w));
      const ni = -this.b * Math.sin(w);
      const dr = 1 + this.a1 * Math.cos(w);
      const di = -this.a1 * Math.sin(w);
      return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
    }
    flushDenormals() {
      if (Math.abs(this.x1) < 1e-25) this.x1 = 0;
      if (Math.abs(this.y1) < 1e-25) this.y1 = 0;
    }
    reset() {
      this.x1 = 0;
      this.y1 = 0;
    }
  };

  // audio-worklet/js/fx/halfband.ts
  var HALFBAND_TAPS = 47;
  var HALFBAND_CENTER = 23;
  var HALFBAND_PHASE_TAPS = 24;
  var KAISER_BETA = 8;
  function besselI0(x) {
    let sum = 1;
    let term = 1;
    const q = x * x / 4;
    for (let k = 1; k < 64; k++) {
      term *= q / (k * k);
      sum += term;
      if (term < sum * 1e-17) break;
    }
    return sum;
  }
  function designHalfband() {
    const h = new Float64Array(HALFBAND_TAPS);
    const i0Beta = besselI0(KAISER_BETA);
    const half = (HALFBAND_TAPS - 1) / 2;
    for (let k = 0; k < HALFBAND_TAPS; k++) {
      const n = k - HALFBAND_CENTER;
      if (n === 0) {
        h[k] = 0.5;
        continue;
      }
      if (n % 2 === 0) {
        h[k] = 0;
        continue;
      }
      const sinc = Math.sin(Math.PI * n / 2) / (Math.PI * n / 2);
      const r = n / half;
      const w = besselI0(KAISER_BETA * Math.sqrt(1 - r * r)) / i0Beta;
      h[k] = 0.5 * sinc * w;
    }
    let side = 0;
    for (let k = 0; k < HALFBAND_TAPS; k += 2) side += h[k];
    const scale = 0.5 / side;
    for (let k = 0; k < HALFBAND_TAPS; k += 2) h[k] = h[k] * scale;
    return h;
  }
  function halfbandPhaseTaps(h = designHalfband()) {
    const taps = new Float64Array(HALFBAND_PHASE_TAPS);
    for (let j = 0; j < HALFBAND_PHASE_TAPS; j++) taps[j] = h[2 * j];
    return taps;
  }
  var SHARED_TAPS = halfbandPhaseTaps();
  var MirrorRing = class {
    constructor(size) {
      __publicField(this, "size", size);
      __publicField(this, "buf");
      __publicField(this, "pos", 0);
      this.buf = new Float64Array(size * 2);
    }
    clear() {
      this.buf.fill(0);
      this.pos = 0;
    }
  };
  var HalfbandUpsampler = class {
    constructor() {
      __publicField(this, "ring", new MirrorRing(HALFBAND_PHASE_TAPS));
      __publicField(this, "taps", SHARED_TAPS);
    }
    processBlock(src, dst, n) {
      const ring = this.ring;
      const buf = ring.buf;
      const size = ring.size;
      const taps = this.taps;
      let pos = ring.pos;
      for (let i = 0; i < n; i++) {
        const x = src[i];
        pos = pos === 0 ? size - 1 : pos - 1;
        buf[pos] = x;
        buf[pos + size] = x;
        let acc = 0;
        for (let j = 0; j < HALFBAND_PHASE_TAPS; j++) acc += taps[j] * buf[pos + j];
        dst[2 * i] = 2 * acc;
        dst[2 * i + 1] = buf[pos + 11];
      }
      ring.pos = pos;
    }
    reset() {
      this.ring.clear();
    }
  };
  var HalfbandDownsampler = class {
    constructor() {
      __publicField(this, "evenRing", new MirrorRing(HALFBAND_PHASE_TAPS));
      __publicField(this, "oddRing", new MirrorRing(13));
      __publicField(this, "taps", SHARED_TAPS);
    }
    processBlock(src, dst, n) {
      const evenBuf = this.evenRing.buf;
      const evenSize = this.evenRing.size;
      const oddBuf = this.oddRing.buf;
      const oddSize = this.oddRing.size;
      const taps = this.taps;
      let evenPos = this.evenRing.pos;
      let oddPos = this.oddRing.pos;
      for (let i = 0; i < n; i++) {
        const even = src[2 * i];
        const odd = src[2 * i + 1];
        evenPos = evenPos === 0 ? evenSize - 1 : evenPos - 1;
        evenBuf[evenPos] = even;
        evenBuf[evenPos + evenSize] = even;
        oddPos = oddPos === 0 ? oddSize - 1 : oddPos - 1;
        oddBuf[oddPos] = odd;
        oddBuf[oddPos + oddSize] = odd;
        let acc = 0;
        for (let j = 0; j < HALFBAND_PHASE_TAPS; j++) acc += taps[j] * evenBuf[evenPos + j];
        dst[i] = acc + 0.5 * oddBuf[oddPos + 12];
      }
      this.evenRing.pos = evenPos;
      this.oddRing.pos = oddPos;
    }
    reset() {
      this.evenRing.clear();
      this.oddRing.clear();
    }
  };

  // audio-worklet/js/fx/smoothing.ts
  var OnePoleSmoother = class {
    constructor(initial, seconds, sampleRate2, epsilon = 1e-6) {
      __publicField(this, "value", 0);
      __publicField(this, "target", 0);
      __publicField(this, "coeff", 0);
      __publicField(this, "epsilon", 1e-6);
      this.value = initial;
      this.target = initial;
      this.coeff = Math.exp(-1 / (seconds * sampleRate2));
      this.epsilon = epsilon;
    }
    next() {
      if (this.value !== this.target) {
        this.value = this.target + (this.value - this.target) * this.coeff;
        if (Math.abs(this.value - this.target) < this.epsilon) this.value = this.target;
      }
      return this.value;
    }
    snap() {
      this.value = this.target;
    }
  };
  var LinearSwitch = class {
    constructor(initial, seconds, sampleRate2) {
      __publicField(this, "value", 0);
      __publicField(this, "target", 0);
      __publicField(this, "step", 0);
      this.value = initial;
      this.target = initial;
      this.step = 1 / Math.max(1, Math.round(seconds * sampleRate2));
    }
    set(on) {
      this.target = on ? 1 : 0;
    }
    next() {
      const v = this.value;
      const t = this.target;
      if (v !== t) this.value = v < t ? v + this.step > t ? t : v + this.step : v - this.step < t ? t : v - this.step;
      return this.value;
    }
    snap() {
      this.value = this.target;
    }
  };

  // audio-worklet/js/fx/saturator.ts
  var K_AT_ZERO_DRIVE = 0.25;
  var DRIVE_RANGE_DB = 24;
  function driveToK(drive) {
    return K_AT_ZERO_DRIVE * Math.pow(10, DRIVE_RANGE_DB * drive / 20);
  }
  var SaturatorCurve = class {
    constructor(k, b) {
      __publicField(this, "k", 1);
      __publicField(this, "b", 0);
      /** tanh(k·b) */
      __publicField(this, "offset", 0);
      /** 1 / norm */
      __publicField(this, "invNorm", 1);
      this.update(k, b);
    }
    /** Recompute the curve constants (on k / b change, not per sample). */
    update(k, b) {
      const offset = Math.tanh(k * b);
      const pos = Math.tanh(k * (1 + b)) - offset;
      const neg = offset - Math.tanh(k * (b - 1));
      const norm = pos > neg ? pos : neg;
      this.k = k;
      this.b = b;
      this.offset = offset;
      this.invNorm = norm > 0 ? 1 / norm : 1;
    }
  };
  var DcBlocker = class {
    constructor() {
      __publicField(this, "r", 0.999);
      __publicField(this, "x1", 0);
      __publicField(this, "y1", 0);
    }
    setCutoff(hz, sampleRate2) {
      this.r = Math.exp(-2 * Math.PI * hz / sampleRate2);
    }
    flushDenormals() {
      if (Math.abs(this.y1) < 1e-25) this.y1 = 0;
      if (Math.abs(this.x1) < 1e-25) this.x1 = 0;
    }
    reset() {
      this.x1 = 0;
      this.y1 = 0;
    }
  };

  // audio-worklet/js/fx/characterChannel.ts
  var BUTTERWORTH_Q = Math.SQRT1_2;
  var CHARACTER_MAX_BLOCK = 1024;
  function dbToGain(db) {
    return Math.pow(10, db / 20);
  }
  var CharacterChannel = class {
    /** `initial` uses the fxCharacterParams index layout (see characterParamArray). */
    constructor(sampleRate2, initial) {
      __publicField(this, "crusher");
      __publicField(this, "rc", new OnePoleLowpass());
      __publicField(this, "led", new BiquadLowpass());
      __publicField(this, "up", new HalfbandUpsampler());
      __publicField(this, "down", new HalfbandDownsampler());
      __publicField(this, "dc", new DcBlocker());
      __publicField(this, "curve");
      __publicField(this, "crushMix");
      __publicField(this, "rcMix");
      __publicField(this, "ledMix");
      __publicField(this, "tapeMix");
      __publicField(this, "k");
      __publicField(this, "bias");
      __publicField(this, "gain");
      __publicField(this, "crushRate", Number.NaN);
      __publicField(this, "crushBits", Number.NaN);
      /** Base-rate scratch (input → crush → Amiga → … → downsampled output). */
      __publicField(this, "base", new Float64Array(CHARACTER_MAX_BLOCK));
      /** 2·fs scratch between the resamplers. */
      __publicField(this, "over", new Float64Array(2 * CHARACTER_MAX_BLOCK));
      this.crusher = new Crusher(sampleRate2);
      this.rc.setLowpass(A500_RC_CUTOFF_HZ, sampleRate2);
      this.led.setLowpass(LED_CUTOFF_HZ, BUTTERWORTH_Q, sampleRate2);
      this.dc.setCutoff(TAPE_DC_BLOCK_HZ, sampleRate2 * 2);
      this.crushMix = new LinearSwitch(0, CHARACTER_SWITCH_SECONDS, sampleRate2);
      this.rcMix = new LinearSwitch(0, CHARACTER_SWITCH_SECONDS, sampleRate2);
      this.ledMix = new LinearSwitch(0, CHARACTER_SWITCH_SECONDS, sampleRate2);
      this.tapeMix = new LinearSwitch(0, CHARACTER_SWITCH_SECONDS, sampleRate2);
      this.k = new OnePoleSmoother(driveToK(initial[P_DRIVE]), CHARACTER_SMOOTH_SECONDS, sampleRate2);
      this.bias = new OnePoleSmoother(initial[P_BIAS], CHARACTER_SMOOTH_SECONDS, sampleRate2);
      this.gain = new OnePoleSmoother(dbToGain(initial[P_OUTPUT_GAIN]), CHARACTER_SMOOTH_SECONDS, sampleRate2);
      this.curve = new SaturatorCurve(this.k.value, this.bias.value);
      this.setTargets(initial);
      this.snap();
    }
    /** Point every switch / smoother at the current params (they glide there). */
    setTargets(p) {
      this.crushMix.target = p[P_CRUSH_ON] >= 0.5 ? 1 : 0;
      this.rcMix.target = Math.round(p[P_LED_MODEL]) === LED_MODEL_A500 ? 1 : 0;
      this.ledMix.target = p[P_LED_ON] >= 0.5 ? 1 : 0;
      this.tapeMix.target = p[P_TAPE_ON] >= 0.5 ? 1 : 0;
      this.k.target = K_AT_ZERO_DRIVE * Math.pow(10, DRIVE_RANGE_DB * p[P_DRIVE] / 20);
      this.bias.target = p[P_BIAS];
      this.gain.target = Math.pow(10, p[P_OUTPUT_GAIN] / 20);
      if (p[P_CRUSH_RATE] !== this.crushRate || p[P_CRUSH_BITS] !== this.crushBits) {
        this.crushRate = p[P_CRUSH_RATE];
        this.crushBits = p[P_CRUSH_BITS];
        this.crusher.configureFrom(p);
      }
    }
    /** Jump every switch / smoother to its target (initial state, after a reset). */
    snap() {
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
    reset() {
      this.crusher.reset();
      this.rc.reset();
      this.led.reset();
      this.up.reset();
      this.down.reset();
      this.dc.reset();
    }
    /** Render `frames` samples; a null input is silence (lets tails ring out). */
    process(input, output, frames) {
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
    }
    loadInput(input, off, n) {
      const a = this.base;
      if (input === null) {
        for (let i = 0; i < n; i++) a[i] = 0;
      } else {
        for (let i = 0; i < n; i++) a[i] = input[off + i];
      }
    }
    /** RC (A500 only, switched) into the LED biquad (switched), in place. */
    amigaStage(n) {
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
        const x = a[i];
        const rcOut = rcB * (x + rcX1) - rcA1 * rcY1;
        rcX1 = x;
        rcY1 = rcOut;
        if (rm !== rt) rm = rm < rt ? rm + rs > rt ? rt : rm + rs : rm - rs < rt ? rt : rm - rs;
        const ledIn = x + rm * (rcOut - x);
        const ledOut = b0 * ledIn + z1;
        z1 = b1 * ledIn - a1 * ledOut + z2;
        z2 = b2 * ledIn - a2 * ledOut;
        if (lm !== lt) lm = lm < lt ? lm + ls > lt ? lt : lm + ls : lm - ls < lt ? lt : lm - ls;
        a[i] = x + lm * (ledOut - x);
      }
      rc.x1 = rcX1;
      rc.y1 = rcY1;
      led.z1 = z1;
      led.z2 = z2;
      this.rcMix.value = rm;
      this.ledMix.value = lm;
    }
    /** At 2·fs; the switch and the drive/bias glide advance once per base-rate frame. */
    tapeStage(n) {
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
        if (m !== mt) m = m < mt ? m + ms > mt ? mt : m + ms : m - ms < mt ? mt : m - ms;
        const even = b[2 * i];
        const satEven = (Math.tanh(k * (even + bias)) - offset) * invNorm;
        const dcEven = satEven - x1 + r * y1;
        x1 = satEven;
        y1 = dcEven;
        b[2 * i] = even + m * (dcEven - even);
        const odd = b[2 * i + 1];
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
    }
    writeOutput(output, off, n) {
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
        output[off + i] = a[i] * g;
      }
      gs.value = g;
    }
    /** Once per block: subnormal state costs 10–100× on x86. */
    flushDenormals() {
      this.rc.flushDenormals();
      this.led.flushDenormals();
      this.dc.flushDenormals();
    }
  };

  // audio-worklet/js/fx-character-processor.ts
  var FxCharacterProcessor = class extends AudioWorkletProcessor {
    constructor(options) {
      super(options);
      /** Live param values, fxCharacterParams index layout. */
      __publicField(this, "params", characterParamArray());
      __publicField(this, "left");
      __publicField(this, "right");
      __publicField(this, "primed", false);
      __publicField(this, "disposed", false);
      __publicField(this, "resetRequested", false);
      __publicField(this, "expectedTime", 0);
      this.left = new CharacterChannel(sampleRate, this.params);
      this.right = new CharacterChannel(sampleRate, this.params);
      this.port.onmessage = (event) => {
        const data = event.data;
        if (!data) return;
        if (data.type === CHARACTER_MSG_RESET) this.resetRequested = true;
        else if (data.type === CHARACTER_MSG_DISPOSE) this.disposed = true;
      };
    }
    static get parameterDescriptors() {
      return CHARACTER_PARAM_DESCRIPTORS;
    }
    process(inputs, outputs, parameters) {
      if (this.disposed) return false;
      const output = outputs[0];
      if (!output || output.length === 0) return true;
      const outL = output[0];
      const frames = outL.length;
      const params = this.params;
      for (let i = 0; i < CHARACTER_PARAM_DESCRIPTORS.length; i++) {
        const d = CHARACTER_PARAM_DESCRIPTORS[i];
        const values = parameters[d.name];
        params[i] = values !== void 0 && values.length > 0 ? values[0] : d.defaultValue;
      }
      this.left.setTargets(params);
      this.right.setTargets(params);
      const gap = this.primed && currentTime > this.expectedTime + 0.5 * frames / sampleRate;
      if (!this.primed || gap || this.resetRequested) {
        this.left.reset();
        this.right.reset();
        this.left.snap();
        this.right.snap();
        this.primed = true;
        this.resetRequested = false;
      }
      this.expectedTime = currentTime + frames / sampleRate;
      const input = inputs[0];
      const inL = input !== void 0 && input.length > 0 ? input[0] : null;
      const inR = input !== void 0 && input.length > 1 ? input[1] : inL;
      this.left.process(inL, outL, frames);
      if (output.length > 1) this.right.process(inR, output[1], frames);
      for (let c = 2; c < output.length; c++) output[c].fill(0);
      this.left.flushDenormals();
      this.right.flushDenormals();
      return true;
    }
  };
  registerProcessor(CHARACTER_PROCESSOR_NAME, FxCharacterProcessor);
})();
