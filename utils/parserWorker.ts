import type {
  WorkerParseError,
  WorkerParseMessage,
  WorkerParseProgress,
  WorkerParseResponse,
  WorkerParseResult,
} from '../types';
import { isParserDebugEnabled, parserLog } from './parserDebug';
import parserWorkerUrl from '../workers/openmpt-parser.worker.ts?worker&url';
import { createLogger } from './log';
import { recordFault } from './faultReport';

const log = createLogger('Parser');

export const PARSER_WORKER_TIMEOUT_MS = 15_000;
export const PARSER_SLOW_HINT_MS = 5_000;

/** Resolved worker script URL (hashed JS chunk in production). */
export function getParserWorkerUrl(): string {
  return parserWorkerUrl;
}

/**
 * HEAD-check parser worker availability (same hashed URL used by `new Worker`).
 * Diagnostic only — parse still attempts the worker even if HEAD fails.
 */
export async function verifyParserWorkerUrl(): Promise<boolean> {
  const url = getParserWorkerUrl();
  try {
    const response = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    const ok = response.ok;
    log.log(`worker HEAD ${url} → ${response.status}`);
    return ok;
  } catch (err) {
    console.warn('[Parser] worker HEAD check failed:', err);
    return false;
  }
}

export function createParserWorker(onFatalError?: (message: string) => void): Worker {
  const worker = new Worker(parserWorkerUrl, { type: 'module' });
  worker.addEventListener('error', (event) => {
    const message =
      typeof event === 'string'
        ? event
        : event instanceof ErrorEvent
          ? event.message
          : 'Parser worker script error';
    console.error('[Parser] worker script error:', message);
    recordFault({ kind: 'worker-error', source: 'parser-worker', message });
    onFatalError?.(message);
  });
  worker.addEventListener('messageerror', () => {
    console.error('[Parser] worker messageerror (structured clone failed)');
    onFatalError?.('Parser worker message deserialization failed');
  });
  return worker;
}

export type ParseProgressStage = WorkerParseProgress['stage'];

export interface ParserWorkerParseOptions {
  onProgress?: (stage: ParseProgressStage) => void;
  timeoutMs?: number;
}

/**
 * One warm parser worker for the page session (libopenmpt is fetched and compiled once, not per
 * parse). Requests carry ids, so parses superseded by a newer load still settle with their own
 * result. A worker that fails — script error, unreadable message, a reply-less error, a timeout
 * (it may be stuck in a parse) — is terminated, everything in flight on it rejects, and the next
 * parse starts a fresh one.
 */
export interface ParserWorkerClient {
  /**
   * Parse in the worker. `fileData`'s buffer is TRANSFERRED (it is detached afterwards): pass a
   * copy you own. Resolves with the worker's reply (`parsed` or a per-request `error`); rejects
   * when the worker itself fails or times out.
   */
  parse(fileData: Uint8Array, fileName: string, options?: ParserWorkerParseOptions): Promise<WorkerParseResponse | WorkerParseError>;
  /** Stop the worker and reject anything in flight (the page is tearing the player down). */
  terminate(): void;
}

interface PendingParse {
  fileName: string;
  resolve: (reply: WorkerParseResponse | WorkerParseError) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  onProgress: ((stage: ParseProgressStage) => void) | undefined;
}

export function createParserWorkerClient(
  options: {
    createWorker?: () => Worker;
    /** The worker script itself failed (load / syntax error): the caller stops using workers. */
    onFatalError?: (message: string) => void;
  } = {},
): ParserWorkerClient {
  const createWorker = options.createWorker ?? (() => createParserWorker(options.onFatalError));
  let worker: Worker | null = null;
  const pending = new Map<number, PendingParse>();
  let nextId = 1;

  /** Drop the current worker: terminate it and reject every request still waiting on it. */
  const failAll = (err: Error) => {
    const w = worker;
    worker = null;
    if (w) {
      w.onmessage = null;
      try { w.terminate(); } catch { /* ignore */ }
    }
    const waiting = [...pending.values()];
    pending.clear();
    for (const p of waiting) {
      clearTimeout(p.timer);
      p.reject(err);
    }
  };

  const onReply = (data: WorkerParseResult | undefined) => {
    if (!data || typeof data !== 'object') return;
    if (data.id === undefined) {
      // No id: the worker's own onerror / onmessageerror. Nothing in flight can trust it.
      if (data.type === 'error') failAll(new Error(data.message || 'Parser worker error'));
      return;
    }
    const p = pending.get(data.id);
    if (!p) return; // a request already settled (timed out with its worker) — not ours any more
    if (data.type === 'progress') {
      parserLog('worker progress', p.fileName, data.stage);
      p.onProgress?.(data.stage);
      return;
    }
    pending.delete(data.id);
    clearTimeout(p.timer);
    p.resolve(data);
  };

  const ensureWorker = (): Worker => {
    if (worker) return worker;
    const w = createWorker();
    w.onmessage = (e: MessageEvent<WorkerParseResult>) => {
      if (worker === w) onReply(e.data);
    };
    // createParserWorker's own listeners report a fatal script error to `onFatalError`; these drop
    // the worker so nothing in flight waits for a timeout.
    w.addEventListener('error', (e: ErrorEvent) => {
      if (worker === w) failAll(new Error(e.message || 'Parser worker error'));
    });
    w.addEventListener('messageerror', () => {
      if (worker === w) failAll(new Error('Parser worker message deserialization failed'));
    });
    worker = w;
    return w;
  };

  return {
    parse(fileData, fileName, parseOptions = {}) {
      const timeoutMs = parseOptions.timeoutMs ?? PARSER_WORKER_TIMEOUT_MS;
      return new Promise<WorkerParseResponse | WorkerParseError>((resolve, reject) => {
        const id = nextId++;
        const timer = setTimeout(() => {
          // A parse that never answers has hung the worker: everything queued behind it would too.
          failAll(new Error(`Parser timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        pending.set(id, { fileName, resolve, reject, timer, onProgress: parseOptions.onProgress });
        const request: WorkerParseMessage = { type: 'parse', id, fileData, fileName };
        // The worker can't read ?debug=parser / localStorage itself — tell it (see utils/parserDebug.ts).
        if (isParserDebugEnabled()) request.debug = true;
        try {
          parserLog('posting to worker', fileName, fileData.byteLength);
          ensureWorker().postMessage(request, [fileData.buffer]);
        } catch (err) {
          pending.delete(id);
          clearTimeout(timer);
          reject(err instanceof Error ? err : new Error('Failed to post message to parser worker'));
        }
      });
    },
    terminate() {
      failAll(new Error('Parser worker terminated'));
    },
  };
}
