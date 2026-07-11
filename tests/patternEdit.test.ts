import { describe, expect, it } from 'vitest';
import {
  applyCellPatch,
  clonePatternMatrix,
  cycleNoteValue,
  normalizePatternCell,
  noteToText,
} from '../utils/patternEdit';
import type { PatternMatrix } from '../types';

function makeMatrix(): PatternMatrix {
  return {
    order: 0,
    patternIndex: 0,
    numRows: 4,
    numChannels: 2,
    rows: Array.from({ length: 4 }, () =>
      Array.from({ length: 2 }, () => ({ type: 'empty' as const, text: '' })),
    ),
  };
}

describe('patternEdit', () => {
  it('cycles notes from empty to C-4', () => {
    expect(cycleNoteValue(0)).toBe(49);
    expect(noteToText(49)).toBe('C-4');
  });

  it('applies a note patch immutably', () => {
    const matrix = makeMatrix();
    const next = applyCellPatch(matrix, 1, 0, { note: 49 });
    expect(next).not.toBe(matrix);
    expect(next.rows[1]?.[0]?.note).toBe(49);
    expect(matrix.rows[1]?.[0]?.note).toBeUndefined();
  });

  it('clears a cell', () => {
    const matrix = applyCellPatch(makeMatrix(), 0, 0, { note: 49 });
    const cleared = applyCellPatch(matrix, 0, 0, { clear: true });
    expect(cleared.rows[0]?.[0]).toEqual({ type: 'empty', text: '' });
  });

  it('clonePatternMatrix is deep', () => {
    const matrix = applyCellPatch(makeMatrix(), 0, 0, { note: 50 });
    const clone = clonePatternMatrix(matrix);
    clone.rows[0]![0]!.note = 60;
    expect(matrix.rows[0]?.[0]?.note).toBe(50);
  });

  it('normalizePatternCell sets text from note', () => {
    const cell = normalizePatternCell({ type: 'empty', text: '', note: 49 });
    expect(cell.type).toBe('note');
    expect(cell.text).toBe('C-4');
  });
});
