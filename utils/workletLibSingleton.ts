/**
 * Shared-scope libopenmpt singleton for the JS AudioWorklet path (#329).
 * Testable mirror of ensureSharedLibOpenMPT in audio-worklet/js/openmpt-processor.ts.
 */

export interface WorkletLibHandle {
  _openmpt_module_create_from_memory2: (...args: unknown[]) => number;
}

export interface WorkletLibGlobals {
  libopenmpt?: { noInitialRun?: boolean; wasmBinary?: ArrayBuffer | Uint8Array };
  __openmptWorkletLib?: WorkletLibHandle;
  __openmptWorkletLibInitPromise?: Promise<WorkletLibHandle>;
}

export type WorkletLibEvalFn = (scriptText: string, globals: WorkletLibGlobals) => void | Promise<void>;

function hasWasmBytes(wasmBytes: ArrayBuffer | Uint8Array | null | undefined): wasmBytes is ArrayBuffer | Uint8Array {
  if (!wasmBytes) return false;
  return wasmBytes.byteLength > 0;
}

function hasWasmMagic(wasmBytes: ArrayBuffer | Uint8Array): boolean {
  const head = wasmBytes instanceof Uint8Array
    ? wasmBytes
    : new Uint8Array(wasmBytes, 0, Math.min(4, wasmBytes.byteLength));
  return head.length >= 4 && head[0] === 0x00 && head[1] === 0x61 && head[2] === 0x73 && head[3] === 0x6d;
}

/**
 * Initialise libopenmpt once per AudioWorkletGlobalScope (or test global bag).
 * Re-evaluating glue on every node creation corrupts the WASM heap.
 */
export async function ensureSharedLibOpenMPT(
  globals: WorkletLibGlobals,
  scriptText: string | undefined,
  wasmBytes: ArrayBuffer | Uint8Array | null | undefined,
  evalScript: WorkletLibEvalFn,
): Promise<WorkletLibHandle> {
  const existing = globals.__openmptWorkletLib;
  if (existing && typeof existing._openmpt_module_create_from_memory2 === 'function') {
    return existing;
  }

  if (!globals.__openmptWorkletLibInitPromise) {
    globals.__openmptWorkletLibInitPromise = (async () => {
      if (!scriptText) {
        throw new Error('initLib missing scriptText');
      }

      // Real WebAssembly only: the worklet scope has no fetch(), so the glue must be seeded with
      // the bytes (mirrors the guards in audio-worklet/js/openmpt-processor.ts).
      if (!hasWasmBytes(wasmBytes)) {
        throw new Error('initLib missing wasmBytes (libopenmpt-worklet.wasm) — the JS engine is real WebAssembly');
      }
      if (!hasWasmMagic(wasmBytes)) {
        throw new Error('initLib wasmBytes is not a WebAssembly binary (missing \\0asm magic)');
      }

      globals.libopenmpt = { noInitialRun: true, wasmBinary: wasmBytes };

      await evalScript(scriptText, globals);

      const lib = globals.__openmptWorkletLib;
      if (!lib || typeof lib._openmpt_module_create_from_memory2 !== 'function') {
        throw new Error('globalThis.__openmptWorkletLib not set after script evaluation');
      }

      return lib;
    })();
  }

  return globals.__openmptWorkletLibInitPromise;
}

/** Reset singleton state (tests only). */
export function resetWorkletLibSingleton(globals: WorkletLibGlobals): void {
  delete globals.__openmptWorkletLib;
  delete globals.__openmptWorkletLibInitPromise;
  delete globals.libopenmpt;
}
