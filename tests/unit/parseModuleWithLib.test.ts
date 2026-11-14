/**
 * The module load path's parse (utils/parseModuleWithLib.ts) against a counting fake libopenmpt:
 *  - patterns are extracted once per PATTERN, not once per order that plays it;
 *  - the main thread's order-0 parse and its backfill share ONE module handle (one create);
 *  - nothing it allocates on the heap outlives it (the metadata key strings used to leak).
 */
import { describe, expect, it, vi } from 'vitest';
import type { LibOpenMPT, PatternMatrix } from '../../types';
import { parseModuleWithLib, parseModuleWithLibOpen } from '../../utils/parseModuleWithLib';

const ROWS = 4;
const CHANNELS = 2;
const MOD_PTR = 0x5000;

/** Order list → pattern index. Patterns 0 and 1 repeat. */
const ORDERS = [0, 1, 0, 1, 0, 2, 1];

function fakeLib() {
  const HEAPU8 = new Uint8Array(1 << 16);
  let next = 64;
  const live = new Set<number>();
  const cellReads = new Map<number, number>(); // pattern → get_pattern_row_channel_command calls
  let modules = 0;

  const malloc = vi.fn((n: number) => {
    const ptr = next;
    next += Math.max(n, 1);
    live.add(ptr);
    return ptr;
  });
  const lib = {
    HEAPU8,
    HEAPF32: new Float32Array(HEAPU8.buffer),
    _malloc: malloc,
    _free: vi.fn((ptr: number) => {
      if (!live.delete(ptr)) throw new Error(`bad free ${ptr}`);
    }),
    stringToUTF8: (s: string) => {
      const bytes = new TextEncoder().encode(s + '\0');
      const ptr = malloc(bytes.length);
      HEAPU8.set(bytes, ptr);
      return ptr;
    },
    UTF8ToString: (ptr: number) => {
      if (!ptr) return '';
      let end = ptr;
      while (HEAPU8[end]) end++;
      return new TextDecoder().decode(HEAPU8.subarray(ptr, end));
    },
    _openmpt_free_string: vi.fn(),
    _openmpt_module_get_metadata: vi.fn(() => 0),
    _openmpt_module_create_from_memory2: vi.fn(() => {
      modules++;
      return MOD_PTR;
    }),
    _openmpt_module_destroy: vi.fn(() => {
      modules--;
    }),
    _openmpt_module_get_num_orders: () => ORDERS.length,
    _openmpt_module_get_num_channels: () => CHANNELS,
    _openmpt_module_get_current_estimated_bpm: () => 125,
    _openmpt_module_get_duration_seconds: () => 10,
    _openmpt_module_get_num_instruments: () => 0,
    _openmpt_module_get_instrument_name: () => 0,
    _openmpt_module_get_num_samples: () => 0,
    _openmpt_module_get_sample_name: () => 0,
    _openmpt_module_get_order_pattern: vi.fn((_mod: number, order: number) => ORDERS[order] ?? 0),
    _openmpt_module_get_pattern_num_rows: () => ROWS,
    _openmpt_module_get_pattern_row_channel_command: vi.fn(
      (_mod: number, pattern: number, row: number, channel: number, command: number) => {
        cellReads.set(pattern, (cellReads.get(pattern) ?? 0) + 1);
        // NOTE column: a distinct note per (pattern, row, channel) so shared rows are checkable.
        return command === 0 ? 1 + pattern * 16 + row * CHANNELS + channel : 0;
      },
    ),
  };
  return {
    lib: lib as unknown as LibOpenMPT,
    live,
    cellReads,
    create: lib._openmpt_module_create_from_memory2,
    destroy: lib._openmpt_module_destroy,
    get openModules() { return modules; },
  };
}

const CELLS_PER_PATTERN = ROWS * CHANNELS * 6; // six commands per cell

