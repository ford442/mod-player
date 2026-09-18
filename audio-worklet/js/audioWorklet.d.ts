/**
 * Minimal ambient AudioWorkletGlobalScope typings.
 *
 * TypeScript ships no built-in "AudioWorklet" lib (unlike "DOM" / "WebWorker"),
 * and lib.dom.d.ts's AudioWorkletProcessor typings assume a *window* context
 * that also has the rest of the DOM — which is not true inside
 * AudioWorkletGlobalScope. This file declares exactly the globals the
 * processor source actually touches, scoped to tsconfig.worklet.json only
 * (audio-worklet/js/** is excluded from the app's main tsconfig.json), so
 * none of this leaks into DOM-lib application code.
 */

type NumericTypedArray = { length: number; [index: number]: number };

interface WorkletCrypto {
  getRandomValues(array: NumericTypedArray): NumericTypedArray;
}

declare var crypto: WorkletCrypto | undefined;
declare var self: { crypto: WorkletCrypto | undefined } | undefined;

declare var performance: { now(): number } | undefined;

declare var setTimeout: (fn: () => void, delayMs?: number) => number;
declare var clearTimeout: (id: number | undefined | null) => void;

interface WorkletTimerEntry {
  fn: () => void;
  deadline: number;
}
declare var __workletTimers: Map<number, WorkletTimerEntry> | undefined;

interface WorkletConsole {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}
declare var console: WorkletConsole;

/** AudioWorkletGlobalScope render clock — seconds since the graph started. */
declare var currentTime: number;
/** AudioWorkletGlobalScope render sample rate (Hz), fixed for the node's lifetime. */
declare var sampleRate: number;

interface AudioWorkletCtorOptions {
  processorOptions?: Record<string, unknown>;
}

interface WorkletMessageEvent {
  data: unknown;
}

interface WorkletMessagePort {
  onmessage: ((event: WorkletMessageEvent) => unknown) | null;
  postMessage(message: unknown, transfer?: readonly ArrayBuffer[]): void;
}

declare class AudioWorkletProcessor {
  constructor(options?: AudioWorkletCtorOptions);
  readonly port: WorkletMessagePort;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: new (options?: AudioWorkletCtorOptions) => AudioWorkletProcessor,
): void;

/**
 * Shape of the evaluated libopenmpt wasm2js glue (`globalThis.libopenmpt`
 * after `new Function(scriptText)` runs). Only the members the processor
 * actually calls are declared — the real Emscripten module object has many
 * more (Module.HEAP*, etc.) that are irrelevant here.
 */
interface LibOpenMPT {
  calledRun?: boolean;
  onRuntimeInitialized?: (() => void) | undefined;
  HEAPU8: Uint8Array;
  HEAPF32: Float32Array;
  _malloc(size: number): number;
  _free(ptr: number): void;
  _openmpt_module_create_from_memory2?: (
    filePtr: number,
    fileSize: number,
    logFunc: number,
    logUser: number,
    errFunc: number,
    errUser: number,
    errCode: number,
    errStr: number,
    ctls: number,
  ) => number;
  _openmpt_module_create_from_memory?: (
    filePtr: number,
    fileSize: number,
    logFunc: number,
    logUser: number,
    errFunc: number,
    errUser: number,
    errCode: number,
    errStr: number,
    ctls: number,
  ) => number;
  _openmpt_module_destroy(modulePtr: number): void;
  _openmpt_module_set_render_param(modulePtr: number, param: number, value: number): number;
  _openmpt_module_get_num_channels(modulePtr: number): number;
  _openmpt_module_get_current_row(modulePtr: number): number;
  _openmpt_module_get_current_order(modulePtr: number): number;
  _openmpt_module_get_position_seconds(modulePtr: number): number;
  _openmpt_module_get_current_estimated_bpm(modulePtr: number): number;
  _openmpt_module_get_current_speed(modulePtr: number): number;
  _openmpt_module_get_current_playing_channels?: (modulePtr: number) => number;
  _openmpt_module_read_float_stereo(
    modulePtr: number,
    sampleRateHz: number,
    framesToRender: number,
    leftBufPtr: number,
    rightBufPtr: number,
  ): number;
  _openmpt_module_get_current_channel_vu_mono(modulePtr: number, channel: number): number;
  _openmpt_module_set_position_order_row(modulePtr: number, order: number, row: number): number;
  _openmpt_module_ctl_set_text?: (modulePtr: number, keyPtr: number, valuePtr: number) => number;
}

declare var libopenmpt: { noInitialRun?: boolean; wasmBinary?: ArrayBuffer | Uint8Array } | undefined;
declare var __openmptWorkletLib: LibOpenMPT | undefined;
declare var __openmptWorkletLibInitPromise: Promise<LibOpenMPT> | undefined;
