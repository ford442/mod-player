/** Downsampled waveform points uploaded to UI (peaks in roughly -1..1). */
export const WAVEFORM_POINTS = 256;

export interface SampleInfo {
  /** 1-based tracker sample index. */
  index: number;
  name: string;
  /** Sample length in bytes (PCM). */
  length: number;
  loopStart: number;
  loopEnd: number;
  /** 0–64 tracker volume when known. */
  volume: number;
  finetune: number;
  /** Semitone transpose / middle-C offset when known; 0 if unavailable. */
  transpose: number;
  waveform: Float32Array;
}

export interface InstrumentInfo {
  /** 1-based tracker instrument index. */
  index: number;
  name: string;
  sampleIndices: number[];
  volume?: number;
  samples: SampleInfo[];
}

export type ModuleSampleFormat = 'mod' | 'xm' | 'it' | 's3m' | 'unknown';

export interface InstrumentTable {
  format: ModuleSampleFormat;
  instruments: InstrumentInfo[];
  samples: SampleInfo[];
}

export function emptyInstrumentTable(): InstrumentTable {
  return { format: 'unknown', instruments: [], samples: [] };
}
