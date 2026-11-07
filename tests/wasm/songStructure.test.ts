/**
 * #537 phase 1: the song map's SongStructure, read from the committed real-WASM libopenmpt for
 * modules synthesized at test time (scripts/lib/synth-xm.mjs, synth-it.mjs), against libopenmpt's
 * own clock (`set_position_order_row` + `get_position_seconds`, `get_duration_seconds`).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LibOpenMPT } from '../../types';
import {
  SONG_MAP_ORDERS,
  SONG_MAP_PATTERN_ROWS,
  SONG_MAP_TEMPO_CELLS,
  synthJumpXm,
  synthSongMapXm,
} from '../../scripts/lib/synth-xm.mjs';
import { synthIt } from '../../scripts/lib/synth-it.mjs';
import { EffectCommand, PatternCommand } from '../../utils/openmptCommands';
import { readSongStructure } from '../../utils/readSongStructure';
import {
  ORDER_PATTERN_END,
  ORDER_PATTERN_SKIP,
  orderAtSeconds,
  secondsAtOrderRow,
  type SongStructure,
} from '../../utils/songStructure';
import { loadLibOpenMPTNode } from '../helpers/libopenmptNode';

let lib: LibOpenMPT;
let restore = () => {};

function withModule<T>(bytes: Uint8Array, run: (mod: number) => T): T {
  const ptr = lib._malloc(bytes.length);
  lib.HEAPU8.set(bytes, ptr);
  const mod = lib._openmpt_module_create_from_memory2(ptr, bytes.length, 0, 0, 0, 0, 0, 0, 0);
  lib._free(ptr);
  expect(mod).not.toBe(0);
  try {
    return run(mod);
  } finally {
    lib._openmpt_module_destroy(mod);
  }
}

/** libopenmpt's own answer, on a separate module so the reader's state cannot leak into it. */
function libStart(bytes: Uint8Array, order: number, row = 0): number {
  return withModule(bytes, (mod) => {
    lib._openmpt_module_set_position_order_row(mod, order, row);
    return lib._openmpt_module_get_position_seconds(mod);
  });
}

beforeAll(async () => {
  ({ lib, restore } = await loadLibOpenMPTNode());
}, 30_000);

afterAll(() => restore());

describe('the synthesized song-map XM (no app code involved)', () => {
  it('carries its tempo / speed cells as CMD_TEMPO / CMD_SPEED', () => {
    withModule(synthSongMapXm(), (mod) => {
      expect(lib._openmpt_module_get_num_orders(mod)).toBe(30);
      for (const [pattern, row, param, kind] of SONG_MAP_TEMPO_CELLS) {
        const effect = lib._openmpt_module_get_pattern_row_channel_command(mod, pattern, row, 1, PatternCommand.EFFECT);
        const value = lib._openmpt_module_get_pattern_row_channel_command(mod, pattern, row, 1, PatternCommand.PARAMETER);
        expect(effect).toBe(kind === 'tempo' ? EffectCommand.CMD_TEMPO : EffectCommand.CMD_SPEED);
        expect(value).toBe(param);
      }
    });
  });
});

