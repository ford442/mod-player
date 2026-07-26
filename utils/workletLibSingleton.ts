/**
 * Shared-scope libopenmpt singleton for the JS AudioWorklet path (#329).
 * Testable mirror of ensureSharedLibOpenMPT in public/worklets/openmpt-worklet.js.
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

function hasWasmBytes(wasmBytes: ArrayBuffer | Uint8Array | null | undefined): boolean {
  if (!wasmBytes) return false;
  return wasmBytes.byteLength > 0;
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

      globals.libopenmpt = { noInitialRun: true };
      if (hasWasmBytes(wasmBytes)) {
        globals.libopenmpt.wasmBinary = wasmBytes as ArrayBuffer;
      }

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
