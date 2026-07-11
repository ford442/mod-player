import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  packPatternMatrix,
  packPatternMatrixHighPrecision,
} from '../utils/gpuPacking';
import type { PatternCell, PatternMatrix } from '../types';
import { getCell, makeMatrix, unpackCell } from './helpers/patternMatrix';

vi.stubEnv('DEV', true);

describe('gpuPacking', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('packs valid matrices without buffer size mismatch errors', () => {
    const mockMatrix: PatternMatrix = {
      order: 0,
      patternIndex: 0,
      numRows: 64,
      numChannels: 4,
      rows: Array.from({ length: 64 }, () =>
        Array.from({ length: 4 }, (): PatternCell => ({
          type: 'note',
          text: '',
          note: 1,
          inst: 1,
        })),
      ),
    };

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    packPatternMatrix(mockMatrix, false);
    packPatternMatrixHighPrecision(mockMatrix, false);

    const mismatchErrors = errorSpy.mock.calls.filter((args) =>
      args.some((arg) => typeof arg === 'string' && arg.includes('buffer size mismatch')),
    );
    expect(mismatchErrors).toHaveLength(0);
  });

  it('round-trips high-precision packed cells byte-exactly', () => {
    const mat = makeMatrix(4, [[
      { note: 60, inst: 5, volCmd: 0x34, volVal: 0x56, effCmd: 4, effVal: 0x12 },
      { note: 0, inst: 0, volCmd: 0, volVal: 0, effCmd: 0, effVal: 0 },
      { note: 0, inst: 0, volCmd: 0, volVal: 0, effCmd: 0, effVal: 0 },
      { note: 120, inst: 0, volCmd: 0, volVal: 0, effCmd: 0, effVal: 0 },
    ]]);

    const { packedData } = packPatternMatrixHighPrecision(mat, false);
    expect(packedData.length).toBe(4 * 1 * 2);

    const row0 = getCell(packedData, 0, 0, 1);
    expect(row0.note).toBe(60);
    expect(row0.inst).toBe(5);
    expect(row0.duration).toBe(4);
    expect(row0.rowOffset).toBe(0);
    expect(row0.isNoteOff).toBe(0);
    expect(row0.effCmd).toBe(4);
    expect(row0.effVal).toBe(0x12);
    expect(row0.volCmd).toBe(0x34);

    const volCmdNibble = (0x34 >> 4) & 0x0f;
    const volValNibble = (0x56 >> 4) & 0x0f;
    expect(row0.volPacked).toBe((volCmdNibble << 4) | volValNibble);

    const row1 = getCell(packedData, 1, 0, 1);
    expect(row1.note).toBe(60);
    expect(row1.duration).toBe(4);
    expect(row1.rowOffset).toBe(1);
    expect(row1.isNoteOff).toBe(0);

    const row3 = getCell(packedData, 3, 0, 1);
    expect(row3.isNoteOff).toBe(1);
    expect(row3.rowOffset).toBe(3);
    expect(row3.duration).toBe(4);

    for (let r = 0; r < 4; r++) {
      const idx = r * 2;
      const pa = packedData[idx]!;
      const pb = packedData[idx + 1]!;
      const roundTrip = unpackCell(pa, pb);
      const direct = getCell(packedData, r, 0, 1);
      expect(roundTrip).toEqual(direct);
    }
  });

  it('recovers standard pack layout for note/instrument/effect fields', () => {
    const mat = makeMatrix(2, [[
      { note: 48, inst: 3, volCmd: 0xab, volVal: 0xcd, effCmd: 9, effVal: 0xef },
      {},
    ]]);

    const { packedData } = packPatternMatrix(mat, false);
    const idx = 0;
    const packedA = packedData[idx]!;
    const packedB = packedData[idx + 1]!;

    expect((packedA >> 24) & 0xff).toBe(48);
    expect((packedA >> 16) & 0xff).toBe(3);
    expect((packedA >> 8) & 0xff).toBe(0xab);
    expect(packedA & 0xff).toBe(0xcd);
    expect((packedB >> 8) & 0xff).toBe(9);
    expect(packedB & 0xff).toBe(0xef);
  });
});
