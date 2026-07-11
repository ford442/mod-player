import { describe, expect, it, vi } from 'vitest';
import { packPatternMatrixHighPrecision } from '../utils/gpuPacking';
import { getCell, makeMatrix } from './helpers/patternMatrix';

vi.stubEnv('DEV', true);

describe('duration parity (DURA-001 CPU path)', () => {
  it('T1: note sustains to end of pattern', () => {
    const mat = makeMatrix(8, [[
      { note: 60 },
      ...Array(7).fill({}),
    ]]);

    const { packedData } = packPatternMatrixHighPrecision(mat);

    let c = getCell(packedData, 0, 0, 1);
    expect(c.duration).toBe(8);
    expect(c.rowOffset).toBe(0);
    expect(c.isNoteOff).toBe(0);

    c = getCell(packedData, 4, 0, 1);
    expect(c.duration).toBe(8);
    expect(c.rowOffset).toBe(4);
    expect(c.isNoteOff).toBe(0);

    c = getCell(packedData, 7, 0, 1);
    expect(c.duration).toBe(8);
    expect(c.rowOffset).toBe(7);
  });

  it('T2: note cut by following note', () => {
    const mat = makeMatrix(8, [[
      { note: 60 },
      {}, {}, {},
      { note: 64 },
      {}, {}, {},
    ]]);

    const { packedData } = packPatternMatrixHighPrecision(mat);

    let c = getCell(packedData, 0, 0, 1);
    expect(c.duration).toBe(4);
    expect(c.rowOffset).toBe(0);

    c = getCell(packedData, 3, 0, 1);
    expect(c.duration).toBe(4);
    expect(c.rowOffset).toBe(3);
    expect(c.isNoteOff).toBe(0);

    c = getCell(packedData, 4, 0, 1);
    expect(c.duration).toBe(4);
    expect(c.rowOffset).toBe(0);
  });

  it('T3: explicit note-off', () => {
    const NOTE_OFF = 255;
    const mat = makeMatrix(8, [[
      { note: 60 },
      {}, {},
      { note: NOTE_OFF },
      {}, {}, {}, {},
    ]]);

    const { packedData } = packPatternMatrixHighPrecision(mat);

    let c = getCell(packedData, 0, 0, 1);
    expect(c.duration).toBe(4);
    expect(c.isNoteOff).toBe(0);

    c = getCell(packedData, 3, 0, 1);
    expect(c.duration).toBe(4);
    expect(c.rowOffset).toBe(3);
    expect(c.isNoteOff).toBe(1);

    c = getCell(packedData, 4, 0, 1);
    expect(c.duration).toBe(1);
    expect(c.rowOffset).toBe(0);
  });

  it('T4: ECx terminates note', () => {
    const ECx = { effCmd: 14, effVal: 0xc3 };
    const mat = makeMatrix(8, [[
      { note: 60 },
      {}, {},
      { ...ECx },
      {}, {}, {}, {},
    ]]);

    const { packedData } = packPatternMatrixHighPrecision(mat);

    let c = getCell(packedData, 0, 0, 1);
    expect(c.duration).toBe(4);

    c = getCell(packedData, 3, 0, 1);
    expect(c.duration).toBe(4);
    expect(c.rowOffset).toBe(3);
    expect(c.isNoteOff).toBe(1);

    c = getCell(packedData, 4, 0, 1);
    expect(c.duration).toBe(1);
    expect(c.rowOffset).toBe(0);
  });

  it('T5: ECx on note-on row = no tail', () => {
    const mat = makeMatrix(8, [[
      { note: 60, effCmd: 14, effVal: 0xc2 },
      {}, {}, {}, {}, {}, {}, {},
    ]]);

    const { packedData } = packPatternMatrixHighPrecision(mat);

    let c = getCell(packedData, 0, 0, 1);
    expect(c.duration).toBe(1);
    expect(c.rowOffset).toBe(0);

    c = getCell(packedData, 1, 0, 1);
    expect(c.duration).toBe(1);
    expect(c.rowOffset).toBe(0);
  });

  it('T6: volume-off (C00) terminates note', () => {
    const mat = makeMatrix(8, [[
      { note: 60 },
      {}, {},
      { volCmd: 0xc0, volVal: 0 },
      {}, {}, {}, {},
    ]]);

    const { packedData } = packPatternMatrixHighPrecision(mat);

    let c = getCell(packedData, 0, 0, 1);
    expect(c.duration).toBe(4);

    c = getCell(packedData, 3, 0, 1);
    expect(c.isNoteOff).toBe(1);

    c = getCell(packedData, 4, 0, 1);
    expect(c.duration).toBe(1);
  });

  it('T7: standalone note-off', () => {
    const mat = makeMatrix(8, [[
      {}, {}, {},
      { note: 255 },
      {}, {}, {}, {},
    ]]);

    const { packedData } = packPatternMatrixHighPrecision(mat);

    const c = getCell(packedData, 3, 0, 1);
    expect(c.isNoteOff).toBe(1);
    expect(c.duration).toBe(1);
    expect(c.rowOffset).toBe(0);
  });

  it('T8: short pattern, duration clamped to pattern length', () => {
    const mat = makeMatrix(16, [[
      { note: 60 },
      ...Array(15).fill({}),
    ]]);

    const { packedData } = packPatternMatrixHighPrecision(mat);

    let c = getCell(packedData, 0, 0, 1);
    expect(c.duration).toBe(16);

    c = getCell(packedData, 15, 0, 1);
    expect(c.rowOffset).toBe(15);
    expect(c.duration).toBe(16);
  });

  it('T9: sustain duration clamped to 255, offset clamped to 63', () => {
    const NUM_ROWS = 300;
    const channelRows = [{ note: 60 }, ...Array(NUM_ROWS - 1).fill({})];
    const mat = makeMatrix(NUM_ROWS, [channelRows]);

    const { packedData } = packPatternMatrixHighPrecision(mat);

    let c = getCell(packedData, 0, 0, 1);
    expect(c.duration).toBe(255);

    c = getCell(packedData, 63, 0, 1);
    expect(c.rowOffset).toBe(63);

    c = getCell(packedData, 100, 0, 1);
    expect(c.rowOffset).toBe(63);
  });

  it('T10: multi-channel independence', () => {
    const NUM_ROWS = 8;
    const ch0Rows = [{ note: 60 }, {}, {}, {}, { note: 62 }, {}, {}, {}];
    const ch1Rows = [{}, {}, { note: 64 }, {}, {}, {}, {}, {}];

    const mat = makeMatrix(NUM_ROWS, [ch0Rows, ch1Rows]);
    const { packedData } = packPatternMatrixHighPrecision(mat);

    let c = getCell(packedData, 0, 0, 2);
    expect(c.duration).toBe(4);

    c = getCell(packedData, 3, 0, 2);
    expect(c.rowOffset).toBe(3);

    c = getCell(packedData, 2, 1, 2);
    expect(c.duration).toBe(6);
    expect(c.rowOffset).toBe(0);

    c = getCell(packedData, 5, 1, 2);
    expect(c.rowOffset).toBe(3);
  });

  it('T11: DURA-003 note pitch propagated to sustain tail', () => {
    const mat = makeMatrix(4, [[
      { note: 60, inst: 5 },
      {}, {}, {},
    ]]);

    const { packedData } = packPatternMatrixHighPrecision(mat);

    let c = getCell(packedData, 0, 0, 1);
    expect(c.note).toBe(60);

    c = getCell(packedData, 1, 0, 1);
    expect(c.note).toBe(60);

    c = getCell(packedData, 2, 0, 1);
    expect(c.note).toBe(60);
  });

  it('T12: expression-only flag', () => {
    const mat = makeMatrix(4, [[
      { effCmd: 4, effVal: 0x50 },
      {}, {}, {},
    ]]);

    const { packedData } = packPatternMatrixHighPrecision(mat);

    const c = getCell(packedData, 0, 0, 1);
    expect(c.inst & 0x80).not.toBe(0);
    expect(c.duration).toBe(1);
  });

  it('T13: padTopChannel inserts empty channel 0', () => {
    const mat = makeMatrix(4, [[
      { note: 60 }, {}, {}, {},
    ]]);

    const { packedData: unpadded } = packPatternMatrixHighPrecision(mat, false);
    const { packedData: padded } = packPatternMatrixHighPrecision(mat, true);

    for (let r = 0; r < 4; r++) {
      const idx = (r * 2 + 0) * 2;
      expect(padded[idx]).toBe(0);
      expect(padded[idx + 1]).toBe(0);
    }

    for (let r = 0; r < 4; r++) {
      const paddedIdx = (r * 2 + 1) * 2;
      const unpaddedIdx = (r * 1 + 0) * 2;
      expect(padded[paddedIdx]).toBe(unpadded[unpaddedIdx]);
      expect(padded[paddedIdx + 1]).toBe(unpadded[unpaddedIdx + 1]);
    }
  });
});
