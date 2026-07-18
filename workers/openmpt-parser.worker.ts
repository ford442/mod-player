import type { LibOpenMPT } from '../types';
import {
  createLibOpenMPTLocateFile,
  getLibOpenMPTJsUrl,
} from '../utils/libopenmptAssets';
import { parseModuleWithLib } from '../utils/parseModuleWithLib';
import { extractInstrumentTable, mergeLibInstrumentNames } from '../utils/sampleExtract';
import { parserLog } from '../utils/parserDebug';
import type { InstrumentTable } from '../types/instruments';

const LIB_FETCH_TIMEOUT_MS = 12_000;

interface ParseRequest {
  type: 'parse';
  fileData: Uint8Array;
  fileName: string;
}

interface ParseResponse {
  type: 'parsed';
  patternMatrices: ReturnType<typeof parseModuleWithLib>['patternMatrices'];
  metadata: ReturnType<typeof parseModuleWithLib>['metadata'];
  instrumentTable: InstrumentTable;
}

interface ParseError {
  type: 'error';
  message: string;
}

type IncomingMessage = ParseRequest;

async function loadLibOpenMPT(): Promise<LibOpenMPT> {
  const jsUrl = getLibOpenMPTJsUrl();
  parserLog('worker fetching libopenmpt', jsUrl);
  const abortController = new AbortController();
  const fetchTimeout = self.setTimeout(
    () => abortController.abort('libopenmpt fetch timeout'),
    LIB_FETCH_TIMEOUT_MS,
  );

  let response: Response;
  try {
    response = await fetch(jsUrl, { signal: abortController.signal });
  } finally {
    self.clearTimeout(fetchTimeout);
  }

  if (!response.ok) {
    throw new Error(
      `Failed to fetch libopenmpt JS: ${response.status} ${response.statusText}`,
    );
  }
  const scriptText = await response.text();

  (globalThis as Record<string, unknown>).libopenmpt = {
    noInitialRun: true,
    locateFile: createLibOpenMPTLocateFile(),
  };

  const cleanedScript = scriptText.replace(/^\s*export\s+(default\s+)?/gm, '');
  const fn = new Function(cleanedScript);  
  fn.call(globalThis);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lib = (globalThis as any).libopenmpt;
  if (!lib || typeof lib !== 'object') {
    throw new Error('globalThis.libopenmpt not set after script evaluation');
  }

  if (!lib._openmpt_module_create_from_memory) {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('WASM onRuntimeInitialized timeout in worker')),
        25000,
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

  parserLog('worker libopenmpt WASM ready');
  return lib as LibOpenMPT;
}

function postError(message: string): void {
  self.postMessage({ type: 'error', message } satisfies ParseError);
}

async function handleMessage(data: IncomingMessage): Promise<void> {
  const { type, fileData, fileName } = data;

  if (type !== 'parse') {
    postError(`Unknown worker message type: ${type}`);
    return;
  }

  parserLog('worker parse start', fileName, fileData.byteLength);
  self.postMessage({ type: 'progress', stage: 'fetch' } satisfies { type: 'progress'; stage: 'fetch' });

  try {
    self.postMessage({ type: 'progress', stage: 'wasm' } satisfies { type: 'progress'; stage: 'wasm' });
    const lib = await loadLibOpenMPT();
    self.postMessage({ type: 'progress', stage: 'patterns' } satisfies { type: 'progress'; stage: 'patterns' });
    const { patternMatrices, metadata } = parseModuleWithLib(lib, fileData, fileName);
    self.postMessage({ type: 'progress', stage: 'instruments' } satisfies { type: 'progress'; stage: 'instruments' });
    const instrumentTable = mergeLibInstrumentNames(
      extractInstrumentTable(fileData, fileName),
      metadata.instruments,
    );
    parserLog(
      'worker parse done',
      metadata.numOrders,
      'orders',
      patternMatrices.length,
      'matrices',
      instrumentTable.samples.length,
      'samples',
    );

    const response: ParseResponse = {
      type: 'parsed',
      patternMatrices,
      metadata,
      instrumentTable,
    };
    self.postMessage(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown worker parse error';
    postError(message);
  }
}

self.onmessage = (e: MessageEvent<IncomingMessage>) => {
  void handleMessage(e.data).catch((err) => {
    const message = err instanceof Error ? err.message : 'Unknown parse error';
    console.error('[Parser worker]', message, err);
    postError(message);
  });
};

self.onerror = (event: Event | string) => {
  const message = typeof event === 'string' ? event : 'Worker script error';
  console.error('[Parser worker] onerror', message);
  postError(message);
};

self.onmessageerror = () => {
  postError('Worker message deserialization failed');
};