describe('readSongStructure — 30-order XM', () => {
  const bytes = synthSongMapXm();
  let s: SongStructure;
  beforeAll(() => {
    s = withModule(bytes, (mod) => readSongStructure(lib, mod));
  });

  it('has one entry per order, with the pattern and its rows', () => {
    expect(s.orders).toHaveLength(30);
    s.orders.forEach((o, i) => {
      expect(o.index).toBe(i);
      expect(o.pattern).toBe(SONG_MAP_ORDERS[i]);
      expect(o.rows).toBe(SONG_MAP_PATTERN_ROWS[SONG_MAP_ORDERS[i]!]);
      expect(o).toMatchObject({ reachable: true, isSkip: false, isEnd: false, entryRow: 0, exitRow: o.rows - 1 });
    });
    expect(s.playOrder).toEqual(SONG_MAP_ORDERS.map((_, i) => i));
    expect(s.approximate).toBe(false);
  });

  it('startSeconds is monotonic and matches get_position_seconds within 1 ms', () => {
    for (let i = 1; i < s.orders.length; i++) {
      expect(s.orders[i]!.startSeconds).toBeGreaterThan(s.orders[i - 1]!.startSeconds);
    }
    s.orders.forEach((o) => {
      expect(Math.abs(o.startSeconds - libStart(bytes, o.index))).toBeLessThan(0.001);
    });
  });

  it('totalSeconds matches get_duration_seconds within 1 ms, and the durations add up to it', () => {
    const duration = withModule(bytes, (mod) => lib._openmpt_module_get_duration_seconds(mod));
    expect(Math.abs(s.totalSeconds - duration)).toBeLessThan(0.001);
    const sum = s.orders.reduce((n, o) => n + o.durationSeconds, 0);
    expect(Math.abs(sum - duration)).toBeLessThan(0.001);
  });

  it('tempo events: the initial tempo, then every Fxx in play order with the running bpm / speed', () => {
    const [initial, ...changes] = s.tempoEvents;
    expect(initial).toMatchObject({ order: 0, row: 0, bpm: 125, speed: 6, seconds: 0 });
    // Orders whose pattern carries a tempo cell, in play order — consecutive repeats of a value drop out.
    let bpm = 125;
    let speed = 6;
    const expected: Array<{ order: number; row: number; bpm: number; speed: number }> = [];
    SONG_MAP_ORDERS.forEach((pattern, order) => {
      for (const [p, row, param, kind] of [...SONG_MAP_TEMPO_CELLS].sort((a, b) => a[1] - b[1])) {
        if (p !== pattern) continue;
        if (kind === 'tempo' && param !== bpm) { bpm = param; expected.push({ order, row, bpm, speed }); }
        if (kind === 'speed' && param !== speed) { speed = param; expected.push({ order, row, bpm, speed }); }
      }
    });
    expect(changes.map(({ order, row, bpm: b, speed: sp }) => ({ order, row, bpm: b, speed: sp }))).toEqual(expected);
    // An event at row 0 sits at its order's start (exactly libopenmpt's clock).
    for (const e of changes.filter((c) => c.row === 0)) {
      expect(Math.abs(e.seconds - libStart(bytes, e.order))).toBeLessThan(0.001);
    }
    // Mid-order events land within ~a row of libopenmpt's time for that row.
    for (const e of changes.filter((c) => c.row > 0)) {
      expect(Math.abs(e.seconds - libStart(bytes, e.order, e.row))).toBeLessThan(0.15);
    }
  });

  it('orderAtSeconds / secondsAtOrderRow invert each other on order starts', () => {
    for (const o of s.orders) {
      expect(orderAtSeconds(s, o.startSeconds + 1e-6)).toBe(o.index);
      expect(secondsAtOrderRow(s, o.index, 0)).toBeCloseTo(o.startSeconds, 9);
    }
    expect(orderAtSeconds(s, -1)).toBe(-1);
    expect(orderAtSeconds(s, s.totalSeconds + 100)).toBe(29);
  });

  it('past the time budget, the remaining starts are extrapolated and flagged approximate', () => {
    let t = 0;
    const approx = withModule(bytes, (mod) => readSongStructure(lib, mod, { budgetMs: 10, now: () => (t += 1) }));
    expect(approx.approximate).toBe(true);
    for (let i = 1; i < approx.orders.length; i++) {
      expect(approx.orders[i]!.startSeconds).toBeGreaterThanOrEqual(approx.orders[i - 1]!.startSeconds);
    }
    // The tick clock is exact for this song (no slides), so even the extrapolated starts are close.
    approx.orders.forEach((o, i) => {
      expect(Math.abs(o.startSeconds - s.orders[i]!.startSeconds)).toBeLessThan(0.01);
    });
  });
});

describe('readSongStructure — skip / end markers (IT)', () => {
  // 0, +++, 1, ---, 2, 0: playback (subsong 0) runs 0 → 1 and stops at the end marker.
  const bytes = synthIt(2, { patterns: 3, rows: 16, orders: [0, 254, 1, 255, 2, 0, 255] });
  let s: SongStructure;
  beforeAll(() => {
    s = withModule(bytes, (mod) => readSongStructure(lib, mod));
  });

  it('flags the markers, and orders past the end as not reached', () => {
    const flags = s.orders.map((o) => [o.pattern, o.isSkip, o.isEnd, o.reachable]);
    expect(flags).toEqual([
      [0, false, false, true],
      [ORDER_PATTERN_SKIP, true, false, false],
      [1, false, false, true],
      [ORDER_PATTERN_END, false, true, false],
      [2, false, false, false],
      [0, false, false, false],
    ]);
    expect(s.playOrder).toEqual([0, 2]);
  });

  it('reached starts are libopenmpt\'s; markers and unreached orders take no time', () => {
    expect(Math.abs(s.orders[2]!.startSeconds - libStart(bytes, 2))).toBeLessThan(0.001);
    expect(s.orders[1]!).toMatchObject({ durationSeconds: 0, startSeconds: s.orders[0]!.durationSeconds });
    const sum = s.orders.reduce((n, o) => n + o.durationSeconds, 0);
    expect(Math.abs(sum - s.totalSeconds)).toBeLessThan(0.001);
    expect(s.orders[4]!.durationSeconds).toBe(0);
  });
});

describe('readSongStructure — pattern break and position jump (XM)', () => {
  const bytes = synthJumpXm();
  let s: SongStructure;
  beforeAll(() => {
    s = withModule(bytes, (mod) => readSongStructure(lib, mod));
  });

  it('follows Dxx into order 1 at row 10 and Bxx past order 2', () => {
    expect(s.playOrder).toEqual([0, 1, 3]);
    expect(s.orders.map((o) => [o.reachable, o.entryRow, o.exitRow])).toEqual([
      [true, 0, 8],
      [true, 10, 12],
      [false, 0, 15],
      [true, 0, 15],
    ]);
  });

  it('matches libopenmpt\'s clock at each entry, and the durations add up to the song', () => {
    expect(Math.abs(s.orders[1]!.startSeconds - libStart(bytes, 1, 10))).toBeLessThan(0.001);
    expect(Math.abs(s.orders[3]!.startSeconds - libStart(bytes, 3))).toBeLessThan(0.001);
    const sum = s.orders.reduce((n, o) => n + o.durationSeconds, 0);
    expect(Math.abs(sum - s.totalSeconds)).toBeLessThan(0.001);
    // 9 + 3 + 16 rows at speed 6 / tempo 125 (0.12 s a row).
    expect(s.totalSeconds).toBeCloseTo(28 * 0.12, 6);
  });
});
