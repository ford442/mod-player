import { describe, expect, it } from 'vitest';
import { computeNoteAges } from '../utils/patternExtractor';
import { packPatternMatrixHighPrecision } from '../utils/gpuPacking';
import { getCell, makeMatrix } from './helpers/patternMatrix';

/** Mirror shader wrap + noteRelativeAge = delta + rowOffset. */
function noteRelativeAge(playhead: number, cellRow: number, rowOffset: number, numRows: number): number {
  const playheadStep = playhead - Math.floor(playhead / numRows) * numRows;
  let delta = playheadStep - cellRow;
  if (delta < -numRows * 0.5) delta += numRows;
  else if (delta > numRows * 0.5) delta -= numRows;
  return delta + rowOffset;
}

describe('computeNoteAges ↔ v0.30b sounding arc', () => {
  it('matches trigger and sustain cells at fractional playhead', () => {
    const mat = makeMatrix(8, [[
      { note: 60 },
      {},
      {},
      { note: 120 },
      {},
      {},
      {},
      {},
    ]]);

    const playhead = 2.35;
    const ages = computeNoteAges(mat, playhead);
    expect(ages[0]).toBeCloseTo(playhead, 5);

    const { packedData } = packPatternMatrixHighPrecision(mat);
    const trigger = getCell(packedData, 0, 0, 1);
    const sustain = getCell(packedData, 2, 0, 1);

    expect(trigger.duration).toBe(4);
    expect(sustain.rowOffset).toBe(2);

    const triggerAge = noteRelativeAge(playhead, 0, trigger.rowOffset, 8);
    const sustainAge = noteRelativeAge(playhead, 2, sustain.rowOffset, 8);
    expect(Math.abs(triggerAge - ages[0]!)).toBeLessThan(1.25);
    expect(Math.abs(sustainAge - ages[0]!)).toBeLessThan(1.25);
  });

  it('wraps pattern boundary for note-on before playhead', () => {
    const mat = makeMatrix(64, [[
      ...Array(62).fill({}),
      { note: 60 },
      {},
    ]]);

    const playhead = 1.5;
    const ages = computeNoteAges(mat, playhead);
    // Note at row 62 → age = 1.5 + (64 - 62) = 3.5
    expect(ages[0]).toBeCloseTo(3.5, 5);

    const { packedData } = packPatternMatrixHighPrecision(mat);
    const sustain = getCell(packedData, 63, 0, 1);
    const sustainAge = noteRelativeAge(playhead, 63, sustain.rowOffset, 64);
    expect(Math.abs(sustainAge - ages[0]!)).toBeLessThan(1.25);
  });

  it('defaults to 1000 when no recent note-on', () => {
    const mat = makeMatrix(8, [[{}, {}, {}, {}, {}, {}, {}, {}]]);
    const ages = computeNoteAges(mat, 4.2);
    expect(ages[0]).toBe(1000);
  });
});
