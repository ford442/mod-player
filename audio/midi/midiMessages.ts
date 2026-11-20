/**
 * MIDI byte builders for the MIDI-out path (#538). Pure; no Web MIDI, no engine.
 *
 * The system real-time bytes (clock / start / continue / stop) are single-byte messages that may be
 * interleaved anywhere; Song Position Pointer is a system-common message (status + two 7-bit bytes).
 */

/** Timing Clock: 24 per quarter note. */
export const MIDI_CLOCK = 0xf8;
export const MIDI_START = 0xfa;
export const MIDI_CONTINUE = 0xfb;
export const MIDI_STOP = 0xfc;
export const MIDI_SONG_POSITION = 0xf2;

/** MIDI Clock resolution. */
export const CLOCKS_PER_BEAT = 24;
/** Song Position Pointer counts "MIDI beats" = 6 clocks = a sixteenth note. */
export const CLOCKS_PER_SPP_UNIT = 6;
/** SPP is 14 bits. */
export const MAX_SONG_POSITION = 0x3fff;

export type MidiBytes = readonly number[];

export const CLOCK_BYTES: MidiBytes = [MIDI_CLOCK];
export const START_BYTES: MidiBytes = [MIDI_START];
export const CONTINUE_BYTES: MidiBytes = [MIDI_CONTINUE];
export const STOP_BYTES: MidiBytes = [MIDI_STOP];

/**
 * Song Position Pointer for `units` sixteenth notes from the start. The player's unit is the pattern
 * row: a row is a sixteenth note at the tracker default of four rows per beat (which also makes six
 * clocks per row), so the global row index *is* the SPP value for MOD / XM / S3M and for IT patterns
 * that keep the default rows-per-beat.
 */
export function songPositionBytes(units: number): MidiBytes {
  const n = Math.max(0, Math.min(MAX_SONG_POSITION, Math.floor(Number.isFinite(units) ? units : 0)));
  return [MIDI_SONG_POSITION, n & 0x7f, (n >> 7) & 0x7f];
}

const channelNibble = (channel: number): number => Math.max(0, Math.min(15, Math.floor(channel))) & 0x0f;
const data7 = (value: number): number => Math.max(0, Math.min(127, Math.round(value)));

/** `channel` is 0–15 (MIDI channel 1–16). */
export function noteOnBytes(channel: number, note: number, velocity: number): MidiBytes {
  return [0x90 | channelNibble(channel), data7(note), Math.max(1, data7(velocity))];
}

export function noteOffBytes(channel: number, note: number): MidiBytes {
  return [0x80 | channelNibble(channel), data7(note), 0];
}

/** CC 123 (All Notes Off). */
export function allNotesOffBytes(channel: number): MidiBytes {
  return [0xb0 | channelNibble(channel), 123, 0];
}

/** CC 120 (All Sound Off). */
export function allSoundOffBytes(channel: number): MidiBytes {
  return [0xb0 | channelNibble(channel), 120, 0];
}

/** Lowest / highest libopenmpt note value that is a note (1 = C-0 … 119 = B-9). Above it: off / cut / fade. */
export const PATTERN_NOTE_MIN = 1;
export const PATTERN_NOTE_MAX = 119;

/**
 * MIDI note number for a libopenmpt pattern note. OpenMPT's middle C is C-5, value 61, and sounds as
 * MIDI note 60 — the same offset the pattern display uses (`utils/patternCellFormat.ts`).
 */
export function midiNoteForPatternNote(note: number): number | null {
  if (!Number.isInteger(note) || note < PATTERN_NOTE_MIN || note > PATTERN_NOTE_MAX) return null;
  return note - 1;
}
