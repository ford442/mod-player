/**
 * Module metadata probe. Ported from utils/__debug__/modMetadata.test.cjs.
 *
 * The old integration half downloaded the retired wasm2js glue from a CDN (network needed) and
 * read samples from the gitignored vendor/ tree, silently skipping them. This version loads the
 * committed real-WASM libopenmpt (public/worklets/libopenmpt-worklet.{js,wasm}) and uses committed
 * sample modules, so it runs offline and cannot skip.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LibOpenMPT } from '../types';
import { extractModuleMetadataWithLib, resolveModuleTitle, titleFromFileName } from '../utils/modMetadata';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

describe('title helpers', () => {
  it('titleFromFileName strips directories and the extension', () => {
    expect(titleFromFileName('folder/deep.mod')).toBe('deep');
    expect(titleFromFileName('C:\\mods\\win.xm')).toBe('win');
    expect(titleFromFileName('')).toBe('Unknown');
  });

  it('resolveModuleTitle prefers the embedded title, else the filename stem, else "Unknown"', () => {
    expect(resolveModuleTitle('Real Title', 'ignored.mod')).toBe('Real Title');
    expect(resolveModuleTitle('', 'artist/track.xm')).toBe('track');
    expect(resolveModuleTitle('   ', 'artist/track.xm')).toBe('track');
    expect(resolveModuleTitle('')).toBe('Unknown');
  });
});

describe('extractModuleMetadataWithLib failure paths (no WASM)', () => {
  class FakeLib {
    heap = new Uint8Array(256);
    _malloc() {
      return 0;
    }
    _free() {
      /* no-op */
    }
    get HEAPU8() {
      return this.heap;
    }
    _openmpt_module_create_from_memory2() {
      return 0;
    }
  }
  const fake = () => new FakeLib() as unknown as LibOpenMPT;

  it('returns the filename title plus a parseError when the module will not load', () => {
    const meta = extractModuleMetadataWithLib(fake(), new Uint8Array([0, 1, 2]), { fileName: 'broken.mod' });
    expect(meta.title).toBe('broken');
    expect(meta.parseError).toBeTruthy();
  });

  it('reports an empty file without touching the library', () => {
    const meta = extractModuleMetadataWithLib(fake(), new Uint8Array(0), { fileName: 'empty.xm' });
    expect(meta).toEqual({ title: 'empty', parseError: 'Empty file' });
  });

  it('reports a library that has not finished initialising', () => {
    const meta = extractModuleMetadataWithLib({} as unknown as LibOpenMPT, new Uint8Array([1]), { fileName: 'x.mod' });
    expect(meta.parseError).toBe('libopenmpt module API not ready');
  });
});

describe('extractModuleMetadataWithLib with the real libopenmpt WASM', () => {
  let lib: LibOpenMPT;
  const g = globalThis as Record<string, unknown>;
  const previous = g.libopenmpt;

  beforeAll(async () => {
    const glue = readFileSync(join(ROOT, 'public/worklets/libopenmpt-worklet.js'), 'utf8');
    const wasmBinary = readFileSync(join(ROOT, 'public/worklets/libopenmpt-worklet.wasm'));
    g.libopenmpt = { noInitialRun: true, wasmBinary };
    new Function(glue.replace(/^\s*export\s+(default\s+)?/gm, '')).call(globalThis);
    const raw = g.libopenmpt as Record<string, unknown> & { calledRun?: boolean; onRuntimeInitialized?: () => void };
    await new Promise<void>((resolveReady) => {
      if (raw.calledRun) resolveReady();
      else raw.onRuntimeInitialized = () => resolveReady();
    });
    // The glue deliberately does not export stringToUTF8 (its signature clashes with the app's
    // polyfill: it returns an allocated pointer), so provide the app-style one here.
    const l = raw as unknown as LibOpenMPT & { stringToUTF8?: (s: string) => number };
    l.stringToUTF8 = (s: string) => {
      const bytes = new TextEncoder().encode(s);
      const ptr = l._malloc(bytes.length + 1);
      l.HEAPU8.set(bytes, ptr);
      l.HEAPU8[ptr + bytes.length] = 0;
      return ptr;
    };
    lib = l;
  }, 30_000);

  afterAll(() => {
    // Leave no global behind for other test files in this worker.
    if (previous === undefined) delete g.libopenmpt;
    else g.libopenmpt = previous;
  });

  const sample = (relative: string) => new Uint8Array(readFileSync(join(ROOT, relative)));

  it.each([
    ['public/test.xm', 'test.xm'],
    ['public/libopenmpt-test.mod', 'libopenmpt-test.mod'],
    ['public/4-mat_madness.mod', '4-mat_madness.mod'],
    ['tests/fixtures/minimal.it', 'minimal.it'],
  ])('reads valid metadata from %s', (path, fileName) => {
    const meta = extractModuleMetadataWithLib(lib, sample(path), { fileName });
    expect(meta.parseError).toBeUndefined();
    expect(meta.title.length).toBeGreaterThan(0);
    expect(meta.type).toBeTruthy();
  });

  it('identifies the tracker format of each sample', () => {
    const typeOf = (path: string) => extractModuleMetadataWithLib(lib, sample(path), { fileName: path }).type;
    expect(typeOf('public/test.xm')).toBe('xm');
    expect(typeOf('tests/fixtures/minimal.it')).toBe('it');
  });

  it('falls back to the filename title with a parseError for non-module bytes', () => {
    const garbage = new Uint8Array(512).map((_, i) => (i * 37) & 0xff);
    const meta = extractModuleMetadataWithLib(lib, garbage, { fileName: 'notamodule.mod' });
    expect(meta.title).toBe('notamodule');
    expect(meta.parseError).toBeTruthy();
  });
});
