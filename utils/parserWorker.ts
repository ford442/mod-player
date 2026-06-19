import type { WorkerParseMessage, WorkerParseResult } from '../types';
import { parserLog } from './parserDebug';

export const PARSER_WORKER_TIMEOUT_MS = 15_000;
export const PARSER_SLOW_HINT_MS = 5_000;

/** Resolved worker script URL (hashed chunk in production). */
export function getParserWorkerUrl(): string {
  return new URL('../workers/openmpt-parser.worker.ts', import.meta.url).href;
}

/** HEAD-check parser worker availability (mirrors useWorkletLoader.verifyWorkletFile). */
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
  onProgress?: (stage: 'wasm' | 'patterns') => void,
  timeoutMs: number = PARSER_WORKER_TIMEOUT_MS,
): Promise<WorkerParseResult> {
  const { fileName } = message;

  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Parser timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const onMessage = (e: MessageEvent<WorkerParseResult>) => {
      const data = e.data;
      if (data?.type === 'progress') {
        parserLog('worker progress', fileName, data.stage);
        onProgress?.(data.stage);
        return;
      }
      cleanup();
      parserLog('worker response', fileName, data?.type);
      resolve(data);
    };
    const onError = (e: ErrorEvent) => {
      cleanup();
      reject(new Error(e.message || 'Parser worker error'));
    };
    const onMessageError = () => {
      cleanup();
      reject(new Error('Parser worker message deserialization failed'));
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      worker.removeEventListener('messageerror', onMessageError);
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.addEventListener('messageerror', onMessageError);
    parserLog('posting to worker', fileName, message.fileData.byteLength);
    worker.postMessage(message, transfer);
  });
}
