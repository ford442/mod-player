/** FX module contract (#453): one Web Audio sub-graph per rack slot. */
import type { IrLoader } from '../room/irLoader';
import type { FxScheduler } from '../scheduler';
import type { FxModuleId, FxParamsById } from '../types';

export type FxModuleStatus = 'loading' | 'ready' | 'unavailable';

export interface FxModuleEnv {
  /** Character worklet module URL; the browser default comes from character/fxWorkletUrl.ts. */
  characterWorkletUrl?: string;
  /** Room IRs. Without one the room is unavailable. */
  irLoader?: IrLoader;
  /** Live: deferred cleanup on the audio clock (e.g. the room's idle convolver). */
  scheduler?: FxScheduler;
  /** Module lifecycle for the UI (room: loading its IR, or unavailable here). */
  onStatus?: (module: FxModuleId, status: FxModuleStatus, detail?: string) => void;
}

export interface FxModuleInstance<K extends FxModuleId = FxModuleId> {
  readonly id: K;
  readonly input: AudioNode;
  readonly output: AudioNode;
  /** Processing delay of the wet path (reported, never compensated on the dry path). */
  readonly latencySeconds: number;
  /** How long the wet path runs at wet = 0 before the slot fades to it (filter/envelope settle). */
  readonly warmupSeconds: number;
  /** How long the wet path keeps ringing after its input stops. */
  tailSeconds(params: FxParamsById[K]): number;
  /** Live: glide at `at`. `immediate`: set now (static builds, export, initial state). */
  setParams(params: FxParamsById[K], at: number, immediate: boolean): void;
  /**
   * Optional internal fade-in after the slot has switched to the module (the
   * room's send ramps up only once wet == dry). Returns when it finishes.
   */
  fadeIn?(at: number, immediate: boolean): number;
  /**
   * Optional internal fade-out before the slot switches away (the room's send
   * ramps down so the tail rings out). Returns when the slot may switch.
   */
  fadeOut?(at: number, immediate: boolean): number;
  dispose(): void;
}

export type AnyFxModule = { [K in FxModuleId]: FxModuleInstance<K> }[FxModuleId];

/** Builds a module, or resolves null when it can't run here (e.g. no IR decoder). */
export type FxModuleFactory = <K extends FxModuleId>(
  id: K,
  ctx: BaseAudioContext,
  params: FxParamsById[K],
  env: FxModuleEnv,
) => Promise<FxModuleInstance<K> | null>;
