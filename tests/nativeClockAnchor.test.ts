import { describe, expect, it } from 'vitest';
import {
  createNativeClockAnchor,
  mapNativeFrameClockToHeardTime,
  nativeFrameSecondsFromData,
  NATIVE_BRIDGE_LATENCY_MEDIASTREAM_SEC,
} from '../utils/nativeClockAnchor';

function fakeCtx(currentTime: number, baseLatency = 0.01, outputLatency = 0.02): AudioContext {
  return { currentTime, baseLatency, outputLatency } as AudioContext;
}

describe('nativeClockAnchor', () => {
  it('maps frame clock onto main heard-time via anchor', () => {
    const anchor = {
      frameSecondsAtAnchor: 0,
      mainHeardTimeAtAnchor: 100,
      bridgeLatencySec: 0,
    };
    expect(mapNativeFrameClockToHeardTime(0.5, anchor, 99)).toBeCloseTo(100.5, 6);
    expect(mapNativeFrameClockToHeardTime(0.5, null, 42)).toBe(42);
  });

  it('subtracts bridge latency from mapped heard-time', () => {
    const anchor = {
      frameSecondsAtAnchor: 0,
      mainHeardTimeAtAnchor: 10,
      bridgeLatencySec: NATIVE_BRIDGE_LATENCY_MEDIASTREAM_SEC,
    };
    expect(mapNativeFrameClockToHeardTime(1.0, anchor, 0)).toBeCloseTo(
      10 + 1.0 - NATIVE_BRIDGE_LATENCY_MEDIASTREAM_SEC,
      6,
    );
  });

  it('createNativeClockAnchor uses getAudioHeardTime', () => {
    const anchor = createNativeClockAnchor(fakeCtx(20), 0.003);
    expect(anchor.mainHeardTimeAtAnchor).toBeCloseTo(19.97, 4);
    expect(anchor.bridgeLatencySec).toBe(0.003);
    expect(anchor.frameSecondsAtAnchor).toBe(0);
  });

  it('derives frame seconds from native position fields', () => {
    expect(nativeFrameSecondsFromData(48000, 48000)).toBeCloseTo(1, 6);
    expect(nativeFrameSecondsFromData(undefined, 48000)).toBeNull();
  });

  /**
   * Contract: C++ zeros g_audioFramesRendered on load/seek while TS re-anchors
   * at frameSecondsAtAnchor=0. If frames keep accumulating without reset,
   * mapped workletTime jumps ahead of heard-time by the leftover frame seconds.
   */
  it('documents seek re-zero contract (stale frames break prediction)', () => {
    const anchorAfterSeek = {
      frameSecondsAtAnchor: 0,
      mainHeardTimeAtAnchor: 50,
      bridgeLatencySec: 0,
    };
    // Correct: C++ reset → frames near 0 right after seek
    expect(mapNativeFrameClockToHeardTime(0, anchorAfterSeek, 50)).toBeCloseTo(50, 6);
    // Broken: C++ did not reset → 10 s of leftover frames maps 10 s into the future
    expect(mapNativeFrameClockToHeardTime(10, anchorAfterSeek, 50)).toBeCloseTo(60, 6);
  });
});
