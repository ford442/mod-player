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
