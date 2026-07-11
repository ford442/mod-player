import type { PatternCell, PatternMatrix } from '../types';

export const NOTE_NAMES = [
  'C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-',
] as const;

export const MAX_UNDO_STEPS = 50;

export type PatternEditField = 'note' | 'inst' | 'vol' | 'eff';

export interface PatternCellPatch {
  note?: number;
  inst?: number;
  volCmd?: number;
  volVal?: number;
  effCmd?: number;
  effVal?: number;
  clear?: boolean;
}

export function clonePatternMatrix(matrix: PatternMatrix): PatternMatrix {
  return {
    ...matrix,
    rows: matrix.rows.map((row) =>
      row.map((cell) => ({ ...cell })),
    ),
  };
}

export function noteToText(note: number): string {
  if (note <= 0 || note > 119) return '';
  const noteIndex = (note - 1) % 12;
  const octave = Math.floor((note - 1) / 12);
  return `${NOTE_NAMES[noteIndex]}${octave}`;
}

export function normalizePatternCell(cell: PatternCell): PatternCell {
  const note = cell.note ?? 0;
  const inst = cell.inst ?? 0;
  const volCmd = cell.volCmd ?? 0;
  const volVal = cell.volVal ?? 0;
  const effCmd = cell.effCmd ?? 0;
  const effVal = cell.effVal ?? 0;

  const isNoteOn = note >= 1 && note <= 119;
  const isNoteOff = note >= 120;
  const hasNote = isNoteOn || isNoteOff;
  const hasVolEffect = volCmd > 0;
  const hasEffect = effCmd > 0 || (effCmd === 0 && effVal > 0);
  const hasExpression = hasVolEffect || hasEffect;

  const type: PatternCell['type'] = (isNoteOn || isNoteOff)
    ? 'note'
    : hasExpression
      ? 'effect'
      : inst > 0
        ? 'instrument'
        : 'empty';

  return {
    type,
    text: hasNote ? noteToText(note) : '',
    note: hasNote ? note : 0,
    inst,
    volCmd: hasVolEffect ? volCmd : 0,
    volVal: hasVolEffect ? volVal : 0,
    effCmd: hasEffect ? effCmd : 0,
    effVal: hasEffect ? effVal : 0,
  };
}

export function applyCellPatch(
  matrix: PatternMatrix,
  row: number,
  channel: number,
  patch: PatternCellPatch,
): PatternMatrix {
  if (row < 0 || row >= matrix.numRows || channel < 0 || channel >= matrix.numChannels) {
    return matrix;
  }

  const next = clonePatternMatrix(matrix);
  const current = next.rows[row]?.[channel] ?? { type: 'empty', text: '' };
  const merged: PatternCell = patch.clear
    ? { type: 'empty', text: '' }
    : normalizePatternCell({
      ...current,
      ...patch,
    });

  const rowCells = [...(next.rows[row] ?? [])];
  while (rowCells.length < matrix.numChannels) {
    rowCells.push({ type: 'empty', text: '' });
  }
  rowCells[channel] = merged;
  next.rows[row] = rowCells;
  return next;
}

/** Click-cycle notes: empty → C-4 (49) → … → B-5 → empty */
export function cycleNoteValue(current: number): number {
  const start = 49; // C-4
  const end = 72;   // B-5
  if (current <= 0 || current > end) return start;
  if (current >= end) return 0;
  return current + 1;
}

export function cycleInstrument(current: number): number {
  if (current <= 0) return 1;
  if (current >= 31) return 0;
  return current + 1;
}

export function cycleVolume(currentCmd: number, currentVal: number): { volCmd: number; volVal: number } {
  if (currentCmd <= 0) return { volCmd: 0xC, volVal: 0x40 };
  if (currentVal >= 0x40) return { volCmd: 0, volVal: 0 };
  return { volCmd: currentCmd, volVal: currentVal + 0x10 };
}

export function cycleEffect(currentCmd: number, currentVal: number): { effCmd: number; effVal: number } {
  if (currentCmd <= 0 && currentVal <= 0) return { effCmd: 0x0, effVal: 0x01 };
  if (currentCmd === 0 && currentVal < 0x0F) return { effCmd: 0, effVal: currentVal + 1 };
  if (currentCmd < 0x0F) return { effCmd: currentCmd + 1, effVal: 0x00 };
  return { effCmd: 0, effVal: 0 };
}

export function patchFromFieldCycle(
  field: PatternEditField,
  cell: PatternCell,
): PatternCellPatch {
  switch (field) {
    case 'note':
      return { note: cycleNoteValue(cell.note ?? 0) };
    case 'inst':
      return { inst: cycleInstrument(cell.inst ?? 0) };
    case 'vol': {
      const next = cycleVolume(cell.volCmd ?? 0, cell.volVal ?? 0);
      return { volCmd: next.volCmd, volVal: next.volVal };
    }
    case 'eff': {
      const next = cycleEffect(cell.effCmd ?? 0, cell.effVal ?? 0);
      return { effCmd: next.effCmd, effVal: next.effVal };
    }
    default:
      return {};
  }
}

/** Map keyboard note keys to semitone offset from C (QWERTY row). */
const KEY_NOTE_OFFSET: Record<string, number> = {
  z: 0, s: 1, x: 2, d: 3, c: 4, v: 5, g: 6, b: 7, h: 8, n: 9, j: 10, m: 11,
  q: 0, w: 2, e: 4, r: 5, t: 7, y: 9, u: 11,
};

export function noteFromKeyboard(key: string, baseOctave = 4): number | null {
  const offset = KEY_NOTE_OFFSET[key.toLowerCase()];
  if (offset === undefined) return null;
  const note = 1 + baseOctave * 12 + offset;
  return note >= 1 && note <= 119 ? note : null;
}

export function matricesEqual(a: PatternMatrix | null, b: PatternMatrix | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.numRows !== b.numRows || a.numChannels !== b.numChannels) return false;
  for (let r = 0; r < a.numRows; r++) {
    for (let c = 0; c < a.numChannels; c++) {
      const ca = a.rows[r]?.[c];
      const cb = b.rows[r]?.[c];
      if (!ca || !cb) return false;
      if (
        ca.note !== cb.note
        || ca.inst !== cb.inst
        || ca.volCmd !== cb.volCmd
        || ca.volVal !== cb.volVal
        || ca.effCmd !== cb.effCmd
        || ca.effVal !== cb.effVal
      ) {
        return false;
      }
    }
  }
  return true;
}
