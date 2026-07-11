import type { PatternCell, PatternMatrix } from '../../types';

export type CellSpec = {
  note?: number;
  inst?: number;
  volCmd?: number;
  volVal?: number;
  effCmd?: number;
  effVal?: number;
};

export function makeMatrix(numRows: number, channelRows: CellSpec[][]): PatternMatrix {
  const numChannels = channelRows.length;
  const rows: PatternCell[][] = [];
  for (let r = 0; r < numRows; r++) {
    const row: PatternCell[] = [];
    for (let c = 0; c < numChannels; c++) {
      const spec = channelRows[c]?.[r] ?? {};
      const note = spec.note ?? 0;
      row.push({
        type: note > 0 ? 'note' : 'empty',
        text: '',
        note,
        inst: spec.inst ?? (note > 0 ? 1 : 0),
        volCmd: spec.volCmd ?? 0,
        volVal: spec.volVal ?? 0,
        effCmd: spec.effCmd ?? 0,
        effVal: spec.effVal ?? 0,
      });
    }
    rows.push(row);
  }
  return { order: 0, patternIndex: 0, numRows, numChannels, rows };
}

export interface UnpackedCell {
  note: number;
  inst: number;
  duration: number;
  volPacked: number;
  effCmd: number;
  effVal: number;
  rowOffset: number;
  isNoteOff: number;
  volCmd: number;
}

export function unpackCell(pa: number, pb: number): UnpackedCell {
  const note = (pa >>> 24) & 0xff;
  const inst = (pa >>> 16) & 0xff;
  const duration = (pa >>> 8) & 0xff;
  const volPacked = pa & 0xff;
  const effCmd = (pb >>> 24) & 0xff;
  const effVal = (pb >>> 16) & 0xff;
  const durFlags = (pb >>> 8) & 0x7f;
  const volCmd = pb & 0xff;
  const rowOffset = (durFlags >> 1) & 0x3f;
  const isNoteOff = durFlags & 1;
  return { note, inst, duration, volPacked, effCmd, effVal, rowOffset, isNoteOff, volCmd };
}

export function getCell(
  packed: Uint32Array,
  row: number,
  ch: number,
  numChannels: number,
): UnpackedCell {
  const idx = (row * numChannels + ch) * 2;
  return unpackCell(packed[idx]!, packed[idx + 1]!);
}
