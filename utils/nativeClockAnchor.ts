/**
 * Map native engine frame clock (audioFramesRendered / sampleRate) onto the
 * main AudioContext heard-time domain used by playheadPrediction.
 *
 * Native renders on a separate AudioContext. Contract with C++
 * (`cpp/worklet_processor.cpp`):
 * - `g_audioFramesRendered` is zeroed on **module load** and **seek**.
 * - Main thread calls `createNativeClockAnchor` with `frameSecondsAtAnchor = 0`
 *   on play start and seek so prediction dt matches the JS quantum path.
 *
 * JS worklet tags samples with shared AudioContext currentTime instead.
 * Do not re-anchor with frameSeconds=0 unless C++ also reset the counter.
 */

import { getAudioHeardTime } from './playheadPrediction';

/** Ring-buffer bridge: near-zero extra latency. MediaStream: few-ms estimate. */
export const NATIVE_BRIDGE_LATENCY_RING_SEC = 0;
export const NATIVE_BRIDGE_LATENCY_MEDIASTREAM_SEC = 0.006;

export interface NativeClockAnchor {
  /** Frame-clock seconds at anchor (usually 0 on play/seek). */
  frameSecondsAtAnchor: number;
  /** Main-context heard time at anchor (getAudioHeardTime). */
  mainHeardTimeAtAnchor: number;
  /** Extra output delay from native→main bridge strategy. */
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
