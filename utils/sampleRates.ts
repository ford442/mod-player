/**
 * Sample-rate constants shared by live playback and export. Pure (no DOM, no
 * AudioContext) so the export worker can import them.
 */

/** Locked render rate. Native (`--grow`) and the JS engine both render here. */
export const PLAYER_SAMPLE_RATE = 48000;

export type PlayerSampleRate = 44100 | 48000;

/** CD rate: an explicit WAV export option (#490). Live playback never runs here. */
export const CD_SAMPLE_RATE = 44100;
