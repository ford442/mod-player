import type { LibOpenMPT } from '../types';
import { createLibOpenMPTLocateFile, getLibOpenMPTJsUrl } from './libopenmptAssets';

const LIB_FETCH_TIMEOUT_MS = 30_000;
const RUNTIME_INIT_TIMEOUT_MS = 30_000;

type LibOpenMPTGlobal = LibOpenMPT & {
  calledRun?: boolean;
  onRuntimeInitialized?: () => void;
};

/**
 * Load and initialize libopenmpt inside a Web Worker (or any isolated global).
 * Mirrors the parser worker bootstrap path.
 */
export async function loadLibOpenMPTInWorker(): Promise<LibOpenMPT> {
  const jsUrl = getLibOpenMPTJsUrl();
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
    throw new Error(`Failed to fetch libopenmpt JS: ${response.status} ${response.statusText}`);
  }

  const scriptText = await response.text();
  (globalThis as Record<string, unknown>).libopenmpt = {
    noInitialRun: true,
    locateFile: createLibOpenMPTLocateFile(),
  };

  const cleanedScript = scriptText.replace(/^\s*export\s+(default\s+)?/gm, '');
  const fn = new Function(cleanedScript);
  fn.call(globalThis);

  const lib = (globalThis as { libopenmpt?: LibOpenMPTGlobal }).libopenmpt;
  if (!lib || typeof lib !== 'object') {
    throw new Error('globalThis.libopenmpt not set after script evaluation');
  }

  if (!lib._openmpt_module_create_from_memory2 && !(lib as LibOpenMPT & { _openmpt_module_create_from_memory?: unknown })._openmpt_module_create_from_memory) {
    await new Promise<void>((resolve, reject) => {
      const timeout = self.setTimeout(
        () => reject(new Error('WASM onRuntimeInitialized timeout in worker')),
        RUNTIME_INIT_TIMEOUT_MS,
      );
      if (lib.calledRun) {
        self.clearTimeout(timeout);
        resolve();
        return;
      }
      const prev = lib.onRuntimeInitialized;
      lib.onRuntimeInitialized = () => {
        self.clearTimeout(timeout);
        if (typeof prev === 'function') prev();
        resolve();
      };
    });
  }

  if (!lib.UTF8ToString) {
    lib.UTF8ToString = (ptr: number) => {
      let str = '';
      if (!ptr) return str;
      const heap = lib.HEAPU8;
      for (let i = 0; ; i++) {
        const byte = heap[ptr + i];
        if (byte === undefined || byte === 0) break;
        str += String.fromCharCode(byte);
      }
      return str;
    };
  }

  if (!lib.stringToUTF8) {
    const encoder = new TextEncoder();
    lib.stringToUTF8 = (str: string) => {
      const bytes = encoder.encode(str + '\0');
      const ptr = lib._malloc(bytes.length);
      lib.HEAPU8.set(bytes, ptr);
      return ptr;
    };
  }

  return lib;
}
