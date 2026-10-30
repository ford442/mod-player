/** Deterministic, audible synthetic XM with `channels` voices (1..32 per XM spec). */
export function synthXm(channels: number): Uint8Array;

/**
 * Deterministic 2-channel / 16-row XM whose first rows carry known values in every pattern
 * column (volume, panning, arpeggio, ECx note cut, v00, …); see the row table in synth-xm.mjs.
 */
export function synthCommandTestXm(): Uint8Array;

/** Tiny S3M with `C-4 01 v32 A07` on row 0 and the `SC3` note cut on row 1 (channel 0). */
export function synthCommandTestS3m(): Uint8Array;
