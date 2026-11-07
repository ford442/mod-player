/** Deterministic, audible synthetic XM with `channels` voices (1..32 per XM spec). */
export function synthXm(channels: number): Uint8Array;

/**
 * Deterministic 2-channel / 16-row XM whose first rows carry known values in every pattern
 * column (volume, panning, arpeggio, ECx note cut, v00, …); see the row table in synth-xm.mjs.
 */
export function synthCommandTestXm(): Uint8Array;

/** Tiny S3M with `C-4 01 v32 A07` on row 0 and the `SC3` note cut on row 1 (channel 0). */
export function synthCommandTestS3m(): Uint8Array;

/** The order list of `synthSongMapXm()` (30 orders over 5 patterns). */
export const SONG_MAP_ORDERS: number[];
/** Rows per pattern of `synthSongMapXm()`. */
export const SONG_MAP_PATTERN_ROWS: number[];
/** `[pattern, row, XM Fxx parameter, kind]` of every tempo / speed cell in `synthSongMapXm()`. */
export const SONG_MAP_TEMPO_CELLS: Array<[number, number, number, 'tempo' | 'speed']>;

/** 30-order, 5-pattern XM with tempo and speed changes, for the song map (#537). */
export function synthSongMapXm(): Uint8Array;

/** 4 × 16-row XM: order 0 breaks to order 1 row 10, order 1 jumps to order 3 (order 2 unreached). */
export function synthJumpXm(): Uint8Array;
