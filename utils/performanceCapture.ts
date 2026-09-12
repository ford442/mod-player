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
    },
  };
}

/** Resolve the canvas + backend currently exposed by the active pattern renderer. */
export function resolveCaptureCanvas(
  getRenderer: () => { backend?: PatternRendererBackend; getCanvas: () => HTMLCanvasElement | null } | null,
): { canvas: HTMLCanvasElement | null; backend: PatternRendererBackend | 'unknown' } {
  const renderer = getRenderer();
  if (!renderer) {
    return { canvas: null, backend: 'unknown' };
  }

  return { canvas: renderer.getCanvas(), backend: renderer.backend ?? 'unknown' };
}

declare global {
  // `grabFrame()` is missing from TS's lib.dom.d.ts even though it's implemented in
  // Chromium/Edge (not Safari) — merge it onto the existing `ImageCapture` interface.
  interface ImageCapture {
    grabFrame(): Promise<ImageBitmap>;
  }
}

/**
 * Feature-detect whether a canvas's `captureStream()` output actually has visible
 * (non-transparent, non-black) content, by grabbing and sampling one real frame.
 * Returns `null` when the check itself can't run (no `captureStream`/`ImageCapture`
 * support, or it timed out) — callers should treat that as inconclusive, not "blank".
 */
export async function probeCanvasHasVisibleFrame(
  canvas: HTMLCanvasElement,
  timeoutMs = 500,
): Promise<boolean | null> {
  if (typeof canvas.captureStream !== 'function' || typeof ImageCapture !== 'function') {
    return null;
  }

  let stream: MediaStream | null = null;
  try {
    stream = canvas.captureStream(30);
    const track = stream.getVideoTracks()[0];
    if (!track) return null;

    const capture = new ImageCapture(track);
    const bitmap = await Promise.race([
      capture.grabFrame(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    if (!bitmap) return null;

    const probe = document.createElement('canvas');
    probe.width = Math.min(bitmap.width, 16) || 1;
    probe.height = Math.min(bitmap.height, 16) || 1;
    const ctx = probe.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, probe.width, probe.height);
    bitmap.close?.();

    const { data } = ctx.getImageData(0, 0, probe.width, probe.height);
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      const a = data[i + 3] ?? 0;
      if (a > 0 && (r > 8 || g > 8 || b > 8)) return true;
    }
    return false;
  } catch {
    return null;
  } finally {
    stream?.getTracks().forEach((t) => t.stop());
  }
}
