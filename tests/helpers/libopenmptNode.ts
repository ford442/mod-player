/**
 * Boots the committed real-WASM libopenmpt (public/worklets/libopenmpt-worklet.{js,wasm}) on the
 * test's own globalThis, the way the main thread and the export worker use it. `restore()` puts
 * back whatever `globalThis.libopenmpt` was before, so no global leaks into other test files.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LibOpenMPT } from '../../types';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

export async function loadLibOpenMPTNode(): Promise<{ lib: LibOpenMPT; restore: () => void }> {
  const g = globalThis as Record<string, unknown>;
  const previous = g.libopenmpt;
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
  const restore = () => {
    if (previous === undefined) delete g.libopenmpt;
    else g.libopenmpt = previous;
  };
  return { lib: l, restore };
}
