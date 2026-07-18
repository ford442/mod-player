import { useCallback, useRef, useState } from 'react';
import { downloadBlob } from '../utils/downloadBlob';
import {
  createCombinedCaptureStream,
  pickRecorderMimeType,
  probeCanvasCaptureSupport,
  resolveCaptureCanvas,
} from '../utils/performanceCapture';
import type { PatternRendererBackend } from '../src/renderers/types';

export type CaptureStage = 'idle' | 'recording' | 'saving' | 'error';

export interface PerformanceCaptureState {
  stage: CaptureStage;
  message: string;
  elapsedSeconds: number;
}

const INITIAL: PerformanceCaptureState = {
  stage: 'idle',
  message: '',
  elapsedSeconds: 0,
};

export interface PerformanceCaptureOptions {
  getRenderer: () => { backend?: PatternRendererBackend; getCanvas: () => HTMLCanvasElement | null } | null;
  audioContext: AudioContext | null;
  /** Node to tap for recording — typically gain or stereo panner before destination. */
  audioTapNode: AudioNode | null;
  /** When true, prefer WebGL2 canvas for captureStream reliability. */
  preferWebGL2?: boolean;
  frameRate?: number;
  fileName?: string;
  /** Native engine uses a separate AudioContext — audio tap may be unavailable. */
  dualAudioContext?: boolean;
}

export function usePerformanceCapture() {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cleanupRef = useRef<(() => void) | null>(null);
  const timerRef = useRef<number>(0);
  const startedAtRef = useRef<number>(0);

  const [state, setState] = useState<PerformanceCaptureState>(INITIAL);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = 0;
    }
  }, []);

  const stopInternal = useCallback(async (save: boolean) => {
    clearTimer();
    const recorder = recorderRef.current;
    recorderRef.current = null;

    cleanupRef.current?.();
    cleanupRef.current = null;

    if (!recorder || recorder.state === 'inactive') {
      setState(INITIAL);
      return;
    }

    if (!save) {
      recorder.stop();
      chunksRef.current = [];
      setState(INITIAL);
      return;
    }

    setState((prev) => ({ ...prev, stage: 'saving', message: 'Finalizing recording…' }));

    await new Promise<void>((resolve) => {
      recorder.addEventListener('stop', () => resolve(), { once: true });
      recorder.stop();
    });

    const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'video/webm' });
    chunksRef.current = [];
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
    downloadBlob(blob, `performance-capture.${ext}`);
    setState({ stage: 'idle', message: 'Recording saved', elapsedSeconds: 0 });
  }, [clearTimer]);

  const start = useCallback(async (options: PerformanceCaptureOptions): Promise<boolean> => {
    if (recorderRef.current) return false;

    const { canvas, backend } = resolveCaptureCanvas(
      options.getRenderer,
      options.preferWebGL2 ?? true,
    );
    const support = probeCanvasCaptureSupport(
      backend === 'unknown' ? null : backend,
    );

    if (!canvas || !support.captureStream) {
      setState({
        stage: 'error',
        message: support.notes[0] ?? 'Canvas capture is not available for this renderer',
        elapsedSeconds: 0,
      });
      return false;
    }

    if (options.dualAudioContext) {
      setState({
        stage: 'error',
        message: 'Native engine uses a separate AudioContext — switch to JS worklet engine to record audio+video together',
        elapsedSeconds: 0,
      });
      return false;
    }

    if (!options.audioContext || !options.audioTapNode) {
      setState({
        stage: 'error',
        message: 'Audio graph not ready — start playback before recording',
        elapsedSeconds: 0,
      });
      return false;
    }

    if (typeof MediaRecorder === 'undefined') {
      setState({
        stage: 'error',
        message: 'MediaRecorder is not supported in this browser',
        elapsedSeconds: 0,
      });
      return false;
    }

    const frameRate = options.frameRate ?? 30;
    const videoStream = canvas.captureStream(frameRate);
    const { stream, cleanupAudioTap } = createCombinedCaptureStream(
      videoStream,
      options.audioContext,
      options.audioTapNode,
    );

    const mime = pickRecorderMimeType();
    const recorder = mime.mimeType
      ? new MediaRecorder(stream, { mimeType: mime.mimeType, videoBitsPerSecond: mime.videoBitsPerSecond })
      : new MediaRecorder(stream, { videoBitsPerSecond: mime.videoBitsPerSecond });

    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };

    cleanupRef.current = cleanupAudioTap;
    recorderRef.current = recorder;
    recorder.start(1000);
    startedAtRef.current = performance.now();

    timerRef.current = window.setInterval(() => {
      const elapsed = (performance.now() - startedAtRef.current) / 1000;
      setState((prev) => ({ ...prev, elapsedSeconds: elapsed }));
    }, 250);

    setState({
      stage: 'recording',
      message: `Recording (${backend})…`,
      elapsedSeconds: 0,
    });
    return true;
  }, []);

  const stop = useCallback(async () => {
    await stopInternal(true);
  }, [stopInternal]);

  const cancel = useCallback(async () => {
    await stopInternal(false);
  }, [stopInternal]);

  return {
    state,
    start,
    stop,
    cancel,
    isRecording: state.stage === 'recording',
  };
}
