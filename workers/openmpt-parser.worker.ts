import type { LibOpenMPT } from '../types';
import {
  createLibOpenMPTLocateFile,
  getLibOpenMPTJsUrl,
} from '../utils/libopenmptAssets';
import { waitForRuntimeInitialized } from '../audio-worklet/libRuntimeReady';
import { parseModuleWithLib } from '../utils/parseModuleWithLib';
import { mallocOrThrow } from '../utils/wasmHeap';
import { extractInstrumentTable, mergeLibInstrumentNames } from '../utils/sampleExtract';
import { parserLog, setParserDebugFromMainThread } from '../utils/parserDebug';
import type { InstrumentTable } from '../types/instruments';
import { readSongStructureFromBytes } from '../utils/readSongStructure';
import type { SongStructureRequest, SongStructureResponse } from '../utils/songStructureWorker';

const LIB_FETCH_TIMEOUT_MS = 12_000;

interface ParseRequest {
  type: 'parse';
  /** Mirrors WorkerParseRequest.id (types.ts): echoed on every reply to this request. */
  id?: number;
  fileData: Uint8Array;
  fileName: string;
  /** Mirrors WorkerParseRequest.debug (types.ts). */
  debug?: boolean;
}

interface ParseResponse {
  type: 'parsed';
  id?: number;
  patternMatrices: ReturnType<typeof parseModuleWithLib>['patternMatrices'];
  metadata: ReturnType<typeof parseModuleWithLib>['metadata'];
  instrumentTable: InstrumentTable;
}

interface ParseError {
  type: 'error';
  id?: number;
  message: string;
}

type ProgressStage = 'fetch' | 'wasm' | 'patterns' | 'instruments';

type IncomingMessage = ParseRequest | SongStructureRequest;

/**
 * One libopenmpt per worker: a song-structure worker serves every load of the page session, and so
 * does the (warm) parse worker — libopenmpt is fetched and compiled once, not once per parse.
 */
let libPromise: Promise<LibOpenMPT> | null = null;
function getLib(): Promise<LibOpenMPT> {
  libPromise ??= loadLibOpenMPT().catch((err: unknown) => {
    libPromise = null;
    throw err;
  });
  return libPromise;
}

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

  // Always wait for the runtime: the real-wasm glue defines lazy `_openmpt_*` stubs at eval time,
  // so their presence does not mean the module is instantiated (audio-worklet/libRuntimeReady.ts).
  await waitForRuntimeInitialized(lib, 25000, 'WASM (worker)');

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
      const ptr = mallocOrThrow(lib, length, 'C string');
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

/** An error reply; without `id` it is a worker-level failure for every request in flight. */
function postError(message: string, id?: number): void {
  self.postMessage((id === undefined ? { type: 'error', message } : { type: 'error', id, message }) satisfies ParseError);
}

function postProgress(stage: ProgressStage, id: number | undefined): void {
  self.postMessage(id === undefined ? { type: 'progress', stage } : { type: 'progress', id, stage });
}

/**
 * Song map (#537): the order list on libopenmpt's clock, read on a scratch module of this worker —
 * never on the audio thread (#513). Its own request, after the parse, so it never delays playback.
 */
async function handleStructure(data: SongStructureRequest): Promise<void> {
  const { id, fileData } = data;
  try {
    const lib = await getLib();
    const structure = readSongStructureFromBytes(lib, fileData, data.budgetMs === undefined ? {} : { budgetMs: data.budgetMs });
    self.postMessage({ type: 'structure', id, structure } satisfies SongStructureResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Song structure failed';
    self.postMessage({ type: 'structure', id, error: message } satisfies SongStructureResponse);
  }
}

async function handleMessage(data: IncomingMessage): Promise<void> {
  if (data.type === 'structure') {
    await handleStructure(data);
    return;
  }
  const { type, id, fileData, fileName, debug } = data;

  if (type !== 'parse') {
    postError(`Unknown worker message type: ${String(type)}`, id);
    return;
  }

  setParserDebugFromMainThread(debug === true);

  parserLog('worker parse start', fileName, fileData.byteLength);
  postProgress('fetch', id);

  try {
    postProgress('wasm', id);
    const lib = await getLib();
    postProgress('patterns', id);
    const { patternMatrices, metadata } = parseModuleWithLib(lib, fileData, fileName);
    postProgress('instruments', id);
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
      ...(id === undefined ? {} : { id }),
      patternMatrices,
      metadata,
      instrumentTable,
    };
    self.postMessage(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown worker parse error';
    postError(message, id);
  }
}

self.onmessage = (e: MessageEvent<IncomingMessage>) => {
  void handleMessage(e.data).catch((err) => {
    const message = err instanceof Error ? err.message : 'Unknown parse error';
    console.error('[Parser worker]', message, err);
    postError(message, e.data?.type === 'parse' ? e.data.id : undefined);
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
