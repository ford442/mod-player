import { describe, expect, it } from 'vitest';
import {
  applyCellPatch,
  applyHexDigit,
  clonePatternMatrix,
  cycleNoteValue,
  fieldDigitWidth,
  matricesEqual,
  MAX_UNDO_STEPS,
  nextEditField,
  normalizePatternCell,
  noteToText,
  parseHexDigit,
  patchFromHexBuffer,
} from '../utils/patternEdit';
import {
  PATTERN_DUMP_VERSION,
  patternDumpFileName,
  serializePatternDump,
} from '../utils/patternDump';
import { packPatternMatrixHighPrecision } from '../utils/gpuPacking';
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

  it('caps undo snapshot stack at MAX_UNDO_STEPS', () => {
    let stack: PatternMatrix[] = [];
    let matrix = makeMatrix();
    for (let i = 0; i < 55; i++) {
      stack = [...stack, clonePatternMatrix(matrix)].slice(-MAX_UNDO_STEPS);
      matrix = applyCellPatch(matrix, 0, 0, { note: 49 + i });
    }
    expect(stack.length).toBe(MAX_UNDO_STEPS);
    expect(stack[0]?.rows[0]?.[0]?.note).toBe(49 + (55 - MAX_UNDO_STEPS - 1));
    expect(stack[MAX_UNDO_STEPS - 1]?.rows[0]?.[0]?.note).toBe(49 + 53);
  });

  it('edited matrix repacks differently for GPU upload', () => {
    const matrix = makeMatrix();
    const edited = applyCellPatch(matrix, 0, 0, { note: 60 });
    const { packedData: before } = packPatternMatrixHighPrecision(matrix, false);
    const { packedData: after } = packPatternMatrixHighPrecision(edited, false);
    expect(after).not.toEqual(before);
    expect(after[0]).not.toBe(before[0]);
  });

  it('matricesEqual detects edits and matches clones', () => {
    const baseline = makeMatrix();
    const edited = applyCellPatch(baseline, 0, 0, { note: 49 });
    expect(matricesEqual(baseline, edited)).toBe(false);
    expect(matricesEqual(edited, clonePatternMatrix(edited))).toBe(true);
    expect(matricesEqual(null, null)).toBe(true);
    expect(matricesEqual(baseline, null)).toBe(false);
  });

  it('Tab field order cycles note → inst → vol → eff', () => {
    expect(nextEditField('note', 1)).toBe('inst');
    expect(nextEditField('eff', 1)).toBe('note');
    expect(nextEditField('note', -1)).toBe('eff');
    expect(fieldDigitWidth('note')).toBe(0);
    expect(fieldDigitWidth('inst')).toBe(2);
    expect(fieldDigitWidth('vol')).toBe(2);
    expect(fieldDigitWidth('eff')).toBe(3);
  });

  it('hex nibble entry commits inst/vol/eff patches', () => {
    expect(parseHexDigit('A')).toBe('a');
    expect(parseHexDigit('z')).toBeNull();

    const instPartial = applyHexDigit('inst', '', '1');
    expect(instPartial.done).toBe(false);
    expect(instPartial.buffer).toBe('1');
    const instDone = applyHexDigit('inst', '1', 'a');
    expect(instDone.done).toBe(true);
    expect(instDone.patch).toEqual({ inst: 0x1a });

    const volDone = applyHexDigit('vol', '4', '0');
    expect(volDone.patch).toEqual({ volCmd: 0xc, volVal: 0x40 });

    const volClear = applyHexDigit('vol', '0', '0');
    expect(volClear.patch).toEqual({ volCmd: 0, volVal: 0 });

    const effDone = applyHexDigit('eff', 'c4', '0');
    expect(effDone.patch).toEqual({ effCmd: 0xc, effVal: 0x40 });

    expect(patchFromHexBuffer('inst', '2f')).toEqual({ inst: 0x2f });
    expect(patchFromHexBuffer('eff', 'a0f')).toEqual({ effCmd: 0xa, effVal: 0x0f });
  });

  it('hex patches apply through applyCellPatch', () => {
    const matrix = makeMatrix();
    const withInst = applyCellPatch(matrix, 0, 0, applyHexDigit('inst', '0', '5').patch!);
    expect(withInst.rows[0]?.[0]?.inst).toBe(5);
    const withEff = applyCellPatch(withInst, 0, 0, applyHexDigit('eff', '10', '1').patch!);
    expect(withEff.rows[0]?.[0]?.effCmd).toBe(0x1);
    expect(withEff.rows[0]?.[0]?.effVal).toBe(0x01);
  });
});

describe('patternDump', () => {
  it('serializes a round-trippable dump payload', () => {
    const matrix = applyCellPatch(makeMatrix(), 1, 0, { note: 49, inst: 2 });
    const dump = serializePatternDump(matrix, { moduleFileName: 'demo.xm' });
    expect(dump.version).toBe(PATTERN_DUMP_VERSION);
    expect(dump.moduleFileName).toBe('demo.xm');
    expect(dump.order).toBe(0);
    expect(dump.numRows).toBe(4);
    expect(dump.rows[1]?.[0]?.note).toBe(49);
    expect(dump.rows[1]?.[0]?.inst).toBe(2);
    // Mutating dump rows must not affect source matrix
    dump.rows[1]![0]!.note = 60;
    expect(matrix.rows[1]?.[0]?.note).toBe(49);
  });

  it('builds a stable download filename', () => {
    expect(patternDumpFileName('my song.xm', 3)).toBe('my_song-pattern-o3.json');
    expect(patternDumpFileName(undefined, 0)).toBe('pattern-pattern-o0.json');
  });
});
