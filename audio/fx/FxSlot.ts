/**
 * One rack slot (#453): a dry path and a module path, crossfaded.
 *
 *   in ─┬─ dry(G) ───────────────────────────┬─ out
 *       └─ module.in … module.out ─ wet(G) ───┘
 *
 * Bypassed: dry = 1, wet = 0 and the module is unwired, so the slot is a unity
 * gain chain (bit-exact). Enabling wires the module, lets it run at wet = 0 for
 * `warmupSeconds` (stale filter / envelope state rings out unheard), then
 * crossfades. Disabling crossfades back and unwires the module after its tail,
 * so a bypassed module costs no CPU. A generation counter cancels a stale
 * deferred unwire when the slot is re-enabled in the meantime.
 */
import { FX_CROSSFADE_S, FadeScheduler, type FadeWindow } from './automation';
import type { AnyFxModule } from './modules/types';
import type { FxScheduler } from './scheduler';
import type { FxModuleId } from './types';

/** Extra time after a module's tail before it is unwired. */
const UNWIRE_MARGIN_S = 0.05;

export class FxSlot {
  readonly input: GainNode;
  readonly output: GainNode;
  private readonly dry: GainNode;
  private readonly wet: GainNode;
  private readonly dryFade: FadeScheduler;
  private readonly wetFade: FadeScheduler;
  private moduleRef: AnyFxModule | null = null;
  private wired = false;
  private active = false;
  private generation = 0;
  /** Audio time after which the module is silent and unwired (or may be). */
  private quietAt = 0;

  constructor(
    readonly id: FxModuleId,
    ctx: BaseAudioContext,
    fadeSeconds: number = FX_CROSSFADE_S,
  ) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.input.connect(this.dry);
    this.dry.connect(this.output);
    this.wet.connect(this.output);
    this.dryFade = new FadeScheduler(this.dry.gain, 1, fadeSeconds);
    this.wetFade = new FadeScheduler(this.wet.gain, 0, fadeSeconds);
  }

  get module(): AnyFxModule | null {
    return this.moduleRef;
  }

  set module(module: AnyFxModule | null) {
    if (this.wired) this.unwire();
    this.moduleRef = module;
  }

  get isActive(): boolean {
    return this.active;
  }

  /** True once disabled and every fade / tail has finished. */
  isQuiet(now: number): boolean {
    return !this.active && now >= this.quietAt;
  }

  /** Switch to the module: live = warm up then crossfade; immediate = now. */
  activate(at: number, immediate: boolean): FadeWindow {
    const module = this.moduleRef;
    if (!module || this.active) return { start: at, end: at };
    this.active = true;
    this.generation++;
    this.wire();
    if (immediate) {
      this.dryFade.setStatic(0);
      this.wetFade.setStatic(1);
      module.fadeIn?.(at, true);
      return { start: at, end: at };
    }
    const start = at + module.warmupSeconds;
    this.dryFade.fadeTo(0, start);
    const window = this.wetFade.fadeTo(1, start);
    if (module.fadeIn) return { start: window.start, end: module.fadeIn(window.end, false) };
    return window;
  }

  /** Switch back to dry: live = crossfade, then unwire after the tail. */
  deactivate(at: number, immediate: boolean, tailSeconds: number, scheduler: FxScheduler | undefined): FadeWindow {
    const module = this.moduleRef;
    if (!module || !this.active) return { start: at, end: at };
    this.active = false;
    const generation = ++this.generation;
    if (immediate) {
      module.fadeOut?.(at, true);
      this.dryFade.setStatic(1);
      this.wetFade.setStatic(0);
      this.unwire();
      this.quietAt = 0;
      return { start: at, end: at };
    }
    // A module with an internal fade (room) rings out first; then wet == dry and the swap is silent.
    const swapAt = module.fadeOut ? module.fadeOut(at, false) : at;
    this.dryFade.fadeTo(1, swapAt);
    const window = this.wetFade.fadeTo(0, swapAt);
    this.quietAt = window.end + (module.fadeOut ? 0 : tailSeconds) + UNWIRE_MARGIN_S;
    scheduler?.at(this.quietAt, () => {
      if (this.generation === generation && !this.active) this.unwire();
    });
    return { start: at, end: window.end };
  }

  private wire(): void {
    const module = this.moduleRef;
    if (this.wired || !module) return;
    this.input.connect(module.input);
    module.output.connect(this.wet);
    this.wired = true;
  }

  private unwire(): void {
    const module = this.moduleRef;
    if (!this.wired || !module) return;
    try { this.input.disconnect(module.input); } catch { /* already gone */ }
    try { module.output.disconnect(this.wet); } catch { /* already gone */ }
    this.wired = false;
  }

  dispose(): void {
    this.unwire();
    this.moduleRef?.dispose();
    this.moduleRef = null;
    for (const node of [this.input, this.dry, this.wet, this.output]) node.disconnect();
  }
}
