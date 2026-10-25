/**
 * #491 Phase 2 / #515: the WASM feature gates count real instructions
 * (scripts/lib/wasm-ops.mjs). The old SIMD gate grepped for any 0xFD byte and
 * reported OK for the non-SIMD JS-engine wasm; these tests pin the decoder on
 * hand-assembled modules and run the profiles against both committed
 * libopenmpt binaries, including the negative cases.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scanWasm } from '../scripts/lib/wasm-ops.mjs';
import { checkWasmProfile } from '../scripts/verify-wasm-features.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const leb = (n: number): number[] => {
  const out: number[] = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return out;
};
const section = (id: number, payload: number[]): number[] => [id, ...leb(payload.length), ...payload];

/** A valid module: one `() -> ()` function with `body` (without locals / end), plus optional data. */
function moduleWith(body: number[], data: number[] = []): Uint8Array {
  const fn = [0x00, ...body, 0x0b]; // no locals … end
  const bytes = [
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, [0x01, 0x60, 0x00, 0x00]), // type: () -> ()
    ...section(3, [0x01, 0x00]), // function 0 has type 0
    ...section(5, [0x01, 0x00, 0x01]), // memory: min 1 page
    ...section(10, [0x01, ...leb(fn.length), ...fn]),
  ];
  if (data.length) {
    // active data segment at offset 0
    bytes.push(...section(11, [0x01, 0x00, 0x41, 0x00, 0x0b, ...leb(data.length), ...data]));
  }
  const u8 = new Uint8Array(bytes);
  expect(WebAssembly.validate(u8), 'hand-assembled module must be valid wasm').toBe(true);
  return u8;
}

describe('wasm-ops instruction scan', () => {
  it('a 0xFD byte in data is not SIMD (the old byte grep said it was)', () => {
    const m = moduleWith([], [0xfd, 0xfd, 0x0c, 0xfd]);
    expect(scanWasm(m).simd).toBe(0);
    expect(m.includes(0xfd)).toBe(true);
  });

  it('counts a real SIMD instruction and skips its 16-byte immediate', () => {
    const v128Const = [0xfd, ...leb(12), ...new Array(16).fill(0xfd)]; // v128.const (bytes look like more prefixes)
    const c = scanWasm(moduleWith([...v128Const, 0x1a])); // … drop
    expect(c.simd).toBe(1);
    expect(c.instructions).toBe(3); // v128.const, drop, end
  });

  it('counts saturating vs trapping float→int, bulk memory and sign extension', () => {
    const body = [
      0x43, 0, 0, 0, 0, 0xfc, 0x00, 0x1a, // f32.const 0; i32.trunc_sat_f32_s; drop
      0x43, 0, 0, 0, 0, 0xa8, 0x1a, // f32.const 0; i32.trunc_f32_s (traps); drop
      0x41, 0x00, 0x41, 0x00, 0x41, 0x00, 0xfc, 0x0a, 0x00, 0x00, // memory.copy 0 0 0
      0x41, 0x00, 0x41, 0x00, 0x41, 0x00, 0xfc, 0x0b, 0x00, // memory.fill 0 0 0
      0x41, 0x7f, 0xc0, 0x1a, // i32.const -1; i32.extend8_s; drop
    ];
    const c = scanWasm(moduleWith(body));
    expect(c).toMatchObject({ truncSat: 1, truncTrapping: 1, memoryCopy: 1, memoryFill: 1, signExt: 1, simd: 0 });
  });

  it('decodes memargs, br_table and constants without losing sync', () => {
    const body = [
      0x02, 0x40, // block
      0x41, 0x80, 0x01, // i32.const 128 (two-byte LEB)
      0x0e, 0x02, 0x00, 0x00, 0x00, // br_table [0 0] 0
      0x0b, // end
      0x41, 0x00, 0x28, 0x02, 0x80, 0x08, 0x1a, // i32.load align=2 offset=1024; drop
      0x44, 0, 0, 0, 0, 0, 0, 0, 0, 0x1a, // f64.const 0; drop
    ];
    const c = scanWasm(moduleWith(body));
    expect(c.instructions).toBe(10); // block, const, br_table, end, const, load, drop, const, drop, end
    expect(c.functions).toBe(1);
  });

  it('refuses an opcode it does not know instead of miscounting', () => {
    const bytes = moduleWith([0x01]); // nop
    const body = bytes.lastIndexOf(0x01); // the nop inside the code section
    const broken = new Uint8Array(bytes);
    broken[body] = 0xff;
    expect(() => scanWasm(broken)).toThrow(/unknown opcode 0xff/);
  });
});

describe('verify-wasm-features profiles on the committed libopenmpt wasm', () => {
  const sharedWasm = readFileSync(join(ROOT, 'public/worklets/libopenmpt-worklet.wasm'));
  const playbackWasm = readFileSync(join(ROOT, 'public/worklets/libopenmpt-playback.wasm'));

  it('the shared pair passes its profile: exceptions, trunc_sat, bulk memory; no SIMD, no atomics', () => {
    const { counts, failures } = checkWasmProfile(sharedWasm, 'shared');
    expect(failures).toEqual([]);
    expect(counts.tryBlocks).toBeGreaterThan(100);
    expect(counts.truncSat).toBeGreaterThan(counts.truncTrapping);
    expect(counts.memoryCopy).toBeGreaterThan(0);
  });

  it('the playback heap passes its profile: the same plus atomics', () => {
    const { counts, failures } = checkWasmProfile(playbackWasm, 'playback');
    expect(failures).toEqual([]);
    expect(counts.atomics).toBeGreaterThan(0);
    expect(counts.truncSat).toBeGreaterThan(counts.truncTrapping);
  });

  it('FAILS the simd profile — a non-SIMD wasm cannot pass the SIMD gate (negative test)', () => {
    const { failures } = checkWasmProfile(sharedWasm, 'simd');
    expect(failures.some((f) => f.startsWith('simd:'))).toBe(true);
  });

  it('the two pairs cannot swap: the shared profile rejects atomics, the playback profile requires them', () => {
    expect(checkWasmProfile(playbackWasm, 'shared').failures.some((f) => f.startsWith('no-atomics:'))).toBe(true);
    expect(checkWasmProfile(sharedWasm, 'playback').failures.some((f) => f.startsWith('atomics:'))).toBe(true);
  });
});
