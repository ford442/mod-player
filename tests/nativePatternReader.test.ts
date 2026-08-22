import { describe, expect, it } from 'vitest';
import {
  workletPatternToMatrix,
  extractMatricesFromNative,
  type NativePatternExports,
} from '../audio-worklet/NativePatternReader';
import type { WorkletPatternData } from '../audio-worklet/types';

describe('NativePatternReader', () => {
  it('maps worklet pattern rows onto PatternMatrix cells', () => {
    const pd: WorkletPatternData = {
      patternIndex: 2,
      numRows: 1,
      numChannels: 2,
      rows: [{
        notes: [36, 0],
        instruments: [1, 0],
        volCmds: [0, 0],
        volVals: [0, 0],
        effCmds: [0, 1],
        effVals: [0, 2],
      }],
    };
    const matrix = workletPatternToMatrix(pd, 3);
    expect(matrix.order).toBe(3);
    expect(matrix.patternIndex).toBe(2);
    expect(matrix.rows[0]?.[0]?.type).toBe('note');
    expect(matrix.rows[0]?.[1]?.type).toBe('effect');
  });

  it('walks orders via native KEEPALIVE-shaped exports', () => {
    const fake: NativePatternExports = {
      _get_num_channels: () => 1,
      _get_num_orders: () => 2,
      _get_order_pattern: (order) => order,
      _get_pattern_num_rows: () => 1,
      _get_pattern_row_channel_command: (_p, _r, _c, command) => (command === 0 ? 48 : 0),
    };
    const { matrices, numOrders, numChannels } = extractMatricesFromNative(fake);
    expect(numOrders).toBe(2);
    expect(numChannels).toBe(1);
    expect(matrices).toHaveLength(2);
    expect(matrices[1]?.order).toBe(1);
    expect(matrices[0]?.rows[0]?.[0]?.note).toBe(48);
  });
});
