import { useCallback, useRef, useState } from 'react';
import { downloadBlob } from '../utils/downloadBlob';
import type { FxRackState } from '../audio/fx/types';
import {
  createExportWorker,
  exportPcmInWorker,
  exportWavInWorker,
  type ExportWorkerProgress,
} from '../utils/exportWorker';
import { encodeStereoWav, isDurationWithinFrameTolerance } from '../utils/wavEncoder';

export type OfflineExportStage = 'idle' | 'loading' | 'rendering' | 'fx' | 'encoding' | 'done' | 'error';

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
  /** Render through the FX rack (#453); null / absent = dry, exactly as before. */
  fx?: FxRackState | null;
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

    const workerOptions = {
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
          // With FX the worker's render is the first ~60 %.
          progress: request.fx ? Math.round(progress.percent * 0.6) : progress.percent,
          message:
            progress.stage === 'wasm'
              ? 'Loading libopenmpt…'
              : progress.stage === 'render'
                ? 'Rendering audio…'
                : 'Encoding WAV…',
        }));
      },
    };

    try {
      let wav: Blob;
      let fileName: string;
      let renderedDurationSeconds: number;
      let metadataDurationSeconds: number;
      let fxNote = '';

      if (request.fx) {
        // FX rack (#453): dry render in the worker, then the same rack graph
        // offline on the main thread (workers have no OfflineAudioContext).
        const dry = await exportPcmInWorker(worker, workerOptions);
        terminateWorker();
        setState((prev) => ({ ...prev, stage: 'fx', progress: 60, message: 'Rendering through the FX rack…' }));
        const { renderFxOffline } = await import('../audio/fx/offline/renderFxOffline');
        const { sharedIrLoader } = await import('../audio/fx/room/irLoader');
        const processed = await renderFxOffline(dry, request.fx, {
          irLoader: sharedIrLoader(),
          onProgress: (fraction) =>
            setState((prev) => ({ ...prev, progress: 60 + Math.round(fraction * 30) })),
        });
        setState((prev) => ({ ...prev, stage: 'encoding', progress: 90, message: 'Encoding WAV…' }));
        wav = encodeStereoWav(processed.left, processed.right, { sampleRate: processed.sampleRate });
        fileName = dry.fileName;
        renderedDurationSeconds = dry.renderedDurationSeconds;
        metadataDurationSeconds = dry.metadataDurationSeconds;
        fxNote = ` + ${processed.tailSeconds.toFixed(2)}s FX tail${processed.warnings.length ? ` — ${processed.warnings.join(' ')}` : ''}`;
      } else {
        const result = await exportWavInWorker(worker, workerOptions);
        wav = new Blob([result.wav], { type: 'audio/wav' });
        fileName = result.fileName;
        renderedDurationSeconds = result.renderedDurationSeconds;
        metadataDurationSeconds = result.metadataDurationSeconds;
      }

      // Duration parity is a property of the dry render; the FX tail is extra.
      const delta = Math.abs(renderedDurationSeconds - metadataDurationSeconds);
      const withinTolerance = isDurationWithinFrameTolerance(renderedDurationSeconds, metadataDurationSeconds);

      downloadBlob(wav, fileName);

      setState({
        stage: 'done',
        progress: 100,
        message: withinTolerance
          ? `Exported ${fileName} (${renderedDurationSeconds.toFixed(1)}s${fxNote})`
          : `Exported ${fileName} (Δ ${delta.toFixed(3)}s vs metadata${fxNote})`,
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
    isExporting:
      state.stage === 'loading' || state.stage === 'rendering' || state.stage === 'fx' || state.stage === 'encoding',
  };
}
