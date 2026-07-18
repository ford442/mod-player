import { loadLibOpenMPTInWorker } from '../utils/libopenmptWorkerLoad';
import { renderModuleOffline } from '../utils/offlineRender';
import { encodeStereoWav } from '../utils/wavEncoder';

export interface ExportWorkerRequest {
  type: 'render-wav';
  fileData: Uint8Array;
  fileName: string;
  muteMask?: boolean[];
  startSeconds?: number;
  endSeconds?: number;
}

export interface ExportWorkerProgress {
  type: 'progress';
  stage: 'wasm' | 'render' | 'encode';
  percent: number;
}

export interface ExportWorkerComplete {
  type: 'complete';
  wav: ArrayBuffer;
  fileName: string;
  metadataDurationSeconds: number;
  renderedDurationSeconds: number;
  frameCount: number;
  sampleRate: number;
}

export interface ExportWorkerError {
  type: 'error';
  message: string;
}

export type ExportWorkerResult = ExportWorkerProgress | ExportWorkerComplete | ExportWorkerError;

type IncomingMessage = ExportWorkerRequest;

function postError(message: string): void {
  const response: ExportWorkerError = { type: 'error', message };
  self.postMessage(response);
}

function baseName(fileName: string): string {
  const slash = Math.max(fileName.lastIndexOf('/'), fileName.lastIndexOf('\\'));
  return slash >= 0 ? fileName.slice(slash + 1) : fileName;
}

async function handleMessage(message: IncomingMessage): Promise<void> {
  if (message.type !== 'render-wav') {
    postError(`Unknown export worker message: ${(message as { type?: string }).type ?? '?'}`);
    return;
  }

  try {
    self.postMessage({ type: 'progress', stage: 'wasm', percent: 0 } satisfies ExportWorkerProgress);
    const lib = await loadLibOpenMPTInWorker();

    self.postMessage({ type: 'progress', stage: 'render', percent: 10 } satisfies ExportWorkerProgress);
    const rendered = renderModuleOffline(lib, {
      fileData: message.fileData,
      loop: false,
      ...(message.muteMask ? { muteMask: message.muteMask } : {}),
      ...(message.startSeconds !== undefined ? { startSeconds: message.startSeconds } : {}),
      ...(message.endSeconds !== undefined ? { endSeconds: message.endSeconds } : {}),
    });

    self.postMessage({ type: 'progress', stage: 'encode', percent: 90 } satisfies ExportWorkerProgress);
    const wavBlob = encodeStereoWav(rendered.left, rendered.right, {
      sampleRate: rendered.sampleRate,
    });
    const wavBuffer = await wavBlob.arrayBuffer();
    const stem = baseName(message.fileName).replace(/\.[^.]+$/, '') || 'export';

    const response: ExportWorkerComplete = {
      type: 'complete',
      wav: wavBuffer,
      fileName: `${stem}.wav`,
      metadataDurationSeconds: rendered.metadataDurationSeconds,
      renderedDurationSeconds: rendered.renderedDurationSeconds,
      frameCount: rendered.frameCount,
      sampleRate: rendered.sampleRate,
    };
    self.postMessage(response, { transfer: [wavBuffer] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown export worker error';
    postError(msg);
  }
}

self.onmessage = (e: MessageEvent<IncomingMessage>) => {
  void handleMessage(e.data).catch((err) => {
    postError(err instanceof Error ? err.message : 'Export worker failure');
  });
};

self.onerror = (event: Event | string) => {
  const message = typeof event === 'string' ? event : 'Export worker script error';
  postError(message);
};

self.onmessageerror = () => {
  postError('Export worker message deserialization failed');
};
