// Pure function to extract a pattern matrix from a loaded libopenmpt module.
// Separated from useLibOpenMPT to keep the hook under 777 lines.

import { LibOpenMPT, PatternCell, PatternMatrix } from '../types';
import { PatternCommand } from './openmptCommands';
import { PATTERN_CELL_BYTES, type PatternDump } from './moduleInspect';

export const DEFAULT_ROWS = 64;
export const DEFAULT_CHANNELS = 4;

/** Inclusive range of valid note-on values from libopenmpt command 0. */
const NOTE_VALID_MIN = 1;
const NOTE_VALID_MAX = 119;
/** Any note value ≥ NOTE_OFF_MIN is a note-off / note-cut / note-fade event
 *  (e.g. 254 = Note Cut, 255 = Note Off in many formats). */
const NOTE_OFF_MIN = 120;

/**
 * One cell from libopenmpt's six raw command values (PatternCommand order). Shared by the dump path
 * and the 6-call reference path so both classify and sanitize identically.
 */
export function patternCellFromRaw(
  rawNote: number,
  rawInst: number,
  rawVolCmd: number,
  rawEffCmd: number,
  rawVolVal: number,
  rawEffVal: number,
): PatternCell {
  // Strict note classification
  const isNoteOn  = rawNote >= NOTE_VALID_MIN && rawNote <= NOTE_VALID_MAX;
  const isNoteOff = rawNote >= NOTE_OFF_MIN;   // note-cut (254), note-off (255), etc.
  const hasNote   = isNoteOn || isNoteOff;

  // Strict expression: a volume-column command (VolumeCommand > VOLCMD_NONE) or an effect
  // (EffectCommand > CMD_NONE). Arpeggio is CMD_ARPEGGIO, so a parameter without a command is
  // not an effect: libopenmpt keeps the parameter byte of a command it dropped (an XM effect
  // with no mapping reads back as CMD_NONE + param), and that must not light an effect LED
  // or reach a writer as "arpeggio".
  const hasVolEffect  = rawVolCmd > 0;
  const hasEffect     = rawEffCmd > 0;
  const hasExpression = hasVolEffect || hasEffect;

  const type = hasNote       ? 'note'
             : hasExpression ? 'effect'
             : 'empty';

  // Sanitize: zero out expression fields when they carry no explicit data.
  // This prevents libopenmpt's internal defaults from leaking into GPU buffers
  // and falsely triggering expression LEDs on empty cells.
  return {
    type,
    text: '',
    note:   hasNote      ? rawNote   : 0,
    inst:   rawInst,
    volCmd: hasVolEffect ? rawVolCmd : 0,
    volVal: hasVolEffect ? rawVolVal : 0,
    effCmd: hasEffect    ? rawEffCmd : 0,
    effVal: hasEffect    ? rawEffVal : 0,
  };
}

/**
 * A pattern from an `xasm_pattern_dump` (utils/moduleInspect.ts): one wasm call for the whole
 * pattern, cells as PATTERN_CELL_BYTES bytes in PatternCommand order.
 */
export function patternMatrixFromDump(dump: PatternDump, orderIndex: number): PatternMatrix {
  const { rows: numRows, channels: numChannels, cells } = dump;
  const rows: PatternCell[][] = [];
  let o = 0;
  for (let r = 0; r < numRows; r++) {
    const rowData: PatternCell[] = [];
    for (let c = 0; c < numChannels; c++, o += PATTERN_CELL_BYTES) {
      rowData.push(patternCellFromRaw(
        cells[o + PatternCommand.NOTE]!,
        cells[o + PatternCommand.INSTRUMENT]!,
        cells[o + PatternCommand.VOLUMEEFFECT]!,
        cells[o + PatternCommand.EFFECT]!,
        cells[o + PatternCommand.VOLUME]!,
        cells[o + PatternCommand.PARAMETER]!,
      ));
    }
    rows.push(rowData);
  }
  return { order: orderIndex, patternIndex: dump.pattern, numRows, numChannels, rows };
}

/**
 * The reference path: six `openmpt_module_get_pattern_row_channel_command` calls per cell on a C API
 * module. The parse uses `patternMatrixFromDump`; this stays as its test oracle and as the fallback
 * for a glue without the inspection shim.
 */
export function getPatternMatrix(
  lib: LibOpenMPT,
  modPtr: number,
  patternIndex: number,
  orderIndex: number
): PatternMatrix {
  const numRows = lib._openmpt_module_get_pattern_num_rows(modPtr, patternIndex);
  const numChannels = lib._openmpt_module_get_num_channels(modPtr);
  const command = lib._openmpt_module_get_pattern_row_channel_command;
  const rows: PatternCell[][] = [];

  for (let r = 0; r < numRows; r++) {
    const rowData: PatternCell[] = [];
    for (let c = 0; c < numChannels; c++) {
      rowData.push(patternCellFromRaw(
        command(modPtr, patternIndex, r, c, PatternCommand.NOTE),
        command(modPtr, patternIndex, r, c, PatternCommand.INSTRUMENT),
        command(modPtr, patternIndex, r, c, PatternCommand.VOLUMEEFFECT),
        command(modPtr, patternIndex, r, c, PatternCommand.EFFECT),
        command(modPtr, patternIndex, r, c, PatternCommand.VOLUME),
        command(modPtr, patternIndex, r, c, PatternCommand.PARAMETER),
      ));
    }
    rows.push(rowData);
  }

  return { order: orderIndex, patternIndex, numRows, numChannels, rows };
}

/** Compute per-channel noteAge: how many rows ago the most recent note-on occurred.
 *  Returns an array where each entry is the age in rows (0 = current row).
 *  If no recent note-on is found, age defaults to 1000 (effectively "no note").
 *
 *  Pass `out` to reuse a scratch array and avoid per-frame allocation (pattern
 *  changes already thrash GC with matrix packing — this keeps the RAF path tight).
 */
export function computeNoteAges(
  matrix: PatternMatrix,
  playheadRow: number,
  out?: number[],
): number[] {
  const numChannels = matrix.numChannels;
  const numRows = matrix.numRows;
  const ages = out && out.length === numChannels ? out : new Array(numChannels);
  for (let c = 0; c < numChannels; c++) {
    ages[c] = 1000;
  }
  const row = Math.floor(playheadRow);

  for (let c = 0; c < numChannels; c++) {
    // Scan backwards from current row for most recent note-on
    for (let r = row; r >= 0; r--) {
      const cell = matrix.rows[r]?.[c];
      if (cell && cell.note && cell.note >= NOTE_VALID_MIN && cell.note <= NOTE_VALID_MAX) {
        ages[c] = playheadRow - r;
        break;
      }
    }
    // If not found, scan wrap-around from bottom of pattern
    if (ages[c] === 1000) {
      for (let r = numRows - 1; r > row; r--) {
        const cell = matrix.rows[r]?.[c];
        if (cell && cell.note && cell.note >= NOTE_VALID_MIN && cell.note <= NOTE_VALID_MAX) {
          ages[c] = playheadRow + (numRows - r);
          break;
        }
      }
    }
  }

  return ages;
}
