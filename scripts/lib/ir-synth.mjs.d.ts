export declare const IR_SYNTH_VERSION: number;

export interface IrSpec {
  seconds: number;
  rt60Low: number;
  rt60High: number;
  reflections: number;
  firstMs: number;
  lastMs: number;
  seed: number;
}

export declare const IR_SPECS: Record<'small' | 'medium' | 'large', IrSpec>;
export declare const IR_IDS: ('small' | 'medium' | 'large')[];

/** Deterministic, wet-only, unit-energy stereo IR at `sampleRate` (default 48 kHz). */
export function synthIr(id: 'small' | 'medium' | 'large', sampleRate?: number): Float32Array[];
