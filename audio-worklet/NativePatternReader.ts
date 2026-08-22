/**
 * Read pattern matrices from the native C++ worklet WASM (KEEPALIVE exports)
 * so module load does not instantiate a second wasm2js libopenmpt.
 */

import type { PatternCell, PatternMatrix, WorkerParseMetadata, WorkerParseResponse } from '../types';
import { extractInstrumentTable, mergeLibInstrumentNames } from '../utils/sampleExtract';
import type { EmscriptenOpenMPTModule, WorkletPatternData } from './types';

const NOTE_VALID_MIN = 1;
const NOTE_VALID_MAX = 119;
const NOTE_OFF_MIN = 120;

export interface NativePatternExports {
  _get_num_channels: () => number;
  _get_num_orders: () => number;
  _get_order_pattern: (order: number) => number;
  _get_pattern_num_rows: (pattern: number) => number;
  _get_pattern_row_channel_command: (
    pattern: number,
    row: number,
    channel: number,
    command: number,
  ) => number;
  _get_num_patterns?: () => number;
  _get_duration_seconds?: () => number;
  _get_initial_bpm?: () => number;
}

export function readPatternDataFromNative(
  m: NativePatternExports,
  patternIndex: number,
  numChannels: number,
): WorkletPatternData | null {
  if (typeof m._get_pattern_num_rows !== 'function') return null;

  const numRows = m._get_pattern_num_rows(patternIndex);
  if (numRows <= 0) return null;

  const rows = [];
  for (let r = 0; r < numRows; r++) {
    const notes: number[] = [];
    const instruments: number[] = [];
    const volCmds: number[] = [];
    const volVals: number[] = [];
    const effCmds: number[] = [];
    const effVals: number[] = [];
    for (let c = 0; c < numChannels; c++) {
      notes.push(m._get_pattern_row_channel_command(patternIndex, r, c, 0));
      instruments.push(m._get_pattern_row_channel_command(patternIndex, r, c, 1));
      volCmds.push(m._get_pattern_row_channel_command(patternIndex, r, c, 2));
      volVals.push(m._get_pattern_row_channel_command(patternIndex, r, c, 3));
      effCmds.push(m._get_pattern_row_channel_command(patternIndex, r, c, 4));
      effVals.push(m._get_pattern_row_channel_command(patternIndex, r, c, 5));
    }
    rows.push({ notes, instruments, volCmds, volVals, effCmds, effVals });
  }

  return { patternIndex, numRows, numChannels, rows };
}

export function workletPatternToMatrix(
  pd: WorkletPatternData,
  order: number,
): PatternMatrix {
  const rows: PatternCell[][] = pd.rows.map((row) =>
    Array.from({ length: pd.numChannels }, (_, c): PatternCell => {
      const rawNote = row.notes[c] ?? 0;
      const rawInst = row.instruments[c] ?? 0;
      const rawVolCmd = row.volCmds[c] ?? 0;
      const rawVolVal = row.volVals[c] ?? 0;
      const rawEffCmd = row.effCmds[c] ?? 0;
      const rawEffVal = row.effVals[c] ?? 0;
      const isNoteOn = rawNote >= NOTE_VALID_MIN && rawNote <= NOTE_VALID_MAX;
      const isNoteOff = rawNote >= NOTE_OFF_MIN;
      const hasNote = isNoteOn || isNoteOff;
      const hasVolEffect = rawVolCmd > 0;
      const hasEffect = rawEffCmd > 0 || (rawEffCmd === 0 && rawEffVal > 0);
      const hasExpression = hasVolEffect || hasEffect;
      const type = (isNoteOn || isNoteOff) ? 'note' : hasExpression ? 'effect' : 'empty';
      return {
        type,
        text: '',
        note: hasNote ? rawNote : 0,
        inst: rawInst,
        volCmd: hasVolEffect ? rawVolCmd : 0,
        volVal: hasVolEffect ? rawVolVal : 0,
        effCmd: hasEffect ? rawEffCmd : 0,
        effVal: hasEffect ? rawEffVal : 0,
      };
    }),
  );
  return {
    order,
    patternIndex: pd.patternIndex,
    numRows: pd.numRows,
    numChannels: pd.numChannels,
    rows,
  };
}

export function extractMatricesFromNative(
  m: NativePatternExports,
  maxOrders?: number,
): { matrices: PatternMatrix[]; numOrders: number; numChannels: number } {
  const numOrders = m._get_num_orders();
  const numChannels = m._get_num_channels();
  const limit = maxOrders != null ? Math.min(numOrders, maxOrders) : numOrders;
  const matrices: PatternMatrix[] = [];
  for (let order = 0; order < limit; order++) {
    const patternIndex = m._get_order_pattern(order);
    const pd = readPatternDataFromNative(m, patternIndex, numChannels);
    if (pd) {
      matrices.push(workletPatternToMatrix(pd, order));
    }
  }
  return { matrices, numOrders, numChannels };
}

export function parseModuleWithNative(
  module: EmscriptenOpenMPTModule,
  fileData: Uint8Array,
  fileName: string,
): WorkerParseResponse {
  const { matrices, numOrders, numChannels } = extractMatricesFromNative(module);
  if (!matrices.length) {
    throw new Error('No pattern data in module');
  }
  let totalPatternRows = 0;
  for (const matrix of matrices) {
    totalPatternRows += matrix.numRows;
  }
  const durationSeconds = typeof module._get_duration_seconds === 'function'
    ? module._get_duration_seconds()
    : 0;
  const initialBpm = typeof module._get_initial_bpm === 'function'
    ? module._get_initial_bpm()
    : 125;
  const metadata: WorkerParseMetadata = {
    title: fileName,
    numOrders,
    numChannels,
    initialBpm: Number.isFinite(initialBpm) && initialBpm > 0 ? initialBpm : 125,
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : 0,
    totalPatternRows,
    numInstruments: 0,
    instruments: [],
    numSamples: 0,
    samples: [],
    format: '',
    comments: '',
  };
  return {
    type: 'parsed',
    patternMatrices: matrices,
    metadata,
    instrumentTable: mergeLibInstrumentNames(
      extractInstrumentTable(fileData, fileName),
      metadata.instruments,
    ),
  };
}
