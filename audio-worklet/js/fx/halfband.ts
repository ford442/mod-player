/**
 * ×2 halfband resampling for the character stage (#453).
 *
 * One 47-tap Kaiser-windowed halfband low-pass, centre tap 23. In a halfband
 * every tap an even distance from the centre (other than the centre itself) is
 * zero, so both directions run polyphase:
 *
 *   up:   y[2n]   = 2·Σ_j h[2j]·x[n−j]        (24 taps)
 *         y[2n+1] = x[n−11]                    (centre tap ·2 = 1: a pure delay)
 *   down: z[n]    = Σ_j h[2j]·a[n−j] + ½·b[n−12]   where a = v[2n], b = v[2n+1]
 *
 * Group delay: 23 samples at 2·fs per direction → CHARACTER_LATENCY_FRAMES = 23
 * frames at fs for the pair. Block kernels over Float64 scratch, no allocation
 * after construction.
 */

export const HALFBAND_TAPS = 47;
export const HALFBAND_CENTER = 23;
/** Non-zero polyphase taps (h[0], h[2], …, h[46]). */
export const HALFBAND_PHASE_TAPS = 24;
/** The polyphase branch is symmetric, so the MAC loop folds to half of it. */
const HALF_PHASE = HALFBAND_PHASE_TAPS / 2;
const LAST_TAP = HALFBAND_PHASE_TAPS - 1;
const KAISER_BETA = 8;

function besselI0(x: number): number {
  // Power series; converges fast for the β used here.
  let sum = 1;
  let term = 1;
  const q = (x * x) / 4;
  for (let k = 1; k < 64; k++) {
    term *= q / (k * k);
    sum += term;
    if (term < sum * 1e-17) break;
  }
  return sum;
}

/** Full 47-tap impulse response, normalised to exactly unity DC gain. */
export function designHalfband(): Float64Array {
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
    const sinc = Math.sin((Math.PI * n) / 2) / ((Math.PI * n) / 2);
    const r = n / half;
    const w = besselI0(KAISER_BETA * Math.sqrt(1 - r * r)) / i0Beta;
    h[k] = 0.5 * sinc * w;
  }
  // The off-centre taps must sum to exactly ½ so each polyphase branch has DC gain ½.
  let side = 0;
  for (let k = 0; k < HALFBAND_TAPS; k += 2) side += h[k]!;
  const scale = 0.5 / side;
  for (let k = 0; k < HALFBAND_TAPS; k += 2) h[k] = h[k]! * scale;
  return h;
}

/** The 24 non-zero polyphase taps h[0], h[2], …, h[46]. */
export function halfbandPhaseTaps(h: Float64Array = designHalfband()): Float64Array {
  const taps = new Float64Array(HALFBAND_PHASE_TAPS);
  for (let j = 0; j < HALFBAND_PHASE_TAPS; j++) taps[j] = h[2 * j]!;
  return taps;
}

const SHARED_TAPS = halfbandPhaseTaps();

/**
 * Mirrored ring of `size` samples: every write lands at `pos` and `pos + size`
 * (pos counts down), so the newest `size` samples are always contiguous at
 * [pos, pos + size) and buf[pos + j] is the sample from j steps ago.
 */
class MirrorRing {
  readonly buf: Float64Array;
  pos = 0;

  constructor(readonly size: number) {
    this.buf = new Float64Array(size * 2);
  }

  clear(): void {
    this.buf.fill(0);
    this.pos = 0;
  }
}

/** fs → 2·fs over blocks: `src[0..n)` → `dst[0..2n)`. */
export class HalfbandUpsampler {
  private readonly ring = new MirrorRing(HALFBAND_PHASE_TAPS);
  private readonly taps = SHARED_TAPS;

  processBlock(src: Float64Array, dst: Float64Array, n: number): void {
    // @noalloc:begin
    const ring = this.ring;
    const buf = ring.buf;
    const size = ring.size;
    const taps = this.taps;
    let pos = ring.pos;
    for (let i = 0; i < n; i++) {
      const x = src[i]!;
      pos = pos === 0 ? size - 1 : pos - 1;
      buf[pos] = x;
      buf[pos + size] = x;
      // The branch is symmetric (taps[j] = taps[23 − j]): fold it, 12 multiplies.
      let acc = 0;
      for (let j = 0; j < HALF_PHASE; j++) acc += taps[j]! * (buf[pos + j]! + buf[pos + LAST_TAP - j]!);
      dst[2 * i] = 2 * acc;
      // Centre tap (½) × zero-stuffing gain (2) = a pure delay of 11 input samples.
      dst[2 * i + 1] = buf[pos + 11]!;
    }
    ring.pos = pos;
    // @noalloc:end
  }

  reset(): void {
    this.ring.clear();
  }
}

/** 2·fs → fs over blocks: `src[0..2n)` → `dst[0..n)`. */
export class HalfbandDownsampler {
  private readonly evenRing = new MirrorRing(HALFBAND_PHASE_TAPS);
  private readonly oddRing = new MirrorRing(13);
  private readonly taps = SHARED_TAPS;

  processBlock(src: Float64Array, dst: Float64Array, n: number): void {
    // @noalloc:begin
    const evenBuf = this.evenRing.buf;
    const evenSize = this.evenRing.size;
    const oddBuf = this.oddRing.buf;
    const oddSize = this.oddRing.size;
    const taps = this.taps;
    let evenPos = this.evenRing.pos;
    let oddPos = this.oddRing.pos;
    for (let i = 0; i < n; i++) {
      const even = src[2 * i]!;
      const odd = src[2 * i + 1]!;
      evenPos = evenPos === 0 ? evenSize - 1 : evenPos - 1;
      evenBuf[evenPos] = even;
      evenBuf[evenPos + evenSize] = even;
      oddPos = oddPos === 0 ? oddSize - 1 : oddPos - 1;
      oddBuf[oddPos] = odd;
      oddBuf[oddPos + oddSize] = odd;
      let acc = 0;
      for (let j = 0; j < HALF_PHASE; j++) acc += taps[j]! * (evenBuf[evenPos + j]! + evenBuf[evenPos + LAST_TAP - j]!);
      // h[23] = ½ multiplies v[2n − 23] = the odd sample from 12 steps ago.
      dst[i] = acc + 0.5 * oddBuf[oddPos + 12]!;
    }
    this.evenRing.pos = evenPos;
    this.oddRing.pos = oddPos;
    // @noalloc:end
  }

  reset(): void {
    this.evenRing.clear();
    this.oddRing.clear();
  }
}
