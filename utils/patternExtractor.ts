// Pure function to extract a pattern matrix from a loaded libopenmpt module.
// Separated from useLibOpenMPT to keep the hook under 777 lines.

import { LibOpenMPT, PatternMatrix } from '../types';

export const DEFAULT_ROWS = 64;
export const DEFAULT_CHANNELS = 4;

/** Inclusive range of valid note-on values from libopenmpt command 0. */
const NOTE_VALID_MIN = 1;
const NOTE_VALID_MAX = 119;
/** Any note value ≥ NOTE_OFF_MIN is a note-off / note-cut / note-fade event
 *  (e.g. 254 = Note Cut, 255 = Note Off in many formats). */
const NOTE_OFF_MIN = 120;

export function getPatternMatrix(
  lib: LibOpenMPT,
  modPtr: number,
  patternIndex: number,
  orderIndex: number
): PatternMatrix {
  const numRows = lib._openmpt_module_get_pattern_num_rows(modPtr, patternIndex);
  const numChannels = lib._openmpt_module_get_num_channels(modPtr);
  const rows: any[][] = [];

  for (let r = 0; r < numRows; r++) {
    const rowData: any[] = [];
    for (let c = 0; c < numChannels; c++) {
      const rawNote   = lib._openmpt_module_get_pattern_row_channel_command(modPtr, patternIndex, r, c, 0);
      const rawInst   = lib._openmpt_module_get_pattern_row_channel_command(modPtr, patternIndex, r, c, 1);
      const rawVolCmd = lib._openmpt_module_get_pattern_row_channel_command(modPtr, patternIndex, r, c, 2);
      const rawVolVal = lib._openmpt_module_get_pattern_row_channel_command(modPtr, patternIndex, r, c, 3);
      const rawEffCmd = lib._openmpt_module_get_pattern_row_channel_command(modPtr, patternIndex, r, c, 4);
      const rawEffVal = lib._openmpt_module_get_pattern_row_channel_command(modPtr, patternIndex, r, c, 5);

      // Strict note classification
      const isNoteOn  = rawNote >= NOTE_VALID_MIN && rawNote <= NOTE_VALID_MAX;
      const isNoteOff = rawNote >= NOTE_OFF_MIN;   // note-cut (254), note-off (255), etc.
      const hasNote   = isNoteOn || isNoteOff;

      // Strict expression: volume effect column (cmd 2 > 0), effect column (cmd 4 > 0),
      // or arpeggio exception: cmd 4 == 0 with a non-zero parameter (cmd 5 > 0).
      const hasVolEffect  = rawVolCmd > 0;
      const hasEffect     = rawEffCmd > 0 || (rawEffCmd === 0 && rawEffVal > 0);
      const hasExpression = hasVolEffect || hasEffect;

      const type = (isNoteOn || isNoteOff) ? 'note'
                 : hasExpression           ? 'effect'
                 : 'empty';

      // Sanitize: zero out expression fields when they carry no explicit data.
      // This prevents libopenmpt's internal defaults from leaking into GPU buffers
      // and falsely triggering expression LEDs on empty cells.
      rowData.push({
        type,
        text: '',
        note:   hasNote      ? rawNote   : 0,
        inst:   rawInst,
        volCmd: hasVolEffect ? rawVolCmd : 0,
        volVal: hasVolEffect ? rawVolVal : 0,
        effCmd: hasEffect    ? rawEffCmd : 0,
        effVal: hasEffect    ? rawEffVal : 0,
      });
    }
    rows.push(rowData);
  }

  return { order: orderIndex, patternIndex, numRows, numChannels, rows };
}

/** Compute per-channel noteAge: how many rows ago the most recent note-on occurred.
 *  Returns an array where each entry is the age in rows (0 = current row).
 *  If no recent note-on is found, age defaults to 1000 (effectively "no note").
 */
export function computeNoteAges(matrix: PatternMatrix, playheadRow: number): number[] {
  const numChannels = matrix.numChannels;
  const numRows = matrix.numRows;
  const ages = new Array(numChannels).fill(1000);
  const row = Math.floor(playheadRow);

  for (let c = 0; c < numChannels; c++) {
    // Scan backwards from current row for most recent note-on
    for (let r = row; r >= 0; r--) {
      const cell = matrix.rows[r]?.[c];
      if (cell && cell.note && cell.note >= 1 && cell.note <= 96) {
        ages[c] = playheadRow - r;
        break;
      }
    }
    // If not found, scan wrap-around from bottom of pattern
    if (ages[c] === 1000) {
      for (let r = numRows - 1; r > row; r--) {
        const cell = matrix.rows[r]?.[c];
        if (cell && cell.note && cell.note >= 1 && cell.note <= 96) {
          ages[c] = playheadRow + (numRows - r);
          break;
        }
      }
    }
  }

  return ages;
}
