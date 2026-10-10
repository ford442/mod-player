/**
 * The FX rack (#453): ordered slots between `input` and `output`.
 *
 *   input → slot[order[0]] → … → slot[order[n−1]] → output (returnGain)
 *
 * One class serves both worlds:
 * - live (`mode: 'live'`): parameter glides, slot crossfades, and
 *   attach / collapse against the master graph (fxHost) as a complementary
 *   fade of `masterDirect` and `returnGain` — never an edge swap under signal;
 * - static (`mode: 'static'`): every value set immediately — offline export,
 *   tests and the Chromium harness build the exact same graph this way.
 *
 * Modules are created lazily the first time they are enabled (the character
 * worklet needs addModule, the room an IR); until then a slot is a dry wire.
 */
import {
  FX_CROSSFADE_S,
  FX_LOOKAHEAD_S,
  FadeScheduler,
  type FadeWindow,
} from './automation';
import { FxSlot } from './FxSlot';
import { createFxModule } from './modules';
import type { AnyFxModule, FxModuleEnv, FxModuleFactory } from './modules/types';
import type { FxScheduler } from './scheduler';
import { cloneFxRackState, parseFxRackState } from './spec/schema';
import {
  FX_MODULE_IDS,
  isModuleActive,
  type FxModuleId,
  type FxParamsById,
  type FxRackState,
} from './types';

export type FxRackMode = 'live' | 'static';

export interface FxRackEnv extends FxModuleEnv {
  mode: FxRackMode;
  /** Live: runs deferred unwires / rewires on the audio clock. */
  scheduler?: FxScheduler;
  /** Crossfade length override — tests use 0 (hard switch) to build reference renders. */
  fadeSeconds?: number;
  /** Module factory override (tests). */
  createModule?: FxModuleFactory;
}

/** The master-graph nodes the rack attaches to (see audio/fx/fxHost.ts). */
export interface FxAttachPoint {
  readonly masterInput: AudioNode;
  readonly masterDirect: GainNode;
  readonly analyser: AudioNode;
}

/**
 * One fade timeline per masterDirect gain, shared by every rack that ever
 * attaches to it — a rebuilt rack must queue behind its predecessor's fades.
 */
const directFades = new WeakMap<GainNode, FadeScheduler>();

function directFadeFor(node: GainNode, fadeSeconds: number): FadeScheduler {
  let fade = directFades.get(node);
  if (!fade) {
    fade = new FadeScheduler(node.gain, node.gain.value, fadeSeconds);
    directFades.set(node, fade);
  }
  return fade;
}

export interface ApplyOptions {
  /** Audio time the change takes effect (live default: currentTime + lookahead). */
  at?: number;
  /** Set everything now (default: true in static mode). */
  immediate?: boolean;
}

export class FxRack {
  readonly input: GainNode;
  /** The return gain: 1 standalone; faded 0 ⇄ 1 when attached to the master graph. */
  readonly output: GainNode;

  private readonly slots: Record<FxModuleId, FxSlot>;
  private readonly creating = new Map<FxModuleId, Promise<AnyFxModule | null>>();
  private readonly returnFade: FadeScheduler;
  private readonly fadeSeconds: number;
  /** Desired slot order. */
  private order: FxModuleId[];
  /** Slot order currently wired (differs from `order` mid-reorder). */
  private wiredOrder: FxModuleId[] = [];
  private state: FxRackState;
  private host: FxAttachPoint | null = null;
  private queue: Promise<void> = Promise.resolve();
  private disposed = false;
  /** Modules whose factory resolved null (can't run in this browser / context). */
  readonly unavailable = new Set<FxModuleId>();
  /** Which module instance last received setParams (a fresh module needs them once). */
  private readonly paramsAppliedTo = new Map<FxModuleId, AnyFxModule>();

  private constructor(
    readonly ctx: BaseAudioContext,
    private readonly env: FxRackEnv,
    initial: FxRackState,
  ) {
    this.fadeSeconds = env.fadeSeconds ?? FX_CROSSFADE_S;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.returnFade = new FadeScheduler(this.output.gain, 1, this.fadeSeconds);
    this.slots = Object.fromEntries(
      FX_MODULE_IDS.map((id) => [id, new FxSlot(id, ctx, this.fadeSeconds)]),
    ) as Record<FxModuleId, FxSlot>;
    this.order = [...initial.order];
    // Start fully bypassed (params kept); create() applies `initial` on top.
    const bypassed = parseFxRackState(initial);
    for (const id of FX_MODULE_IDS) bypassed.modules[id].enabled = false;
    this.state = bypassed;
    this.wireChain();
  }

