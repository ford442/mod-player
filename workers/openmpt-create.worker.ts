/**
 * Module-create worker for the JS AudioWorklet (#513).
 *
 * Joins the worklet's shared-memory libopenmpt heap (public/worklets/libopenmpt-playback.*) as a
 * wasm worker and runs openmpt_module_create_from_memory2 here, so parsing a large module — and
 * any heap growth it needs — happens on this thread while the audio thread keeps rendering the
 * previous module. The created module is handed to the worklet over a MessagePort; modules the
 * worklet stops rendering come back on the same port and are destroyed here. The contract and the
 * ownership rule are in audio-worklet/createThreadProtocol.ts.
 *
 * Boot: the glue is evaluated with Module.$ww set, the worklet's WebAssembly.Memory, and the
 * stack the worklet allocated (sb/sz). In that mode Emscripten skips the static constructors (the
 * worklet ran them) and calls emscripten_wasm_worker_initialize to set this thread's stack and TLS.
 * instantiateWasm is synchronous, so the runtime is up when the glue returns.
 *
 * Plain worker globals only (no Vite env, no DOM): tests run this same file under worker_threads.
 */
import {
  CREATE_FAILED_MESSAGE,
  CREATE_PORT,
  CREATE_WORKER,
  CREATE_WORKER_REPLY,
} from '../audio-worklet/createThreadProtocol';

interface PlaybackLib {
  _malloc(size: number): number;
  _free(ptr: number): void;
  _openmpt_module_create_from_memory2(
    filePtr: number, fileSize: number,
    logFunc: number, logUser: number, errFunc: number, errUser: number,
    errCode: number, errStr: number, ctls: number,
  ): number;
  _openmpt_module_destroy(modulePtr: number): void;
}

interface InitMessage {
  type: typeof CREATE_WORKER.init;
  scriptText: string;
  wasmModule: WebAssembly.Module;
  memory: WebAssembly.Memory;
  stackLow: number;
  stackSize: number;
}
interface AttachPortMessage {
  type: typeof CREATE_WORKER.attachPort;
  port: MessagePort;
}
interface CreateMessage {
  type: typeof CREATE_WORKER.create;
  seq: number;
  moduleData: ArrayBuffer;
}
type IncomingMessage = InitMessage | AttachPortMessage | CreateMessage;

let lib: PlaybackLib | null = null;
let memory: WebAssembly.Memory | null = null;
let worklet: MessagePort | null = null;

function reply(message: Record<string, unknown>): void {
  (self as unknown as { postMessage(m: unknown): void }).postMessage(message);
}

function boot(msg: InitMessage): void {
  const g = globalThis as Record<string, unknown>;
  g.libopenmpt = {
    $ww: 1,
    wasmMemory: msg.memory,
    sb: msg.stackLow,
    sz: msg.stackSize,
    instantiateWasm(
      imports: WebAssembly.Imports,
      receiveInstance: (instance: WebAssembly.Instance, module: WebAssembly.Module) => unknown,
    ) {
      return receiveInstance(new WebAssembly.Instance(msg.wasmModule, imports), msg.wasmModule);
    },
  };
  new Function(msg.scriptText.replace(/^\s*export\s+(default\s+)?/gm, '')).call(globalThis);
  const booted = g.libopenmpt as Partial<PlaybackLib> | undefined;
  if (!booted || typeof booted._openmpt_module_create_from_memory2 !== 'function' || typeof booted._malloc !== 'function') {
    throw new Error('playback glue did not expose the libopenmpt C API as a wasm worker');
  }
  lib = booted as PlaybackLib;
  memory = msg.memory;
}

function destroy(modulePtr: number): void {
  try {
    lib?._openmpt_module_destroy(modulePtr);
  } catch (err) {
    console.error('[CreateWorker] destroy failed (ignored):', err);
  }
}

function attach(port: MessagePort): void {
  if (worklet) worklet.onmessage = null;
  worklet = port;
  port.onmessage = (e: MessageEvent) => {
    const data = e.data as { type?: unknown; modulePtr?: unknown };
    if (data?.type === CREATE_PORT.destroy && typeof data.modulePtr === 'number' && data.modulePtr > 0) {
      destroy(data.modulePtr);
    }
  };
}

function create(msg: CreateMessage): void {
  const port = worklet;
  if (!lib || !memory || !port) {
    reply({ type: CREATE_WORKER_REPLY.created, seq: msg.seq, ok: false, createMs: 0, error: 'create worker not ready' });
    return;
  }
  const t0 = performance.now();
  const bytes = new Uint8Array(msg.moduleData);
  let modulePtr = 0;
  let failure = CREATE_FAILED_MESSAGE;
  const filePtr = lib._malloc(bytes.byteLength);
  if (!filePtr) {
    failure = '_malloc returned 0 – out of WASM heap memory';
  } else {
    try {
      // memory.buffer, not the glue's HEAPU8: the malloc above may just have grown the heap.
      new Uint8Array(memory.buffer, filePtr, bytes.byteLength).set(bytes);
      modulePtr = lib._openmpt_module_create_from_memory2(filePtr, bytes.byteLength, 0, 0, 0, 0, 0, 0, 0);
    } catch (err) {
      failure = `create trapped: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      lib._free(filePtr);
    }
  }
  const createMs = performance.now() - t0;
  if (modulePtr) {
    port.postMessage({ type: CREATE_PORT.staged, seq: msg.seq, modulePtr, createMs });
  } else {
    port.postMessage({ type: CREATE_PORT.failed, seq: msg.seq, message: failure });
  }
  reply({ type: CREATE_WORKER_REPLY.created, seq: msg.seq, ok: modulePtr !== 0, createMs });
}

self.onmessage = (e: MessageEvent) => {
  const msg = e.data as IncomingMessage;
  if (msg.type === CREATE_WORKER.init) {
    try {
      boot(msg);
      reply({ type: CREATE_WORKER_REPLY.ready });
    } catch (err) {
      reply({ type: CREATE_WORKER_REPLY.initFailed, message: err instanceof Error ? err.message : String(err) });
    }
  } else if (msg.type === CREATE_WORKER.attachPort) {
    attach(msg.port);
  } else if (msg.type === CREATE_WORKER.create) {
    create(msg);
  }
};
