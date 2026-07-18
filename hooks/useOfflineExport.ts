import { useCallback, useRef, useState } from 'react';
import { downloadBlob } from '../utils/downloadBlob';
import {
  createExportWorker,
  exportWavInWorker,
  type ExportWorkerProgress,
} from '../utils/exportWorker';
import { isDurationWithinFrameTolerance } from '../utils/wavEncoder';

export type OfflineExportStage = 'idle' | 'loading' | 'rendering' | 'encoding' | 'done' | 'error';

export interface OfflineExportState {
  stage: OfflineExportStage;
  progress: number;
  message: string;
  lastDurationDeltaSeconds: number | null;
}

export interface OfflineExportRequest {
  fileData: Uint8Array;
  fileName: string;
  muteMask?: boolean[];
  startSeconds?: number;
  endSeconds?: number;
}

const INITIAL_STATE: OfflineExportState = {
  stage: 'idle',
  progress: 0,
  message: '',
  lastDurationDeltaSeconds: null,
};

export function useOfflineExport() {
  const workerRef = useRef<Worker | null>(null);
  const [state, setState] = useState<OfflineExportState>(INITIAL_STATE);

  const terminateWorker = useCallback(() => {
    if (workerRef.current) {
      try {
        workerRef.current.terminate();
      } catch {
        /* ignore */
      }
      workerRef.current = null;
    }
  }, []);

  const exportWav = useCallback(async (request: OfflineExportRequest): Promise<boolean> => {
    terminateWorker();
    setState({
      stage: 'loading',
      progress: 0,
      message: 'Starting offline render…',
      lastDurationDeltaSeconds: null,
    });

    const worker = createExportWorker((message) => {
      console.error('[Export]', message);
    });
    workerRef.current = worker;

    const fileDataCopy = request.fileData.slice();

    try {
      const result = await exportWavInWorker(worker, {
        fileData: fileDataCopy,
        fileName: request.fileName,
        ...(request.muteMask ? { muteMask: request.muteMask } : {}),
        ...(request.startSeconds !== undefined ? { startSeconds: request.startSeconds } : {}),
        ...(request.endSeconds !== undefined ? { endSeconds: request.endSeconds } : {}),
        onProgress: (progress: ExportWorkerProgress) => {
          const stage: OfflineExportStage =
            progress.stage === 'encode' ? 'encoding' : 'rendering';
          setState((prev) => ({
            ...prev,
            stage,
            progress: progress.percent,
            message:
              progress.stage === 'wasm'
                ? 'Loading libopenmpt…'
                : progress.stage === 'render'
                  ? 'Rendering audio…'
                  : 'Encoding WAV…',
          }));
        },
      });

      const delta = Math.abs(result.renderedDurationSeconds - result.metadataDurationSeconds);
      const withinTolerance = isDurationWithinFrameTolerance(
        result.renderedDurationSeconds,
        result.metadataDurationSeconds,
      );

      downloadBlob(new Blob([result.wav], { type: 'audio/wav' }), result.fileName);

      setState({
        stage: 'done',
        progress: 100,
        message: withinTolerance
          ? `Exported ${result.fileName} (${result.renderedDurationSeconds.toFixed(1)}s)`
          : `Exported ${result.fileName} (Δ ${delta.toFixed(3)}s vs metadata)`,
        lastDurationDeltaSeconds: delta,
      });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Export failed';
      setState({
        stage: 'error',
        progress: 0,
        message,
        lastDurationDeltaSeconds: null,
      });
      return false;
    } finally {
      terminateWorker();
    }
  }, [terminateWorker]);

  const reset = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  return {
    state,
    exportWav,
    reset,
    isExporting: state.stage === 'loading' || state.stage === 'rendering' || state.stage === 'encoding',
  };
}
