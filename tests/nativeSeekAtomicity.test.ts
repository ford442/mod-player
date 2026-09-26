/**
 * #seek-race: order and row used to be two separate atomics, each read via
 * its own exchange(-1). If the audio thread ran between the main thread's
 * two stores, it could observe a valid order paired with row === -1 (the
 * sentinel) — the seek's order was consumed and its row silently lost.
 *
 * cpp/worklet_processor.cpp now packs both into one std::atomic<uint64_t>
 * (order<<32 | row) with a SEEK_NONE sentinel, so a concurrent read can only
 * ever observe "no seek pending" or one *complete* seek — never a mix of two.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const cpp = readFileSync(join(ROOT, 'cpp/worklet_processor.cpp'), 'utf8');

/** Mirrors cpp/worklet_processor.cpp's pack_seek/unpack_seek exactly. */
function packSeek(order: number, row: number): bigint {
  const u32 = (n: number): bigint => BigInt(n) & 0xffffffffn;
  return (u32(order) << 32n) | u32(row);
}
function unpackSeek(packed: bigint): { order: number; row: number } {
  const toI32 = (u: bigint): number => Number(BigInt.asIntN(32, u));
  return {
    order: toI32((packed >> 32n) & 0xffffffffn),
    row: toI32(packed & 0xffffffffn),
  };
}

describe('native seek command: single-atomic pack/unpack', () => {
  it('the old two-atomic design is gone', () => {
    expect(cpp).not.toMatch(/g_cmdSeekOrder/);
    expect(cpp).not.toMatch(/g_cmdSeekRow/);
  });

  it('g_cmdSeek is one atomic<uint64_t>, not two atomic<int>s', () => {
    expect(cpp).toMatch(/static std::atomic<uint64_t>\s+g_cmdSeek\{SEEK_NONE\}/);
  });

  it('the consumer reads it with exactly one exchange (no two-step race window)', () => {
    const idx = cpp.indexOf('// Seek command');
    expect(idx).toBeGreaterThan(0);
    const block = cpp.slice(idx, cpp.indexOf('// Loop command', idx));
    const exchangeCalls = block.match(/\.exchange\(/g) ?? [];
    expect(exchangeCalls).toHaveLength(1);
    expect(block).toMatch(/g_cmdSeek\.exchange\(SEEK_NONE/);
  });

  it('seek_order_row() stores one packed value, not two separate stores', () => {
    const idx = cpp.indexOf('void seek_order_row(');
    expect(idx).toBeGreaterThan(0);
    const body = cpp.slice(idx, cpp.indexOf('\n}', idx));
    expect(body).toMatch(/g_cmdSeek\.store\(pack_seek\(order, row\)/);
    expect(body).not.toMatch(/\.store\(order/);
    expect(body).not.toMatch(/\.store\(row/);
  });

  it('pack/unpack round-trips every (order, row) pair exactly, including edges', () => {
    const cases: Array<[number, number]> = [
      [0, 0],
      [1, 0],
      [0, 1],
      [7, 63],
      [999, 0],
      [0, 999],
      [2147483647, 2147483647], // INT32_MAX both halves
    ];
    for (let i = 0; i < 500; i++) {
      cases.push([
        Math.floor(Math.random() * 100000),
        Math.floor(Math.random() * 4096),
      ]);
    }
    for (const [order, row] of cases) {
      const packed = packSeek(order, row);
      const back = unpackSeek(packed);
      expect(back).toEqual({ order, row });
    }
  });

  it('SEEK_NONE (all-ones) never collides with a real (order, row) pair the API can express', () => {
    // order/row are non-negative in every real call site (TS never passes
    // negative positions) — pack_seek(-1, -1) is the only bit pattern that
    // equals the sentinel, and that pair is not a valid seek target.
    const SEEK_NONE = (1n << 64n) - 1n;
    expect(packSeek(-1, -1)).toBe(SEEK_NONE);
    for (let order = 0; order < 8; order++) {
      for (let row = 0; row < 8; row++) {
        expect(packSeek(order, row)).not.toBe(SEEK_NONE);
      }
    }
  });
});
