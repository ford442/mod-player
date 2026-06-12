import { LibOpenMPT, PatternMatrix } from '../types';
import { getPatternMatrix } from '../utils/patternExtractor';

const CDN_JS_URL = 'https://wasm.noahcohn.com/libmpt/libopenmptjs.js';

interface ParseRequest {
  type: 'parse';
  fileData: Uint8Array;
  fileName: string;
}

interface ParseResponse {
  type: 'parsed';
  patternMatrices: PatternMatrix[];
  metadata: {
    title: string;
    numOrders: number;
    numChannels: number;
    initialBpm: number;
    durationSeconds: number;
    totalPatternRows: number;
    numInstruments: number;
    instruments: string[];
  };
}

interface ParseError {
  type: 'error';
  message: string;
}

type IncomingMessage = ParseRequest;
type OutgoingMessage = ParseResponse | ParseError;

async function loadLibOpenMPT(): Promise<LibOpenMPT> {
  const response = await fetch(CDN_JS_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch libopenmpt JS: ${response.status} ${response.statusText}`
    );
  }
  const scriptText = await response.text();

  // Pre-configure the Emscripten Module object so the script merges with it.
  (globalThis as Record<string, unknown>).libopenmpt = {
    noInitialRun: true,
  };

  // Strip ES module export statements — new Function() is a classic-script
  // context and will throw SyntaxError on any top-level `export` keyword.
  const cleanedScript = scriptText.replace(/^\s*export\s+(default\s+)?/gm, '');

  // Evaluate the Emscripten-generated script in the global scope.
  // new Function() runs with globalThis as its outer scope, so the script
  // sees (and modifies) globalThis.libopenmpt via normal variable lookup.
  const fn = new Function(cleanedScript); // eslint-disable-line no-new-func
  fn.call(globalThis);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lib = (globalThis as any).libopenmpt;
  if (!lib || typeof lib !== 'object') {
    throw new Error('globalThis.libopenmpt not set after script evaluation');
  }

  // Wait for WASM runtime initialization if it hasn't happened yet.
  if (!lib._openmpt_module_create_from_memory) {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('WASM onRuntimeInitialized timeout in worker')),
        25000
      );
      if (lib.calledRun) {
        clearTimeout(timeout);
        resolve();
      } else {
        const prev = lib.onRuntimeInitialized;
        lib.onRuntimeInitialized = () => {
          clearTimeout(timeout);
          if (typeof prev === 'function') prev();
          resolve();
        };
      }
    });
  }

  // Polyfill UTF8 helpers if missing (same polyfills used on main thread).
  if (!lib.UTF8ToString) {
    lib.UTF8ToString = (ptr: number) => {
      let str = '';
      if (!ptr) return str;
      const heap = lib.HEAPU8 as Uint8Array;
      for (let i = 0; ; i++) {
        const byte = heap[ptr + i];
        if (byte === undefined || byte === 0) break;
        str += String.fromCharCode(byte);
      }
      return str;
    };
  }
  if (!lib.stringToUTF8) {
    lib.stringToUTF8 = (jsString: string) => {
      const length = (jsString.length << 2) + 1;
      const ptr = lib._malloc(length);
      const heap = lib.HEAPU8 as Uint8Array;
      let i = 0;
      let j = 0;
      while (i < jsString.length) heap[ptr + j++] = jsString.charCodeAt(i++);
      heap[ptr + j] = 0;
      return ptr;
    };
  }

  return lib as LibOpenMPT;
}

self.onmessage = async (e: MessageEvent<IncomingMessage>) => {
  const { type, fileData, fileName } = e.data;

  if (type !== 'parse') {
    self.postMessage({
      type: 'error',
      message: `Unknown worker message type: ${type}`,
    } as OutgoingMessage);
    return;
  }

  try {
    const lib = await loadLibOpenMPT();

    const bufferSize = fileData.byteLength;
    const bufferPtr = lib._malloc(bufferSize);
    lib.HEAPU8.set(fileData, bufferPtr);

    const modPtr = lib._openmpt_module_create_from_memory2(
      bufferPtr,
      bufferSize,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    );
    lib._free(bufferPtr);

    if (modPtr === 0) {
      throw new Error('Failed to load module (invalid format?)');
    }

    // Read metadata
    const titlePtr = lib._openmpt_module_get_metadata(
      modPtr,
      lib.stringToUTF8('title')
    );
    const title = lib.UTF8ToString(titlePtr);
    lib._openmpt_free_string(titlePtr);

    const numOrders = lib._openmpt_module_get_num_orders(modPtr);
    const numChannels = lib._openmpt_module_get_num_channels(modPtr);
    const initialBpm = lib._openmpt_module_get_current_estimated_bpm(modPtr);
    const durationSeconds = lib._openmpt_module_get_duration_seconds(modPtr);
    const numInstruments = lib._openmpt_module_get_num_instruments(modPtr);

    const instruments: string[] = [];
    for (let i = 0; i < numInstruments; i++) {
      const namePtr = lib._openmpt_module_get_instrument_name(modPtr, i);
      instruments.push(lib.UTF8ToString(namePtr));
      lib._openmpt_free_string(namePtr);
    }

    // Build pattern matrices
    const matrices: PatternMatrix[] = [];
    let totalRows = 0;
    for (let i = 0; i < numOrders; i++) {
      const patIdx = lib._openmpt_module_get_order_pattern(modPtr, i);
      const matrix = getPatternMatrix(lib, modPtr, patIdx, i);
      matrices.push(matrix);
      totalRows += matrix.numRows;
    }

    // Clean up worker-side module instance — we only needed it for parsing.
    lib._openmpt_module_destroy(modPtr);

    const response: ParseResponse = {
      type: 'parsed',
      patternMatrices: matrices,
      metadata: {
        title: title || fileName,
        numOrders,
        numChannels,
        initialBpm,
        durationSeconds,
        totalPatternRows: totalRows,
        numInstruments,
        instruments,
      },
    };

    self.postMessage(response);
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : 'Unknown parse error';
    self.postMessage({
      type: 'error',
      message: errorMessage,
    } as OutgoingMessage);
  }
};
