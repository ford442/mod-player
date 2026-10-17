import { describe, expect, it } from 'vitest';
import {
  workletPatternToMatrix,
  extractMatricesFromNative,
  readPatternDataFromNative,
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

  // #491: the bulk path (one HEAPU8 view per pattern from _get_pattern_cells)
  // must decode exactly what six _get_pattern_row_channel_command calls per
  // cell return — same command order, same fields.
  it('bulk snapshot reads match the per-cell exports', () => {
    const rows = 3;
    const channels = 2;
    const value = (r: number, c: number, cmd: number) => (r * 31 + c * 7 + cmd * 3 + 1) & 0xff;
    const heap = new Uint8Array(4096);
    const base = 1000;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < channels; c++) {
        for (let cmd = 0; cmd < 6; cmd++) heap[base + (r * channels + c) * 6 + cmd] = value(r, c, cmd);
      }
    }
    const perCell: NativePatternExports = {
      _get_num_channels: () => channels,
      _get_num_orders: () => 1,
      _get_order_pattern: () => 0,
      _get_pattern_num_rows: () => rows,
      _get_pattern_row_channel_command: (_p, r, c, cmd) => value(r, c, cmd),
    };
    let perCellCalls = 0;
    const bulk: NativePatternExports = {
      ...perCell,
      _get_pattern_row_channel_command: (...args) => {
        perCellCalls++;
        return perCell._get_pattern_row_channel_command(...args);
      },
      _get_pattern_cells: () => base,
      HEAPU8: heap,
    };
    expect(readPatternDataFromNative(bulk, 0, channels)).toEqual(readPatternDataFromNative(perCell, 0, channels));
    expect(perCellCalls).toBe(0);
    // A null pointer (older build, or no such pattern) falls back to the per-cell exports.
    const noBulk: NativePatternExports = { ...bulk, _get_pattern_cells: () => 0 };
    expect(readPatternDataFromNative(noBulk, 0, channels)).toEqual(readPatternDataFromNative(perCell, 0, channels));
    expect(perCellCalls).toBe(rows * channels * 6);
  });
});