describe('parseModuleWithLib', () => {
  it('extracts each pattern once, however many orders play it', () => {
    const f = fakeLib();
    const { patternMatrices } = parseModuleWithLib(f.lib, new Uint8Array(32), 'x.it');
    expect(patternMatrices).toHaveLength(ORDERS.length);
    expect([...f.cellReads.keys()].sort()).toEqual([0, 1, 2]);
    for (const reads of f.cellReads.values()) expect(reads).toBe(CELLS_PER_PATTERN);

    // Each order has its own matrix (its own `order`), over the shared rows of its pattern.
    patternMatrices.forEach((m, order) => {
      expect(m.order).toBe(order);
      expect(m.patternIndex).toBe(ORDERS[order]);
      expect(m.rows[1]![1]!.note).toBe(1 + ORDERS[order]! * 16 + 1 * CHANNELS + 1);
    });
    expect(patternMatrices[2]!.rows).toBe(patternMatrices[0]!.rows);
    expect(patternMatrices[3]!.rows).toBe(patternMatrices[1]!.rows);
    expect(patternMatrices[5]!.rows).not.toBe(patternMatrices[0]!.rows);
  });

  it('frees everything it allocates — the metadata keys included — and destroys its module', () => {
    const f = fakeLib();
    parseModuleWithLib(f.lib, new Uint8Array(32), 'x.it');
    expect(f.live.size).toBe(0);
    expect(f.openModules).toBe(0);
    // title, message and type were read through C strings that are now freed.
    expect(vi.mocked(f.lib._openmpt_module_get_metadata)).toHaveBeenCalledTimes(3);
  });

  it('uses the file name when the module has no title', () => {
    const f = fakeLib();
    expect(parseModuleWithLib(f.lib, new Uint8Array(32), 'x.it').metadata.title).toBe('x.it');
  });
});

describe('parseModuleWithLibOpen: order-0 parse + backfill on one handle', () => {
  it('creates the module ONCE for the parse and the backfill, and destroys it after', async () => {
    const f = fakeLib();
    const parsed = parseModuleWithLibOpen(f.lib, new Uint8Array(32), 'x.it', { maxOrders: 1 });
    expect(parsed.patternMatrices).toHaveLength(1);
    expect(f.openModules).toBe(1);

    const target: (PatternMatrix | null)[] = new Array(ORDERS.length).fill(null);
    target[0] = parsed.patternMatrices[0]!;
    await parsed.backfill(target, { yieldEvery: 1 });

    expect(f.create).toHaveBeenCalledTimes(1);
    expect(f.destroy).toHaveBeenCalledTimes(1);
    expect(f.openModules).toBe(0);
    expect(f.live.size).toBe(0);
    expect(target.map((m) => m?.order)).toEqual(ORDERS.map((_, i) => i));
    expect(target.map((m) => m?.patternIndex)).toEqual(ORDERS);
    // Order 0's pattern came from the parse: the backfill reused it.
    for (const reads of f.cellReads.values()) expect(reads).toBe(CELLS_PER_PATTERN);
    expect(target[2]!.rows).toBe(target[0]!.rows);
  });

  it('an aborted backfill stops and still destroys the handle', async () => {
    const f = fakeLib();
    const parsed = parseModuleWithLibOpen(f.lib, new Uint8Array(32), 'x.it', { maxOrders: 1 });
    const abort = new AbortController();
    const target: (PatternMatrix | null)[] = new Array(ORDERS.length).fill(null);
    const run = parsed.backfill(target, { yieldEvery: 1, signal: abort.signal });
    abort.abort(); // lands at the first yield
    await run;
    expect(target.filter(Boolean).length).toBeLessThan(ORDERS.length - 1);
    expect(f.openModules).toBe(0);
  });

  it('dispose() without a backfill destroys the handle once (idempotent)', () => {
    const f = fakeLib();
    const parsed = parseModuleWithLibOpen(f.lib, new Uint8Array(32), 'x.it', { maxOrders: 1 });
    parsed.dispose();
    parsed.dispose();
    expect(f.destroy).toHaveBeenCalledTimes(1);
  });

  it('a backfill after dispose() does nothing (no use-after-destroy)', async () => {
    const f = fakeLib();
    const parsed = parseModuleWithLibOpen(f.lib, new Uint8Array(32), 'x.it', { maxOrders: 1 });
    parsed.dispose();
    const reads = vi.mocked(f.lib._openmpt_module_get_order_pattern).mock.calls.length;
    await parsed.backfill(new Array(ORDERS.length).fill(null));
    expect(vi.mocked(f.lib._openmpt_module_get_order_pattern).mock.calls.length).toBe(reads);
    expect(f.destroy).toHaveBeenCalledTimes(1);
  });

  it('a parse that fails after create destroys the handle before throwing', () => {
    const f = fakeLib();
    vi.mocked(f.lib._openmpt_module_get_pattern_row_channel_command).mockImplementation(() => {
      throw new Error('trap');
    });
    expect(() => parseModuleWithLibOpen(f.lib, new Uint8Array(32), 'x.it')).toThrow('trap');
    expect(f.openModules).toBe(0);
    expect(f.live.size).toBe(0);
  });
});
