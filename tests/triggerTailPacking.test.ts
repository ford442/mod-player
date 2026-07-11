import { describe, expect, it, vi } from 'vitest';
import {
  calculateNoteDurations,
  isTriggerFromPackedB,
  packPatternMatrixHighPrecision,
  PACKEDB_TRIGGER_FLAG,
} from '../utils/gpuPacking';
import type { PatternMatrix } from '../types';

vi.stubEnv('DEV', true);

describe('trigger tail packing (TRIG-001 / DURA-001)', () => {
  const matrix: PatternMatrix = {
    order: 0,
    patternIndex: 0,
    numRows: 8,
    numChannels: 1,
    rows: [
      [{ type: 'note', text: '', note: 60, inst: 1, volCmd: 0, volVal: 0, effCmd: 0, effVal: 0 }],
      [{ type: 'empty', text: '', note: 0, inst: 0, volCmd: 0, volVal: 0, effCmd: 0, effVal: 0 }],
      [{ type: 'empty', text: '', note: 0, inst: 0, volCmd: 0, volVal: 0, effCmd: 0, effVal: 0 }],
      [{ type: 'empty', text: '', note: 0, inst: 0, volCmd: 0, volVal: 0, effCmd: 0, effVal: 0 }],
      [{ type: 'empty', text: '', note: 0, inst: 0, volCmd: 0, volVal: 0, effCmd: 0, effVal: 0 }],
      [{ type: 'empty', text: '', note: 0, inst: 0, volCmd: 0, volVal: 0, effCmd: 0, effVal: 0 }],
      [{ type: 'empty', text: '', note: 0, inst: 0, volCmd: 0, volVal: 0, effCmd: 0, effVal: 0 }],
      [{ type: 'note', text: '', note: 120, inst: 0, volCmd: 0, volVal: 0, effCmd: 0, effVal: 0 }],
    ],
  };

  function readCell(row: number, ch: number, packedData: Uint32Array) {
    const offset = (row * 1 + ch) * 2;
    return { packedA: packedData[offset]!, packedB: packedData[offset + 1]! };
  }

  it('sets duration grid flags and packed trigger/sustain bits correctly', () => {
    const durations = calculateNoteDurations(matrix);
    const d0 = durations[0]?.[0];
    const d3 = durations[3]?.[0];
    const d7 = durations[7]?.[0];

    expect(d0).toBeDefined();
    expect(d3).toBeDefined();
    expect(d7).toBeDefined();

    expect(d0!.isTrigger).toBe(true);
    expect(d0!.isSustained).toBe(false);
    expect(d3!.isSustained).toBe(true);
    expect(d3!.isTrigger).toBe(false);
    expect(d7!.isNoteOff).toBe(true);

    const { packedData } = packPatternMatrixHighPrecision(matrix, false);
    const triggerCell = readCell(0, 0, packedData);
    const sustainCell = readCell(3, 0, packedData);

    const triggerNote = (triggerCell.packedA >> 24) & 0xff;
    const sustainNote = (sustainCell.packedA >> 24) & 0xff;

    expect(triggerNote).toBe(60);
    expect(sustainNote).toBe(60);
    expect(triggerCell.packedB & PACKEDB_TRIGGER_FLAG).not.toBe(0);
    expect(sustainCell.packedB & PACKEDB_TRIGGER_FLAG).toBe(0);

    const durationFlags3 = (sustainCell.packedB >> 8) & 0x7f;
    const rowOffset3 = durationFlags3 >> 1;
    expect(isTriggerFromPackedB(sustainCell.packedB, rowOffset3, false, true)).toBe(false);
    expect(isTriggerFromPackedB(triggerCell.packedB, 0, false, true)).toBe(true);
    expect(isTriggerFromPackedB(0, 0, false, false)).toBe(false);
  });
});
