/**
 * FX rack types (#453). Pure data — imported by the main chunk (store, MIDI,
 * UI) and by the lazily loaded rack alike.
 */

export const FX_MODULE_IDS = ['character', 'eq', 'comp', 'room'] as const;
export type FxModuleId = (typeof FX_MODULE_IDS)[number];

/** Default rack order: coloration first, then tone, dynamics, space. */
export const DEFAULT_FX_ORDER: readonly FxModuleId[] = ['character', 'eq', 'comp', 'room'];

export type LedModel = 'a500' | 'a1200';
export type RoomIrId = 'small' | 'medium' | 'large';

export interface CharacterParams {
  tapeOn: boolean;
  /** 0…1 → 0…+24 dB into the saturator. */
  drive: number;
  /** Saturator asymmetry, 0…0.5. */
  bias: number;
  ledOn: boolean;
  ledModel: LedModel;
  crushOn: boolean;
  /** Hold rate, Hz. */
  crushRate: number;
  /** Quantizer depth, bits. */
  crushBits: number;
  /** Output trim, dB. */
  outputGain: number;
}

export interface EqParams {
  lowGain: number;
  lowFreq: number;
  midGain: number;
  midFreq: number;
  midQ: number;
  highGain: number;
  highFreq: number;
  outputGain: number;
}

export interface CompParams {
  /** dB */
  threshold: number;
  ratio: number;
  /** dB */
  knee: number;
  /** seconds */
  attack: number;
  /** seconds */
  release: number;
  /** dB */
  makeup: number;
}

export interface RoomParams {
  ir: RoomIrId;
  /** Wet send, 0…1. */
  mix: number;
  /** ms */
  predelay: number;
  /** Hz, high-pass on the send. */
  lowCut: number;
}

export interface FxParamsById {
  character: CharacterParams;
  eq: EqParams;
  comp: CompParams;
  room: RoomParams;
}

export interface FxModuleState<P> {
  enabled: boolean;
  params: P;
}

export type FxModulesState = { [K in FxModuleId]: FxModuleState<FxParamsById[K]> };

/** Serializable rack state — what presets, persistence and export carry. */
export interface FxRackState {
  version: 1;
  /** Master switch; a module sounds only when this and its own flag are on. */
  enabled: boolean;
  order: FxModuleId[];
  modules: FxModulesState;
}

export function isModuleActive(state: FxRackState, id: FxModuleId): boolean {
  return state.enabled && state.modules[id].enabled;
}

export function anyModuleActive(state: FxRackState): boolean {
  return state.enabled && FX_MODULE_IDS.some((id) => state.modules[id].enabled);
}
