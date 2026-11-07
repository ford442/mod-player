/**
 * One compiled WebAssembly.Module per worker (#535).
 *
 * Each real-WASM test used to read and compile the 1.4 MB libopenmpt binary itself. `sharedWasmModule`
 * compiles each file once (cached on globalThis, so it also survives the wasm project's `isolate: false`
 * across test files) and callers instantiate it per test.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const KEY = Symbol.for('xasm1.sharedWasmModules');

type Cache = Map<string, Promise<WebAssembly.Module>>;

/** @param file a name under public/worklets/, e.g. `libopenmpt-worklet.wasm` */
export function sharedWasmModule(file: string): Promise<WebAssembly.Module> {
  const g = globalThis as unknown as Record<symbol, Cache | undefined>;
  const cache = (g[KEY] ??= new Map());
  let module = cache.get(file);
  if (!module) {
    module = WebAssembly.compile(readFileSync(join(ROOT, 'public/worklets', file)));
    cache.set(file, module);
  }
  return module;
}
