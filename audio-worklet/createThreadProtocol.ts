/**
 * Module create off the audio thread (#513) — the contract between the three parties.
 *
 *   main thread ──create {seq, moduleData}──▶ create worker ──staged {modulePtr}──▶ AudioWorklet
 *                                                     ▲                                   │
 *                                                     └──────── destroy {modulePtr} ──────┘
 *
 * The worklet's libopenmpt is the shared-memory playback build (public/worklets/libopenmpt-playback.*,
 * `scripts/build-js-libopenmpt.sh --playback`). The worklet instantiates it as the heap's main
 * thread and only renders. The create worker (workers/openmpt-create.worker.ts) instantiates the
 * same wasm against the worklet's WebAssembly.Memory as a wasm worker (its own stack + TLS, carved
 * from a block the worklet malloc'd: WORKLET_TO_MAIN.createHeap) and runs
 * openmpt_module_create_from_memory2 there, so a large file's parse — and any heap growth it
 * causes — never runs on the audio thread.
 *
 * Ownership is by message, never shared: a module pointer belongs to the worker until it posts
 * `staged`, to the worklet from then on, and back to the worker when the worklet posts `destroy`
 * (the module it replaced, or a staged one it never swapped in — a newer `staged` supersedes it).
 * Exactly one side owns a pointer at a time, and only the owner may free it.
 *
 * Pure: no DOM, no worklet globals. Bundled into the worklet (esbuild) and the create worker (Vite),
 * and imported by the main thread and tests.
 */

/** Main thread → create worker. */
export const CREATE_WORKER = {
  /** Boot the playback glue as a wasm worker on the worklet's heap. */
  init: 'init',
  /** The MessagePort whose other end the current AudioWorkletNode holds. */
  attachPort: 'attachPort',
  /** Create a module from these bytes; the result goes to the worklet over the port. */
  create: 'create',
} as const;

/** Create worker → main thread. */
export const CREATE_WORKER_REPLY = {
  ready: 'ready',
  initFailed: 'initFailed',
  /** Bookkeeping only (logs, diagnostics): the outcome itself reaches the worklet. */
  created: 'created',
} as const;

/** Create worker ↔ AudioWorklet, over the attached MessagePort. */
export const CREATE_PORT = {
  /** worker → worklet: a created module; the worklet now owns it. */
  staged: 'staged',
  /** worker → worklet: create failed; the worklet reports it like an in-worklet load error. */
  failed: 'failed',
  /** worklet → worker: a module the worklet no longer renders; the worker owns and frees it. */
  destroy: 'destroy',
} as const;

/**
 * Stack for the create thread, TLS included (it sits at the low end: emscripten_wasm_worker_initialize).
 * Same size as the heap's main stack (-sSTACK_SIZE in build-js-libopenmpt.sh): create is the deepest
 * call libopenmpt makes.
 */
export const CREATE_THREAD_STACK_BYTES = 1 << 20;

/** Emscripten requires a 16-byte aligned stack whose size is a multiple of 16. */
export const CREATE_THREAD_STACK_ALIGN = 16;

/** Same text an in-worklet load posts, so the main thread's handling does not care which path failed. */
export const CREATE_FAILED_MESSAGE = 'openmpt_module_create_from_memory returned 0 (invalid format?)';

/**
 * How long the worklet waits for process() to finish the fade-out before it swaps a staged module
 * in from the message handler instead (a suspended context runs no process()).
 */
export const STAGED_SWAP_TIMEOUT_MS = 100;

/** Align a raw malloc result (allocated `size + CREATE_THREAD_STACK_ALIGN` bytes) to a usable stack. */
export function alignCreateThreadStack(rawPtr: number, size: number): { stackLow: number; stackSize: number } {
  const a = CREATE_THREAD_STACK_ALIGN;
  return {
    stackLow: Math.ceil(rawPtr / a) * a,
    stackSize: Math.floor(size / a) * a,
  };
}
