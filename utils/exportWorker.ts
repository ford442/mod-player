import type {
  ExportWorkerComplete,
  ExportWorkerProgress,
  ExportWorkerRequest,
  ExportWorkerResult,
} from '../workers/openmpt-export.worker';

export const EXPORT_WORKER_TIMEOUT_MS = 10 * 60_000;

export function getExportWorkerUrl(): string {
  return new URL('../workers/openmpt-export.worker.ts', import.meta.url).href;
}

export function createExportWorker(onFatalError?: (message: string) => void): Worker {
  const worker = new Worker(
    new URL('../workers/openmpt-export.worker.ts', import.meta.url),
    { type: 'module' },
  );
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
  const message: ExportWorkerRequest = {
    type: 'render-wav',
    fileData: options.fileData,
    fileName: options.fileName,
    ...(options.muteMask ? { muteMask: options.muteMask } : {}),
    ...(options.startSeconds !== undefined ? { startSeconds: options.startSeconds } : {}),
    ...(options.endSeconds !== undefined ? { endSeconds: options.endSeconds } : {}),
  };

  const transfer: Transferable[] = [options.fileData.buffer];
  const timeoutMs = options.timeoutMs ?? EXPORT_WORKER_TIMEOUT_MS;

  return new Promise<ExportWorkerComplete>((resolve, reject) => {
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
      if (data.type === 'complete') {
        if (!settled) {
          settled = true;
          cleanup();
          resolve(data);
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

export type { ExportWorkerComplete, ExportWorkerProgress };
