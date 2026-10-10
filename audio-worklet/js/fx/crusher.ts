/**
 * Paula-style crush for the character stage (#453): sample-and-hold rate
 * reduction plus a mid-tread quantizer, blended in by a LinearSwitch.
 *
 * The hold clock is an exact accumulator in Hz (`phase += rate`, wrap at fs),
 * so integer ratios hold for exactly fs/rate samples — 4000 Hz at 48 kHz is a
 * run of 12, every time.
 */
import { P_CRUSH_BITS, P_CRUSH_RATE } from '../../fxCharacterParams';
import type { LinearSwitch } from './smoothing';

/** Quantizer step for `bits` of depth over ±1: 2^(1 − bits). */
export function quantizerStep(bits: number): number {
  return Math.pow(2, 1 - bits);
}

export class Crusher {
  private phase = 0;
  private held = 0;
  private rate = 48000;
  private step = 1 / 128;
  /** Next sample starts a fresh hold period (after construction / reset). */
  private fresh = true;

  constructor(private readonly sampleRate: number) {
    this.rate = sampleRate;
  }

  configure(rateHz: number, bits: number): void {
    const fs = this.sampleRate;
    this.rate = rateHz < 1 ? 1 : rateHz > fs ? fs : rateHz;
    this.step = quantizerStep(bits);
  }

  /**
   * configure() from the processor's param array (fxCharacterParams layout).
   * Called from process(): no double crosses a call boundary, so nothing is
   * boxed even if this isn't inlined.
   */
  configureFrom(p: ArrayLike<number>): void {
    // @noalloc:begin
    const fs = this.sampleRate;
    const rateHz = p[P_CRUSH_RATE]!;
    this.rate = rateHz < 1 ? 1 : rateHz > fs ? fs : rateHz;
    this.step = Math.pow(2, 1 - p[P_CRUSH_BITS]!);
    // @noalloc:end
  }

  /** In place: buf[i] ← buf[i] + mix·(crush(buf[i]) − buf[i]). */
  processBlock(buf: Float64Array, n: number, mix: LinearSwitch): void {
    // @noalloc:begin
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
      const x = buf[i]!;
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
      if (m !== mt) m = m < mt ? (m + ms > mt ? mt : m + ms) : m - ms < mt ? mt : m - ms;
      buf[i] = x + m * (held - x);
    }
    this.phase = phase;
    this.held = held;
    this.fresh = fresh;
    mix.value = m;
    // @noalloc:end
  }

  reset(): void {
    this.fresh = true;
    this.held = 0;
  }
}
