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
  });

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

  it('boots in the worklet manner, renders audio, survives corrupt input and heap growth', async () => {
    const wasmBefore = globalThis.WebAssembly;
    const result = await smokeArtifacts();
    expect(result.errors).toEqual([]);
    expect(result.peak).toBeGreaterThan(0.01);
    // Evaluating the glue must leave the real WebAssembly API in place (native engine needs it).
    expect(globalThis.WebAssembly).toBe(wasmBefore);
  }, 60_000);
});
