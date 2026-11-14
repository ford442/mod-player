import type { PatternRendererBackend } from '../src/renderers/types';

export interface CanvasCaptureSupport {
  backend: PatternRendererBackend | 'unknown';
  captureStream: boolean;
  notes: string[];
}

/** Probe whether canvas.captureStream is available for the active renderer. */
export function probeCanvasCaptureSupport(
  backend: PatternRendererBackend | null | undefined,
): CanvasCaptureSupport {
  const notes: string[] = [];
  const resolved = backend ?? 'unknown';

  if (typeof HTMLCanvasElement === 'undefined') {
    return { backend: resolved, captureStream: false, notes: ['No canvas in this environment'] };
  }

  const proto = HTMLCanvasElement.prototype as HTMLCanvasElement & {
    captureStream?: (frameRate?: number) => MediaStream;
  };

  if (typeof proto.captureStream !== 'function') {
    notes.push('HTMLCanvasElement.captureStream is not implemented');
    return { backend: resolved, captureStream: false, notes };
  }

  if (backend === 'html') {
    notes.push('HTML grid fallback has no GPU canvas to record');
    return { backend: resolved, captureStream: false, notes };
  }

  if (backend === 'webgpu') {
    notes.push('WebGPU canvas captureStream support varies by browser; WebGL2 fallback is recommended for recording');
  }

  if (backend === 'webgl2') {
    notes.push('WebGL2 canvas capture is widely supported in Chromium and Firefox');
  }

  return { backend: resolved, captureStream: true, notes };
}

export interface PerformanceCaptureMimeSupport {
  mimeType: string | null;
  videoBitsPerSecond: number;
}

const PREFERRED_MIME_TYPES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
];

/** Pick the first MediaRecorder mimeType supported by the browser. */
export function pickRecorderMimeType(): PerformanceCaptureMimeSupport {
  if (typeof MediaRecorder === 'undefined') {
    return { mimeType: null, videoBitsPerSecond: 4_000_000 };
  }
  for (const mimeType of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return { mimeType, videoBitsPerSecond: 4_000_000 };
    }
  }
  return { mimeType: null, videoBitsPerSecond: 4_000_000 };
}

export interface CombinedCaptureStreams {
  stream: MediaStream;
  /** Extra destination node connected in parallel to the audible graph. */
  audioDestination: MediaStreamAudioDestinationNode | null;
  cleanupAudioTap: () => void;
}

/**
 * Combine a canvas video track with audio tapped from the live playback graph.
 * The tap is parallel — playback continues through the existing destination.
 */
export function createCombinedCaptureStream(
  videoStream: MediaStream,
  audioContext: AudioContext,
  audioSourceNode: AudioNode,
): CombinedCaptureStreams {
  const audioDestination = audioContext.createMediaStreamDestination();
  audioSourceNode.connect(audioDestination);

  const combined = new MediaStream([
    ...videoStream.getVideoTracks(),
    ...audioDestination.stream.getAudioTracks(),
  ]);

  return {
    stream: combined,
    audioDestination,
    cleanupAudioTap: () => {
      try {
        audioSourceNode.disconnect(audioDestination);
      } catch {
        /* already disconnected */
      }
      // The canvas capture track keeps rendering frames (and the destination's track keeps
      // pulling audio) until stopped; disconnecting alone left a 30 fps capture running.
      for (const track of [...videoStream.getTracks(), ...combined.getTracks()]) track.stop();
    },
  };
}

/** The part of MediaRecorder `finishRecording` drives (a fake in tests). */
export type StoppableRecorder = Pick<MediaRecorder, 'state' | 'stop' | 'addEventListener'>;

/**
 * Stops `recorder`, waits for its final `dataavailable` / `stop`, and only then releases the
 * capture (audio tap + tracks). Releasing first cut the recording's tail: the recorder flushes
 * what it has buffered when it stops, and a disconnected tap has nothing left to give it.
 */
export async function finishRecording(recorder: StoppableRecorder, release: () => void): Promise<void> {
  try {
    if (recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        recorder.addEventListener('stop', () => resolve(), { once: true });
        recorder.stop();
      });
    }
  } finally {
    release();
  }
}

/** Resolve a recordable canvas, preferring WebGL2 when WebGPU capture is unreliable. */
export function resolveCaptureCanvas(
  getRenderer: () => { backend?: PatternRendererBackend; getCanvas: () => HTMLCanvasElement | null } | null,
  preferWebGL2: boolean,
): { canvas: HTMLCanvasElement | null; backend: PatternRendererBackend | 'unknown' } {
  const renderer = getRenderer();
  if (!renderer) {
    return { canvas: null, backend: 'unknown' };
  }

  const backend = renderer.backend ?? 'unknown';
  const canvas = renderer.getCanvas();

  if (!preferWebGL2 || backend === 'webgl2') {
    return { canvas, backend };
  }

  // When recording, callers may temporarily switch renderer — surface current canvas anyway.
  return { canvas, backend };
}
