/**
 * Minimal typed surface of the libopenmpt wasm2js module, as seen from the
 * audio thread. Only the exports the processor actually calls are declared —
 * anything else would be dead weight in the bundle and untestable here.
 *
 * Pointers are plain numbers (wasm linear-memory offsets).
 */

export interface LibOpenMPTWasm {
  _malloc(bytes: number): number;
  _free(ptr: number): void;

  _openmpt_module_create_from_memory2?(
    filePtr: number,
    byteLength: number,
    logFn: number,
    logUser: number,
    errFn: number,
    errUser: number,
    errorOut: number,
    errorMessageOut: number,
    ctls: number,
  ): number;
  _openmpt_module_create_from_memory?(
    filePtr: number,
    byteLength: number,
    logFn: number,
    logUser: number,
    ctls: number,
  ): number;
  _openmpt_module_destroy(modulePtr: number): void;

  _openmpt_module_read_float_stereo(
    modulePtr: number,
    sampleRate: number,
    frames: number,
    leftPtr: number,
    rightPtr: number,
  ): number;

  _openmpt_module_set_position_order_row(modulePtr: number, order: number, row: number): number;
  _openmpt_module_set_render_param?(modulePtr: number, param: number, value: number): number;

  _openmpt_module_get_current_row(modulePtr: number): number;
  _openmpt_module_get_current_order(modulePtr: number): number;
  _openmpt_module_get_position_seconds(modulePtr: number): number;
  _openmpt_module_get_current_estimated_bpm(modulePtr: number): number;
  _openmpt_module_get_current_speed(modulePtr: number): number;
  _openmpt_module_get_num_channels(modulePtr: number): number;
  _openmpt_module_get_current_channel_vu_mono(modulePtr: number, channel: number): number;
  _openmpt_module_get_current_playing_channels?(modulePtr: number): number;

  HEAPU8: Uint8Array;
  HEAPF32: Float32Array;

  /** Emscripten runtime hooks used while waiting for wasm init. */
  calledRun?: boolean;
  onRuntimeInitialized?: () => void;
}

/** Globals the processor parks on AudioWorkletGlobalScope (shared across nodes). */
export interface WorkletGlobalBag {
  crypto?: { getRandomValues<T extends ArrayBufferView>(array: T): T };
  performance?: { now(): number };
  setTimeout?: (fn: () => void, delayMs?: number) => number;
  clearTimeout?: (id: number) => void;
  __workletTimers?: Map<number, { fn: () => void; deadline: number }>;
  /** Emscripten Module object the glue script populates. */
  libopenmpt?: { noInitialRun?: boolean; wasmBinary?: ArrayBuffer | Uint8Array };
  /** Singleton instance — one per AudioWorkletGlobalScope (#329). */
  __openmptWorkletLib?: LibOpenMPTWasm;
  __openmptWorkletLibInitPromise?: Promise<LibOpenMPTWasm>;
}

/** AudioWorkletGlobalScope, typed for the handful of slots we own. */
export const G = globalThis as unknown as WorkletGlobalBag & typeof globalThis;
