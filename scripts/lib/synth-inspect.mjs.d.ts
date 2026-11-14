export interface ModSampleSpec { name: string; frames: number; loopStart: number; loopLength: number; volume: number; finetune: number }
export const MOD_SPEC: { readonly channels: number; readonly samples: readonly ModSampleSpec[] };
/** 4-channel ProTracker MOD with three named samples (looped / one-shot / name only). */
export function synthInspectMod(): Uint8Array;

export interface XmEnvelopeSpec { points: Array<[number, number]>; sustain: number; loopStart: number; loopEnd: number; flags: number }
export interface XmSampleSpec {
  name: string; frames: number; loopStart: number; loopLength: number; loopType: number; is16Bit: boolean;
  volume: number; finetune: number; relativeNote: number; pan: number;
}
export interface XmInstrumentSpec {
  name: string; splitNote: number; volumeEnvelope: XmEnvelopeSpec | null; panningEnvelope: XmEnvelopeSpec | null;
  fadeOut: number; samples: XmSampleSpec[];
}
export const XM_SPEC: { readonly channels: number; readonly instruments: readonly XmInstrumentSpec[] };
/** XM: a two-sample, key-split instrument with volume + panning envelopes, and a one-sample instrument. */
export function synthInstrumentXm(): Uint8Array;

export interface S3mSampleSpec { name: string; file: string; frames: number; loopStart: number; loopEnd: number; loop: boolean; volume: number; c2spd: number }
export const S3M_SPEC: { readonly samples: readonly S3mSampleSpec[] };
/** S3M with two 8-bit samples (one looped). */
export function synthSampleS3m(): Uint8Array;
