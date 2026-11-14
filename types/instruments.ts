/** Downsampled waveform points uploaded to UI (peaks in roughly -1..1). */
export const WAVEFORM_POINTS = 256;

export interface SampleInfo {
  /** 1-based tracker sample index. */
  index: number;
  name: string;
  /** Sample length in frames. 0 when the sample has no PCM (empty slot, OPL instrument). */
  length: number;
  /** PCM size in bytes (frames × channels × bytes per sample). */
  bytes: number;
  /** Loop start / end in frames; both 0 when the sample does not loop. */
  loopStart: number;
  loopEnd: number;
  /** Sustain loop in frames; both 0 when there is none. */
  sustainStart: number;
  sustainEnd: number;
  /** 0–64 default volume. */
  volume: number;
  /** Finetune in 1/128 semitone (MOD / XM; libopenmpt's ModSample::nFineTune), 0 elsewhere. */
  finetune: number;
  /** Semitone transpose relative to middle C (MOD / XM relative note); 0 if unavailable. */
  transpose: number;
  /** Middle-C sample rate as libopenmpt plays it, Hz. */
  sampleRate: number;
  /** Default panning 0..256, or null when the sample does not force one. */
  pan: number | null;
  is16Bit: boolean;
  stereo: boolean;
  pingPongLoop: boolean;
  hasPcm: boolean;
  /** WAVEFORM_POINTS signed peaks (the larger of |min| / |max| per bucket) — the thumbnail line. */
  waveform: Float32Array;
  /** WAVEFORM_POINTS (min, max) pairs, interleaved — a filled min/max waveform. */
  peaks: Float32Array;
}

export interface EnvelopePoint {
  tick: number;
  /** 0..64 (panning / pitch: 32 is the centre). */
  value: number;
}

export interface InstrumentEnvelopeInfo {
  enabled: boolean;
  loop: boolean;
  sustain: boolean;
  carry: boolean;
  /** Pitch envelope only: drives the filter cutoff instead of the pitch. */
  filter: boolean;
  points: EnvelopePoint[];
  /** Node indices into `points`. */
  loopStart: number;
  loopEnd: number;
  sustainStart: number;
  sustainEnd: number;
  releaseNode: number | null;
}

export interface InstrumentEnvelopes {
  volume: InstrumentEnvelopeInfo;
  panning: InstrumentEnvelopeInfo;
  pitch: InstrumentEnvelopeInfo;
}

export interface InstrumentInfo {
  /** 1-based tracker instrument index (the sample index for sample-only formats). */
  index: number;
  name: string;
  /** Samples the instrument's keymap plays, ascending. */
  sampleIndices: number[];
  /** 0–64 global volume when known. */
  volume?: number;
  samples: SampleInfo[];
  /** Note → sample keymap (sample index per note 1..128; 0 = none). Instrument formats only. */
  keymap?: Uint16Array;
  /** Volume / panning / pitch envelopes. Instrument formats only. */
  envelopes?: InstrumentEnvelopes;
  fadeOut?: number;
}

/** libopenmpt's module type (metadata key `type`: "mod", "xm", "it", "s3m", "mptm", …), or 'unknown'. */
export type ModuleSampleFormat = string;

export interface InstrumentTable {
  format: ModuleSampleFormat;
  instruments: InstrumentInfo[];
  samples: SampleInfo[];
}

export function emptyInstrumentTable(): InstrumentTable {
  return { format: 'unknown', instruments: [], samples: [] };
}

/** The typed-array buffers of a table, for a worker's postMessage transfer list. */
export function instrumentTableTransferables(table: InstrumentTable): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>();
  const add = (a: ArrayBufferView | undefined) => {
    if (a && a.buffer instanceof ArrayBuffer && a.byteLength > 0) out.add(a.buffer);
  };
  for (const s of table.samples) {
    add(s.waveform);
    add(s.peaks);
  }
  for (const i of table.instruments) add(i.keymap);
  return [...out];
}
