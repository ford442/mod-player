/**
 * #537 phase 2: the jumps the order-flow walk reports (`SongStructure.jumps`) and how the song map
 * places them. The walk runs against a small fake libopenmpt here (pure, no WASM); the real-WASM
 * counterpart is tests/wasm/songStructure.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { arcPath, jumpLabel, layoutJumps, layoutSongMap } from '../../components/songMapModel';
import type { LibOpenMPT } from '../../types';
import { EffectCommand, PatternCommand } from '../../utils/openmptCommands';
import { readSongStructure } from '../../utils/readSongStructure';
import {
  ORDER_PATTERN_END,
  ORDER_PATTERN_SKIP,
  jumpShape,
  successorsOf,
  type SongStructure,
} from '../../utils/songStructure';

/** `[row, effect, param, channel = 0]` effect cells of a pattern. */
type Cell = [number, number, number, number?];
interface FakePattern { rows: number; cells?: Cell[] }

/** Just the libopenmpt surface `readSongStructure` touches; a row lasts 0.1 s, an order starts at 10 s × index. */
function fakeLib(orders: number[], patterns: FakePattern[]): { lib: LibOpenMPT; mod: number } {
  let position = { order: 0, row: 0 };
  const cell = (pattern: number, row: number, channel: number): Cell | undefined =>
    patterns[pattern]?.cells?.find((c) => c[0] === row && (c[3] ?? 0) === channel);
  const api = {
    _openmpt_module_get_num_channels: () => 2,
    _openmpt_module_get_num_patterns: () => patterns.length,
    _openmpt_module_get_num_orders: () => orders.length,
    _openmpt_module_get_order_pattern: (_m: number, order: number) => orders[order] ?? ORDER_PATTERN_END,
    _openmpt_module_get_pattern_num_rows: (_m: number, pattern: number) => patterns[pattern]?.rows ?? 0,
    _openmpt_module_get_pattern_row_channel_command: (_m: number, pattern: number, row: number, channel: number, command: number) => {
      const c = cell(pattern, row, channel);
      if (command === PatternCommand.EFFECT) return c ? c[1] : EffectCommand.CMD_NONE;
      if (command === PatternCommand.PARAMETER) return c ? c[2] : 0;
      return 0;
    },
    _openmpt_module_set_position_order_row: (_m: number, order: number, row: number) => {
      position = { order, row };
      return 0;
    },
    _openmpt_module_get_position_seconds: () => position.order * 10 + position.row * 0.1,
    _openmpt_module_get_duration_seconds: () => orders.length * 10,
    _openmpt_module_get_current_speed: () => 6,
    _openmpt_module_get_current_tempo2: () => 125,
  };
  return { lib: api as unknown as LibOpenMPT, mod: 1 };
}

const cellAt = (row: number, effect: number, param: number, channel = 0): Cell => [row, effect, param, channel];

function read(orders: number[], patterns: FakePattern[]): SongStructure {
  const { lib, mod } = fakeLib(orders, patterns);
  return readSongStructure(lib, mod);
}

