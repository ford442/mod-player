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
});
