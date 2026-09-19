/**
 * "Is this Emscripten libopenmpt callable yet?" — shared by the AudioWorklet processor and the
 * parser-worker loaders (pure: no DOM, bundled into the worklet by esbuild).
 *
 * With real WebAssembly the exports are bound only after the async instantiate finishes, and
 * depending on emsdk version the glue defines *lazy wrapper stubs* for `_openmpt_*` at evaluation
 * time — so `typeof lib._openmpt_module_create_from_memory2 === 'function'` is true long before
 * the module is usable and `_malloc` may not exist yet (that check was correct for wasm2js, whose
 * exports were synchronous, and broke the first real-wasm build: "_malloc is not a function").
 * `calledRun` / `onRuntimeInitialized` is the only reliable signal.
 */

export interface EmscriptenRuntimeState {
  calledRun?: boolean | undefined;
  onRuntimeInitialized?: (() => void) | undefined;
  onAbort?: ((what: unknown) => void) | undefined;
}

/**
 * Resolves once the runtime has initialised. Rejects on timeout, or immediately if the glue
 * aborts during init (e.g. the wasm could not be instantiated) instead of hanging until the
 * timeout. Chains any handlers already installed on the module object.
 */
export function waitForRuntimeInitialized(
  lib: EmscriptenRuntimeState,
  timeoutMs: number,
  what = 'WASM',
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (lib.calledRun) {
      resolve();
      return;
    }
    const timer = setTimeout(
      () => reject(new Error(`${what} onRuntimeInitialized timeout (${timeoutMs} ms)`)),
      timeoutMs,
    );

    const prevInit = lib.onRuntimeInitialized;
    lib.onRuntimeInitialized = () => {
      clearTimeout(timer);
      if (typeof prevInit === 'function') prevInit();
      resolve();
    };

    const prevAbort = lib.onAbort;
    lib.onAbort = (reason) => {
      clearTimeout(timer);
      if (typeof prevAbort === 'function') prevAbort(reason);
      reject(new Error(`${what} aborted during init: ${String(reason)}`));
    };
  });
}
