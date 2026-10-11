/**
 * Shared-scope libopenmpt singleton for the JS AudioWorklet (#329).
 *
 * Every AudioWorkletNode created on the page shares one AudioWorkletGlobalScope, so libopenmpt must
 * be initialised once per scope: re-evaluating the glue and re-instantiating the wasm on each node
 * resets heap state and breaks module reload (XM/MOD).
 *
 * This module is the policy — reuse, one shared init promise for concurrent callers, and the
 * real-wasm-bytes guards — and nothing else. The part that depends on the host (evaluating the glue,
 * polyfills, waiting for the runtime) is the injected `bootstrap`. That lets the *same code* that runs
 * inside the worklet (esbuild bundles it into public/worklets/openmpt-worklet.js) be unit-tested with
 * a fake holder and bootstrap, instead of testing a hand-copied mirror of it.
 *
 * It must not touch DOM or worklet globals and must typecheck under both tsconfig.json (DOM lib) and
 * tsconfig.worklet.json (ES2020, no DOM).
 */

/**
 * The only thing the singleton needs to know about an initialised library. Optional because the
 * glue defines its exports lazily: an instance is only reusable once this is actually a function.
 */
export interface SharedLibraryLike {
  _openmpt_module_create_from_memory2?: unknown;
}

/** Where the singleton lives: `globalThis` in the worklet, a plain object in tests. */
export interface SharedLibHolder<L> {
  __openmptWorkletLib?: L | undefined;
  __openmptWorkletLibInitPromise?: Promise<L> | undefined;
}

export interface EnsureSharedLibDeps<L> {
  /**
   * Evaluate the glue seeded with the wasm bytes and resolve with a READY instance (runtime
   * initialised). Runs at most once per holder, no matter how many callers race.
   */
  bootstrap: (scriptText: string, wasmBytes: ArrayBuffer | Uint8Array) => Promise<L>;
  log?: (...args: unknown[]) => void;
}

export function hasWasmBytes(
  wasmBytes: ArrayBuffer | Uint8Array | null | undefined,
): wasmBytes is ArrayBuffer | Uint8Array {
  return wasmBytes != null && wasmBytes.byteLength > 0;
}

/** WebAssembly binary magic: \0asm. Guards against an HTML 404 body being seeded as wasmBinary. */
export function hasWasmMagic(wasmBytes: ArrayBuffer | Uint8Array): boolean {
  const head = wasmBytes instanceof Uint8Array
    ? wasmBytes
    : new Uint8Array(wasmBytes, 0, Math.min(4, wasmBytes.byteLength));
  return head.length >= 4 && head[0] === 0x00 && head[1] === 0x61 && head[2] === 0x73 && head[3] === 0x6d;
}

function isReady(lib: SharedLibraryLike | undefined): boolean {
  return lib != null && typeof lib._openmpt_module_create_from_memory2 === 'function';
}

/**
 * Initialise libopenmpt once per holder (AudioWorkletGlobalScope in production) and return it.
 * Concurrent callers share one init promise; later callers get the instance back without evaluating
 * anything. Argument validation happens inside the shared promise, so a bad `initLib` fails every
 * waiting caller the same way (and, as before, the failed promise stays cached — a retry in the same
 * scope needs a fresh scope).
 */
export async function ensureSharedLib<L extends SharedLibraryLike>(
  holder: SharedLibHolder<L>,
  scriptText: string | undefined,
  wasmBytes: ArrayBuffer | Uint8Array | null | undefined,
  deps: EnsureSharedLibDeps<L>,
): Promise<L> {
  const existing = holder.__openmptWorkletLib;
  if (existing && isReady(existing)) {
    deps.log?.('Reusing shared libopenmpt instance');
    return existing;
  }

  if (!holder.__openmptWorkletLibInitPromise) {
    holder.__openmptWorkletLibInitPromise = (async () => {
      if (!scriptText) {
        throw new Error('initLib missing scriptText');
      }

      // The worklet scope has no fetch(): the real .wasm must arrive as bytes. Fail loudly (and
      // early) instead of letting the glue try — and time out on — a network fetch it can't do.
      if (!hasWasmBytes(wasmBytes)) {
        throw new Error('initLib missing wasmBytes (libopenmpt-worklet.wasm) — the JS engine is real WebAssembly');
      }
      if (!hasWasmMagic(wasmBytes)) {
        throw new Error('initLib wasmBytes is not a WebAssembly binary (missing \\0asm magic)');
      }

      const lib = await deps.bootstrap(scriptText, wasmBytes);
      holder.__openmptWorkletLib = lib;
      return lib;
    })();
  }

  return holder.__openmptWorkletLibInitPromise;
}
