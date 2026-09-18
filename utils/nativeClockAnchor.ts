/**
 * Map native engine frame clock (audioFramesRendered / sampleRate) onto the
 * shared AudioContext heard-time domain used by playheadPrediction.
 *
 * The native path shares the one player AudioContext; `audioTime` /
 * `workletTime` are the quantum start in that domain (frame clock mapped
 * through this anchor), not `ctx.currentTime` at poll time.
 *
 * C++ (`cpp/worklet_processor.cpp`) zeros `g_audioFramesRendered` on load/seek.
 * Main thread calls `createNativeClockAnchor` with `frameSecondsAtAnchor = 0`
 * on play start and seek.
 */

import { getAudioHeardTime } from './playheadPrediction';

/**
 * Extra output delay between the native render and what is heard. Zero on the
 * shared context (the C++ node is in the main graph, no bridge in between).
 * `bridgeLatencySec` stays a parameter so a future out-of-graph path can
 * declare its own offset without re-deriving the anchor math.
 */
export const NATIVE_BRIDGE_LATENCY_RING_SEC = 0;

export interface NativeClockAnchor {
  /** Frame-clock seconds at anchor (usually 0 on play/seek). */
  frameSecondsAtAnchor: number;
  /** Main-context heard time at anchor (getAudioHeardTime). */
  mainHeardTimeAtAnchor: number;
  /** Extra output delay between native render and heard output (0 on shared ctx). */
  bridgeLatencySec: number;
}

export function createNativeClockAnchor(
  audioCtx: AudioContext,
  bridgeLatencySec = NATIVE_BRIDGE_LATENCY_RING_SEC,
  frameSecondsAtAnchor = 0,
): NativeClockAnchor {
  return {
    frameSecondsAtAnchor,
    mainHeardTimeAtAnchor: getAudioHeardTime(audioCtx),
    bridgeLatencySec: Math.max(0, bridgeLatencySec),
  };
}

/**
 * Convert native pre-quantum frame clock to main heard-time for workletTime.
 */
export function mapNativeFrameClockToHeardTime(
  frameSeconds: number,
  anchor: NativeClockAnchor | null,
  fallbackHeardTime: number,
): number {
  if (anchor == null || !Number.isFinite(frameSeconds)) {
    return fallbackHeardTime;
  }
  return (
    anchor.mainHeardTimeAtAnchor
    + (frameSeconds - anchor.frameSecondsAtAnchor)
    - anchor.bridgeLatencySec
  );
}

/** Derive frame-clock seconds from native position fields. */
export function nativeFrameSecondsFromData(
  audioFramesRendered: number | undefined,
  sampleRate: number | undefined,
): number | null {
  if (
    audioFramesRendered == null ||
    !Number.isFinite(audioFramesRendered) ||
    sampleRate == null ||
    sampleRate <= 0
  ) {
    return null;
  }
  return audioFramesRendered / sampleRate;
}
