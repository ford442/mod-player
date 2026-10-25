import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FORBIDDEN_RUNTIME_MEMBERS,
  REQUIRED_C_EXPORTS,
  checkArtifacts,
  inspectGlue,
  inspectWasm,
  smokeArtifacts,
  smokePlaybackArtifacts,
  smokeWorkletBoot,
} from '../scripts/jsEngineArtifacts.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

describe('JS engine libopenmpt artifacts (real WASM)', () => {
  it('committed glue + wasm + manifest agree and are real WebAssembly', () => {
    const { errors, manifest } = checkArtifacts();
    expect(errors).toEqual([]);
    expect(manifest?.glue.file).toBe('libopenmpt-worklet.js');
    expect(manifest?.wasm.file).toBe('libopenmpt-worklet.wasm');
    // Native wasm exceptions: corrupt uploads must return NULL, not abort the runtime.
    expect(manifest?.exceptions).toBe('wasm');
    expect(manifest?.simd).toBe(false);
    expect(manifest?.sharedMemory).toBe(false);
    // Hash-pinned in scripts/lib/libopenmpt-source.sh; 0.8.5–0.8.9 carry loader security fixes.
    expect(manifest?.libopenmpt).toBe('0.8.9');
  });

  it('the main-thread / parser-worker wasm imports NON-shared memory; the playback heap shared (#513)', () => {
    const shared = inspectWasm(readFileSync(join(ROOT, 'public/worklets/libopenmpt-worklet.wasm')));
    const playback = inspectWasm(readFileSync(join(ROOT, 'public/worklets/libopenmpt-playback.wasm')));
    expect(shared.memory?.shared).toBe(false);
    expect(playback.memory?.shared).toBe(true);
    // Same memory limits as the shipped artifact: 32 MiB initial, growth to 1 GiB (64 KiB pages).
    for (const m of [shared.memory, playback.memory]) {
      expect(m?.minPages).toBe(512);
      expect(m?.maxPages).toBe(16384);
    }
  });

  it('the playback pair + manifest agree, keep the same exceptions/SIMD choice, and add only the wasm-worker entry', () => {
    const { errors, manifest } = checkArtifacts({ artifact: 'playback' });
    expect(errors).toEqual([]);
    expect(manifest?.glue.file).toBe('libopenmpt-playback.js');
    expect(manifest?.wasm.file).toBe('libopenmpt-playback.wasm');
    expect(manifest?.exceptions).toBe('wasm');
    expect(manifest?.simd).toBe(false);
    expect(manifest?.sharedMemory).toBe(true);
    const glue = inspectGlue(readFileSync(join(ROOT, 'public/worklets/libopenmpt-playback.js'), 'utf8'), 'libopenmpt-playback.wasm');
    expect(glue.usesJsExceptionTrampolines).toBe(false);
    expect(glue.cExports).toContain('_emscripten_wasm_worker_initialize');
    for (const name of FORBIDDEN_RUNTIME_MEMBERS) expect(glue.cExports).not.toContain(name);
    // Emscripten's own worker bootstrap is deleted by the build (the main thread starts the create worker).
    expect(existsSync(join(ROOT, 'public/worklets/libopenmpt-playback.ww.js'))).toBe(false);
  });

  it('playback heap: a worker_threads wasm worker creates a 16 MiB IT while this thread renders; typed catches work on both threads', async () => {
    const result = await smokePlaybackArtifacts();
    expect(result.errors).toEqual([]);
    expect(result.quantaDuringCreate).toBeGreaterThan(1);
  }, 60_000);

  it('wasm starts with \\0asm and compiles', () => {
    const bytes = readFileSync(join(ROOT, 'public/worklets/libopenmpt-worklet.wasm'));
    expect([...bytes.subarray(0, 4)]).toEqual([0x00, 0x61, 0x73, 0x6d]);
    expect(inspectWasm(bytes).ok).toBe(true);
  });

  it('glue is not wasm2js and never replaces the global WebAssembly', () => {
    const glue = inspectGlue(readFileSync(join(ROOT, 'public/worklets/libopenmpt-worklet.js'), 'utf8'));
    expect(glue.isWasm2js).toBe(false);
    expect(glue.replacesGlobalWebAssembly).toBe(false);
    expect(glue.hasEsmExport).toBe(false);
    expect(glue.usesJsExceptionTrampolines).toBe(false);
    for (const name of REQUIRED_C_EXPORTS) expect(glue.cExports).toContain(name);
  });

  it('the wasm2js glue and the libmpt/ directory are gone (single engine, single artifact pair)', () => {
    expect(existsSync(join(ROOT, 'public/worklets/libopenmpt-audioworklet.js'))).toBe(false);
    expect(existsSync(join(ROOT, 'public/libmpt'))).toBe(false);
  });

  it('never exports a real stringToUTF8 (signature clash with the app polyfill)', () => {
    const glue = inspectGlue(readFileSync(join(ROOT, 'public/worklets/libopenmpt-worklet.js'), 'utf8'));
    for (const name of FORBIDDEN_RUNTIME_MEMBERS) {
      expect(glue.cExports).not.toContain(name);
    }
  });

  it.each(['worklet', 'playback'])(
    'libopenmpt-%s boots through the compiled processor in a fake AudioWorkletGlobalScope, renders, reports corrupt input and recovers a truncated IT',
    async (pair) => {
      const { errors, peak } = await smokeWorkletBoot({
        glue: join(ROOT, `public/worklets/libopenmpt-${pair}.js`),
        wasm: join(ROOT, `public/worklets/libopenmpt-${pair}.wasm`),
      });
      expect(errors).toEqual([]);
      expect(peak).toBeGreaterThan(0.01);
    },
    60_000,
  );

  it('boots in the worklet manner, renders audio, survives corrupt input and heap growth', async () => {
    const wasmBefore = globalThis.WebAssembly;
    const result = await smokeArtifacts();
    expect(result.errors).toEqual([]);
    expect(result.peak).toBeGreaterThan(0.01);
    // Evaluating the glue must leave the real WebAssembly API in place (CLAUDE.md pitfall 4).
    expect(globalThis.WebAssembly).toBe(wasmBefore);
  }, 60_000);
});