  /** Build a rack and apply `state` immediately (no fades). */
  static async create(ctx: BaseAudioContext, state: FxRackState, env: FxRackEnv): Promise<FxRack> {
    const rack = new FxRack(ctx, env, parseFxRackState(state));
    await rack.apply(state, { at: ctx.currentTime, immediate: true });
    return rack;
  }

  /** The last state applied (what the rack is, or is heading to). */
  serialize(): FxRackState {
    return cloneFxRackState(this.state);
  }

  /** Create modules ahead of enabling them (tests: no node creation mid-render). */
  async prepare(ids: readonly FxModuleId[]): Promise<void> {
    for (const id of ids) await this.ensureModule(id, this.state.modules[id].params);
  }

  /** Apply a full state. Calls are serialized; each diff is scheduled at `at`. */
  apply(next: FxRackState, opts: ApplyOptions = {}): Promise<void> {
    const run = this.queue.then(() => this.applyNow(parseFxRackState(next), opts));
    this.queue = run.catch(() => {});
    return run;
  }

  private async applyNow(next: FxRackState, opts: ApplyOptions): Promise<void> {
    if (this.disposed) return;
    const immediate = opts.immediate ?? this.env.mode === 'static';
    const requestedAt = opts.at ?? this.ctx.currentTime + FX_LOOKAHEAD_S;

    // Create what's newly needed first: node creation is async, and the
    // schedule below must not land in the past once it resolves.
    for (const id of FX_MODULE_IDS) {
      if (isModuleActive(next, id)) await this.ensureModule(id, next.modules[id].params);
    }
    if (this.disposed) return;
    const at = immediate ? requestedAt : Math.max(requestedAt, this.ctx.currentTime + FX_LOOKAHEAD_S);

    if (!sameOrder(this.order, next.order)) this.reorder(next.order, at, immediate);

    for (const id of FX_MODULE_IDS) {
      const slot = this.slots[id];
      const module = slot.module;
      const params = next.modules[id].params;
      // Keep params current even while bypassed, so a re-enable sounds right.
      if (module && (immediate || !sameJson(params, this.state.modules[id].params) || module !== this.paramsAppliedTo.get(id))) {
        module.setParams(params as never, at, immediate);
        this.paramsAppliedTo.set(id, module);
      }
      const want = isModuleActive(next, id) && module !== null;
      if (want) slot.activate(at, immediate);
      else if (module) {
        slot.deactivate(at, immediate, module.tailSeconds(params as never), this.env.scheduler);
      }
    }
    this.state = next;
  }

  private async ensureModule<K extends FxModuleId>(id: K, params: FxParamsById[K]): Promise<AnyFxModule | null> {
    const slot = this.slots[id];
    if (slot.module) return slot.module;
    if (this.unavailable.has(id)) return null;
    let pending = this.creating.get(id);
    if (!pending) {
      const factory = this.env.createModule ?? createFxModule;
      pending = factory(id, this.ctx, params, this.env).then((module) => {
        if (this.disposed) {
          module?.dispose();
          return null;
        }
        if (module) slot.module = module as AnyFxModule;
        else this.unavailable.add(id);
        return module as AnyFxModule | null;
      });
      this.creating.set(id, pending);
      pending.finally(() => this.creating.delete(id)).catch(() => {});
    }
    return pending;
  }

  private wireChain(): void {
    let prev: AudioNode = this.input;
    for (const id of this.order) {
      prev.connect(this.slots[id].input);
      prev = this.slots[id].output;
    }
    prev.connect(this.output);
    this.wiredOrder = [...this.order];
  }

  private unwireChain(): void {
    let prev: AudioNode = this.input;
    for (const id of this.wiredOrder) {
      try { prev.disconnect(this.slots[id].input); } catch { /* not connected */ }
      prev = this.slots[id].output;
    }
    try { prev.disconnect(this.output); } catch { /* not connected */ }
    this.wiredOrder = [];
  }

