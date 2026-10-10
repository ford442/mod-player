import type {
  ExportWorkerComplete,
  ExportWorkerPcm,
  ExportWorkerProgress,
  ExportWorkerRequest,
  ExportWorkerResult,
} from '../workers/openmpt-export.worker';
import exportWorkerUrl from '../workers/openmpt-export.worker.ts?worker&url';

export const EXPORT_WORKER_TIMEOUT_MS = 10 * 60_000;

export function getExportWorkerUrl(): string {
  return exportWorkerUrl;
}

export function createExportWorker(onFatalError?: (message: string) => void): Worker {
  const worker = new Worker(exportWorkerUrl, { type: 'module' });
  worker.addEventListener('error', (event) => {
    const message =
      typeof event === 'string'
        ? event
        : event instanceof ErrorEvent
          ? event.message
          : 'Export worker script error';
    console.error('[Export] worker script error:', message);
    onFatalError?.(message);
  });
  worker.addEventListener('messageerror', () => {
    console.error('[Export] worker messageerror');
    onFatalError?.('Export worker message deserialization failed');
  });
  return worker;
}

export interface ExportWavOptions {
  fileData: Uint8Array;
  fileName: string;
  muteMask?: boolean[];
  startSeconds?: number;
  endSeconds?: number;
  onProgress?: (progress: ExportWorkerProgress) => void;
  timeoutMs?: number;
}

export function exportWavInWorker(
  worker: Worker,
  options: ExportWavOptions,
): Promise<ExportWorkerComplete> {
  return runExportWorker<ExportWorkerComplete>(worker, options, 'wav');
}

/** Dry float render for the FX rack export path (#453): encode happens on the main thread. */
export function exportPcmInWorker(
  worker: Worker,
  options: ExportWavOptions,
): Promise<ExportWorkerPcm> {
  return runExportWorker<ExportWorkerPcm>(worker, options, 'pcm');
}

function runExportWorker<T extends ExportWorkerComplete | ExportWorkerPcm>(
  worker: Worker,
  options: ExportWavOptions,
  output: 'wav' | 'pcm',
): Promise<T> {
  const message: ExportWorkerRequest = {
    type: 'render-wav',
    fileData: options.fileData,
    fileName: options.fileName,
    ...(options.muteMask ? { muteMask: options.muteMask } : {}),
    ...(options.startSeconds !== undefined ? { startSeconds: options.startSeconds } : {}),
    ...(options.endSeconds !== undefined ? { endSeconds: options.endSeconds } : {}),
    ...(output === 'pcm' ? { output } : {}),
  };

  const transfer: Transferable[] = [options.fileData.buffer];
  const timeoutMs = options.timeoutMs ?? EXPORT_WORKER_TIMEOUT_MS;

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        worker.terminate();
      } catch {
        /* ignore */
      }
      reject(new Error(`Export timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const onMessage = (event: MessageEvent<ExportWorkerResult>) => {
      const data = event.data;
      if (data.type === 'progress') {
        options.onProgress?.(data);
        return;
      }
      if (data.type === 'error') {
        if (!settled) {
          settled = true;
          cleanup();
          reject(new Error(data.message));
        }
        return;
      }
      if (data.type === 'complete' || data.type === 'complete-pcm') {
        if (!settled) {
          settled = true;
          cleanup();
          resolve(data as T);
        }
      }
    };

    const onError = (event: ErrorEvent) => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error(event.message || 'Export worker error'));
      }
    };

    const onMessageError = () => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error('Export worker message deserialization failed'));
      }
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

    try {
      worker.postMessage(message, transfer);
    } catch (err) {
      if (!settled) {
        settled = true;
        cleanup();
        reject(err instanceof Error ? err : new Error('Failed to post export message'));
      }
    }
  });
}

export type { ExportWorkerComplete, ExportWorkerPcm, ExportWorkerProgress };
