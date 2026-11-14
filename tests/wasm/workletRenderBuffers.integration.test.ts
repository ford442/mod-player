/**
 * The worklet's stereo render buffers are allocated once and never freed, so no path renders into
 * address 0. Regression: `loadModule` freed `leftBufPtr` / `rightBufPtr` before create and only
 * re-allocated them on success, and `_adoptStaged` never allocated them — after a failed in-worklet
 * load on the shared playback heap, the next staged module rendered `read_float_stereo(…, 0, 0)`,
 * scribbling up to 16 KiB over low shared-heap memory.
 *
 * Drives the COMPILED processor (public/worklets/openmpt-worklet.js) in a fake
 * AudioWorkletGlobalScope with the committed libopenmpt pairs, and spies on every
 * read_float_stereo call it makes.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { MAIN_TO_WORKLET as MT, WORKLET_TO_MAIN as WT } from '../../audio-worklet/workletProtocolConstants';
import { CREATE_PORT } from '../../audio-worklet/createThreadProtocol';
import { FakeScope, QUANTUM, SAMPLE_RATE, initLib, read } from '../helpers/workletScope';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const MOD = new Uint8Array(read('public/4-mat_madness.mod'));

interface WasmLib {
  _malloc(n: number): number;
  _free(p: number): void;
  HEAPU8: Uint8Array;
  wasmMemory?: WebAssembly.Memory;
  _openmpt_module_create_from_memory2(...args: number[]): number;
  _openmpt_module_read_float_stereo(mod: number, rate: number, frames: number, l: number, r: number): number;
}

interface Processor {
  lib: WasmLib;
  modulePtr: number;
  leftBufPtr: number;
  rightBufPtr: number;
  _onCreatePortMessage(data: unknown): void;
  process(i: unknown, o: Float32Array[][], p: unknown): boolean;
}

/** Record the buffer pointers of every read_float_stereo call (the lib object is shared per scope). */
function spyRender(lib: WasmLib): Array<[number, number]> {
  const calls: Array<[number, number]> = [];
  const real = lib._openmpt_module_read_float_stereo.bind(lib);
  lib._openmpt_module_read_float_stereo = (mod, rate, frames, l, r) => {
    calls.push([l, r]);
    return real(mod, rate, frames, l, r);
  };
  return calls;
}

/** Create a module in the worklet's own heap, as the create worker would have, and return its pointer. */
function createModule(lib: WasmLib, bytes: Uint8Array): number {
  const ptr = lib._malloc(bytes.byteLength);
  expect(ptr).not.toBe(0);
  const heap = lib.wasmMemory ? new Uint8Array(lib.wasmMemory.buffer) : lib.HEAPU8;
  heap.set(bytes, ptr);
  const mod = lib._openmpt_module_create_from_memory2(ptr, bytes.byteLength, 0, 0, 0, 0, 0, 0, 0);
  lib._free(ptr);
  expect(mod).not.toBe(0);
  return mod;
}

function render(scope: FakeScope, node: Processor, quanta: number): number {
  const l = new Float32Array(QUANTUM);
  const r = new Float32Array(QUANTUM);
  let peak = 0;
  for (let q = 0; q < quanta; q++) {
    scope.advance(QUANTUM / SAMPLE_RATE);
    node.process([[]], [[l, r]], {});
    for (let i = 0; i < QUANTUM; i++) peak = Math.max(peak, Math.abs(l[i]!), Math.abs(r[i]!));
  }
  return peak;
}

const junk = (n: number): Uint8Array => {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 2654435761) >>> 24;
  return b;
};

describe('worklet render buffers are never null (compiled worklet, real libopenmpt)', () => {
  describe('shared playback heap: failed in-worklet load, then a staged module', () => {
    let scope: FakeScope;
    let send: (d: unknown) => Promise<void>;
    let node: Processor;

    beforeAll(async () => {
      scope = new FakeScope();
      const n = scope.newNode();
      send = n.send;
      node = n.node as unknown as Processor;
      await send({
        type: MT.initLib,
        scriptText: read('public/worklets/libopenmpt-playback.js').toString('utf8'),
        wasmBytes: scope.toRealm(read('public/worklets/libopenmpt-playback.wasm')),
      });
      expect(scope.count(WT.createHeap)).toBe(1);
    }, 60_000);

    it('a failed load keeps the render buffers, and the next staged module renders into them', async () => {
      const left = node.leftBufPtr;
      const right = node.rightBufPtr;
      expect(left).not.toBe(0);
      expect(right).not.toBe(0);

      const errorsBefore = scope.count(WT.error);
      await send({ type: MT.load, moduleData: scope.toRealm(junk(4096)) });
      expect(scope.count(WT.error)).toBe(errorsBefore + 1);
      expect(node.modulePtr).toBe(0);
      expect(node.leftBufPtr).toBe(left);
      expect(node.rightBufPtr).toBe(right);

      const calls = spyRender(node.lib);
      const loadedBefore = scope.count(WT.loaded);
      node._onCreatePortMessage({ type: CREATE_PORT.staged, modulePtr: createModule(node.lib, MOD) });
      expect(scope.count(WT.loaded)).toBe(loadedBefore + 1);
      await send({ type: MT.play });

      expect(render(scope, node, 300)).toBeGreaterThan(0.01);
      expect(calls.length).toBeGreaterThan(0);
      for (const [l, r] of calls) {
        expect(l).toBe(left);
        expect(r).toBe(right);
      }
    });

    it('a successful in-worklet load reuses the same buffers (no free / re-malloc per load)', async () => {
      const left = node.leftBufPtr;
      await send({ type: MT.load, moduleData: scope.toRealm(MOD) });
      expect(node.modulePtr).not.toBe(0);
      expect(node.leftBufPtr).toBe(left);
    });
  });

  describe('non-shared worklet heap: a staged module with no prior load', () => {
    it('allocates the render buffers on adopt instead of rendering into address 0', async () => {
      const scope = new FakeScope();
      const n = scope.newNode();
      const node = n.node as unknown as Processor;
      await initLib(scope, n.send);
      expect(node.leftBufPtr).toBe(0); // no create heap here: nothing pre-allocates them

      const calls = spyRender(node.lib);
      node._onCreatePortMessage({ type: CREATE_PORT.staged, modulePtr: createModule(node.lib, MOD) });
      await n.send({ type: MT.play });
      expect(node.leftBufPtr).not.toBe(0);
      expect(node.rightBufPtr).not.toBe(0);

      expect(render(scope, node, 300)).toBeGreaterThan(0.01);
      expect(calls.length).toBeGreaterThan(0);
      expect(calls.every(([l, r]) => l !== 0 && r !== 0)).toBe(true);
      expect(scope.count(WT.error)).toBe(0);
    }, 60_000);
  });

  it('source guard: loadModule never frees the render buffers', () => {
    const src = readFileSync(join(ROOT, 'audio-worklet/js/openmpt-processor.ts'), 'utf8');
    expect(src).not.toMatch(/_free\(this\.(left|right)BufPtr\)/);
  });
});