  /**
   * Live and attached: dip to the dry path, rewire while silent, fade back
   * (~3 × fade). Static or standalone: rewire now.
   */
  private reorder(order: FxModuleId[], at: number, immediate: boolean): void {
    const host = this.host;
    const scheduler = this.env.scheduler;
    if (immediate || !host || !scheduler) {
      this.unwireChain();
      this.order = [...order];
      this.wireChain();
      return;
    }
    const direct = directFadeFor(host.masterDirect, this.fadeSeconds);
    direct.fadeTo(1, at);
    const out = this.returnFade.fadeTo(0, at);
    this.order = [...order];
    scheduler.at(out.end, () => {
      if (this.disposed || sameOrder(this.wiredOrder, this.order)) return;
      this.unwireChain();
      this.wireChain();
      const back = this.ctx.currentTime + FX_LOOKAHEAD_S;
      if (this.host) {
        directFadeFor(this.host.masterDirect, this.fadeSeconds).fadeTo(0, back);
        this.returnFade.fadeTo(1, back);
      }
    });
  }

  get isAttached(): boolean {
    return this.host !== null;
  }

  /**
   * Live: carry the master signal through the rack. Connects in parallel to
   * masterDirect, then fades masterDirect 1 → 0 and the return 0 → 1. With every
   * slot bypassed the two paths are identical, so this is inaudible.
   */
  attach(host: FxAttachPoint, at = this.ctx.currentTime + FX_LOOKAHEAD_S): FadeWindow {
    if (this.host && !sameAttachPoint(this.host, host)) this.detachNow();
    if (!this.host) {
      this.returnFade.setStatic(0);
      host.masterInput.connect(this.input);
      this.output.connect(host.analyser);
      this.host = host;
    }
    // Also reverses a collapse that hasn't detached yet.
    directFadeFor(host.masterDirect, this.fadeSeconds).fadeTo(0, at);
    return this.returnFade.fadeTo(1, at);
  }

  private detachNow(): void {
    const host = this.host;
    if (!host) return;
    try { host.masterInput.disconnect(this.input); } catch { /* gone */ }
    try { this.output.disconnect(host.analyser); } catch { /* gone */ }
    this.host = null;
  }

  /**
   * Live: hand the master signal back to masterDirect (fade), then disconnect
   * the rack's two master edges by target. Call once every slot is quiet.
   */
  collapse(at = this.ctx.currentTime + FX_LOOKAHEAD_S): FadeWindow {
    const host = this.host;
    if (!host) return { start: at, end: at };
    directFadeFor(host.masterDirect, this.fadeSeconds).fadeTo(1, at);
    const window = this.returnFade.fadeTo(0, at);
    const detach = () => {
      // Re-attached (or attached elsewhere) in the meantime: leave it.
      if (this.host !== host || this.returnFade.target !== 0) return;
      this.detachNow();
    };
    if (this.env.scheduler) this.env.scheduler.at(window.end + FX_LOOKAHEAD_S, detach);
    return window;
  }

  /** True when no slot is active and every fade / tail has finished. */
  isQuiet(now = this.ctx.currentTime): boolean {
    return FX_MODULE_IDS.every((id) => this.slots[id].isQuiet(now));
  }

  /** Total wet-path latency of the active modules (seconds). */
  latencySeconds(): number {
    let total = 0;
    for (const id of FX_MODULE_IDS) {
      const module = this.slots[id].module;
      if (module && this.slots[id].isActive) total += module.latencySeconds;
    }
    return total;
  }

  /** How long the active modules keep sounding after the input stops (seconds). */
  tailSeconds(): number {
    let total = 0;
    for (const id of FX_MODULE_IDS) {
      const module = this.slots[id].module;
      if (module && this.slots[id].isActive) total += module.tailSeconds(this.state.modules[id].params as never);
    }
    return total;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detachNow();
    for (const id of FX_MODULE_IDS) this.slots[id].dispose();
    this.input.disconnect();
    this.output.disconnect();
  }
}

function sameOrder(a: readonly FxModuleId[], b: readonly FxModuleId[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sameAttachPoint(a: FxAttachPoint, b: FxAttachPoint): boolean {
  return a.masterInput === b.masterInput && a.masterDirect === b.masterDirect && a.analyser === b.analyser;
}
