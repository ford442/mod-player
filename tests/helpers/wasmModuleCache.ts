/**
 * One compiled `WebAssembly.Module` per worker process for the committed libopenmpt binaries.
 * The `wasm` Vitest project runs with `isolate: false`, so this cache (kept on globalThis, which
 * survives across files there) turns "read + compile 1.4 MB per test file" into once per worker;
 * each caller still gets a fresh `instantiate()` (its own memory).
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const KEY = Symbol.for('xasm1.tests.wasmModuleCache');

type Cache = Map<string, Promise<WebAssembly.Module>>;

function cache(): Cache {
  const g = globalThis as unknown as Record<symbol, Cache | undefined>;
  return (g[KEY] ??= new Map());
}

/** Compiled module for a repo-relative wasm path, e.g. `public/worklets/libopenmpt-worklet.wasm`. */
export function getCompiledWasm(relPath: string): Promise<WebAssembly.Module> {
  const c = cache();
  let p = c.get(relPath);
  if (!p) {
    p = WebAssembly.compile(readFileSync(join(ROOT, relPath)));
    c.set(relPath, p);
  }
  return p;
}

/**
 * An Emscripten `Module.instantiateWasm` hook that instantiates the cached module. Emscripten
 * expects the hook to return `{}` (exports arrive asynchronously through `receive`).
 */
export function cachedInstantiateWasm(relPath: string) {
  return (
    imports: WebAssembly.Imports,
    receive: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
  ): Record<string, never> => {
    void getCompiledWasm(relPath).then(async (module) => {
      receive(await WebAssembly.instantiate(module, imports), module);
    });
    return {};
  };
}
