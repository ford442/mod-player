import type { WorkerParseMessage, WorkerParseResult, WorkerParseResponse, WorkerParseError } from '../types';
import { parserLog } from './parserDebug';
import { createParserPromise } from './parserPromise';

export const PARSER_WORKER_TIMEOUT_MS = 15_000;
export const PARSER_SLOW_HINT_MS = 5_000;

/** Resolved worker script URL (hashed chunk in production). */
export function getParserWorkerUrl(): string {
  return new URL('../workers/openmpt-parser.worker.ts', import.meta.url).href;
}

/**
 * HEAD-check parser worker availability.
 * Note: this is diagnostic-only. In production Vite hashes worker chunks, so the
 * source `.ts` URL used here may 404 even though the emitted worker chunk is valid.
 * The real availability test is attempting `new Worker(...)` and handling errors.
 */
export async function verifyParserWorkerUrl(): Promise<boolean> {
  const url = getParserWorkerUrl();
  try {
    const response = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    const ok = response.ok;
    console.log(`[Parser] worker HEAD ${url} → ${response.status}`);
    return ok;
  } catch (err) {
    console.warn('[Parser] worker HEAD check failed:', err);
    return false;
  }
}

export function createParserWorker(onFatalError?: (message: string) => void): Worker {
  const worker = new Worker(
    new URL('../workers/openmpt-parser.worker.ts', import.meta.url),
    { type: 'module' },
  );
  worker.addEventListener('error', (event) => {
    const message =
      typeof event === 'string'
        ? event
        : event instanceof ErrorEvent
          ? event.message
          : 'Parser worker script error';
    console.error('[Parser] worker script error:', message);
    onFatalError?.(message);
  });
  worker.addEventListener('messageerror', () => {
    console.error('[Parser] worker messageerror (structured clone failed)');
    onFatalError?.('Parser worker message deserialization failed');
  });
  return worker;
}

export function parseInWorker(
  worker: Worker,
  message: WorkerParseMessage,
  transfer: Transferable[],
  onProgress?: (stage: 'fetch' | 'wasm' | 'patterns' | 'instruments') => void,
  timeoutMs: number = PARSER_WORKER_TIMEOUT_MS,
): Promise<WorkerParseResponse | WorkerParseError> {
  const { fileName } = message;

  const { promise } = createParserPromise<WorkerParseResult>(
    worker,
    timeoutMs,
    () => {
      parserLog('posting to worker', fileName, message.fileData.byteLength);
      worker.postMessage(message, transfer);
    },
    {
      shouldResolve: (data) => data?.type !== 'progress',
      onIntermediate: (data) => {
        if (data.type === 'progress') {
          parserLog('worker progress', fileName, data.stage);
          onProgress?.(data.stage);
        }
      },
    },
  );

  // Progress messages are handled by onIntermediate and never resolve the promise.
  return promise as Promise<WorkerParseResponse | WorkerParseError>;
}