describe('readSongStructure — jumps', () => {
  it('reports a plain song as having no jumps', () => {
    const s = read([0, 0, 0], [{ rows: 8 }]);
    expect(s.jumps).toEqual([]);
  });

  it('reports a pattern break into the next order as a sequential break at its row', () => {
    const s = read([0, 1], [{ rows: 16, cells: [cellAt(8, EffectCommand.CMD_PATTERNBREAK, 4)] }, { rows: 16 }]);
    expect(s.jumps).toEqual([
      { kind: 'break', fromOrder: 0, fromRow: 8, toOrder: 1, toRow: 4, loops: false },
    ]);
    expect(jumpShape(s, s.jumps[0]!)).toBe('sequential');
  });

  it('reports a forward position jump that skips an order', () => {
    const s = read(
      [0, 1, 2],
      [{ rows: 8, cells: [cellAt(3, EffectCommand.CMD_POSITIONJUMP, 2)] }, { rows: 8 }, { rows: 8 }],
    );
    expect(s.playOrder).toEqual([0, 2]);
    expect(s.jumps).toEqual([{ kind: 'jump', fromOrder: 0, fromRow: 3, toOrder: 2, toRow: 0, loops: false }]);
    expect(jumpShape(s, s.jumps[0]!)).toBe('forward');
  });

  it('marks a jump back to an order already played as the song loop, and ends the walk there', () => {
    const s = read(
      [0, 1, 2],
      [{ rows: 8 }, { rows: 8 }, { rows: 8, cells: [cellAt(7, EffectCommand.CMD_POSITIONJUMP, 1)] }],
    );
    expect(s.playOrder).toEqual([0, 1, 2]);
    expect(s.jumps).toEqual([{ kind: 'jump', fromOrder: 2, fromRow: 7, toOrder: 1, toRow: 0, loops: true }]);
    expect(jumpShape(s, s.jumps[0]!)).toBe('back');
  });

  it('a jump to its own order is a self loop', () => {
    const s = read([0], [{ rows: 8, cells: [cellAt(7, EffectCommand.CMD_POSITIONJUMP, 0)] }]);
    expect(s.jumps).toEqual([{ kind: 'jump', fromOrder: 0, fromRow: 7, toOrder: 0, toRow: 0, loops: true }]);
    expect(jumpShape(s, s.jumps[0]!)).toBe('self');
  });

  it('a jump + break on one row (two channels) is one jump landing mid-pattern', () => {
    const s = read(
      [0, 1],
      [
        { rows: 8, cells: [cellAt(7, EffectCommand.CMD_POSITIONJUMP, 1), cellAt(7, EffectCommand.CMD_PATTERNBREAK, 2, 1)] },
        { rows: 8 },
      ],
    );
    expect(s.jumps).toEqual([{ kind: 'jump', fromOrder: 0, fromRow: 7, toOrder: 1, toRow: 2, loops: false }]);
  });

  it('lands on the order after a skip (+++) marker, and calls the break sequential', () => {
    const s = read(
      [0, ORDER_PATTERN_SKIP, 1],
      [{ rows: 8, cells: [cellAt(2, EffectCommand.CMD_PATTERNBREAK, 3)] }, { rows: 8 }],
    );
    expect(s.jumps).toEqual([{ kind: 'break', fromOrder: 0, fromRow: 2, toOrder: 2, toRow: 0, loops: false }]);
    expect(jumpShape(s, s.jumps[0]!)).toBe('sequential');
  });

  it('drops a jump whose target is past the order list or an end marker (the song ends there)', () => {
    const past = read([0], [{ rows: 8, cells: [cellAt(1, EffectCommand.CMD_POSITIONJUMP, 9)] }]);
    expect(past.jumps).toEqual([]);
    const end = read([0, ORDER_PATTERN_END], [{ rows: 8, cells: [cellAt(1, EffectCommand.CMD_POSITIONJUMP, 1)] }]);
    expect(end.jumps).toEqual([]);
  });

  it('reports running on into an already-played order (no command) as a looping flow', () => {
    // 0 jumps to 2; 2 jumps back to 1; 1 then falls through into 2, which was already played.
    const s = read(
      [0, 1, 2],
      [
        { rows: 4, cells: [cellAt(3, EffectCommand.CMD_POSITIONJUMP, 2)] },
        { rows: 4 },
        { rows: 4, cells: [cellAt(3, EffectCommand.CMD_POSITIONJUMP, 1)] },
      ],
    );
    expect(s.playOrder).toEqual([0, 2, 1]);
    expect(s.jumps).toEqual([
      { kind: 'jump', fromOrder: 0, fromRow: 3, toOrder: 2, toRow: 0, loops: false },
      { kind: 'jump', fromOrder: 2, fromRow: 3, toOrder: 1, toRow: 0, loops: false },
      { kind: 'flow', fromOrder: 1, fromRow: 3, toOrder: 2, toRow: 0, loops: true },
    ]);
  });
});

describe('successorsOf', () => {
  const s = read(
    [0, 1, 2],
    [{ rows: 4, cells: [cellAt(3, EffectCommand.CMD_POSITIONJUMP, 2)] }, { rows: 4 }, { rows: 4 }],
  );

  it('is the next order played, plus the target of a jump out of it', () => {
    expect([...successorsOf(s, 0)]).toEqual([2]);
    expect([...successorsOf(s, 2)]).toEqual([0]); // the last order played: the song loops to the first
  });

  it('an unreached order\'s natural next is order + 1', () => {
    expect([...successorsOf(s, 1)]).toEqual([2]);
  });
});

describe('layoutJumps / arcPath / jumpLabel', () => {
  const s = read(
    [0, 1, 2],
    [{ rows: 8 }, { rows: 8 }, { rows: 8, cells: [cellAt(7, EffectCommand.CMD_POSITIONJUMP, 1)] }],
  );
  const layout = layoutSongMap(s);

  it('leaves at the end of the exit row and lands at the start of the target row', () => {
    const [mark] = layoutJumps(s, layout);
    expect(mark!.shape).toBe('back');
    expect(mark!.fromX).toBeCloseTo(layout[2]!.left + layout[2]!.width, 6);
    expect(mark!.toX).toBeCloseTo(layout[1]!.left, 6);
    expect(mark!.toX).toBeLessThan(mark!.fromX);
  });

  it('arcPath rises above the strip baseline and stays inside it', () => {
    const d = arcPath(10, 60, 12);
    expect(d).toMatch(/^M 10\.000 12 Q 35\.000 -?\d/);
    const control = Number(d.split(' ')[5]);
    const apex = (12 + control) / 2;
    expect(apex).toBeGreaterThanOrEqual(0.5);
    expect(apex).toBeLessThan(12);
  });

  it('labels a looping jump', () => {
    expect(jumpLabel(s.jumps[0]!)).toBe('Position jump: order 2 row 7 → order 1 (song loops)');
  });
});
