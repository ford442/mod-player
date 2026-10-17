import { describe, expect, it } from 'vitest';
import {
  predictPlayheadFromSample,
  updateRowsPerSecondEstimate,
  rowsPerSecondFromBpm,
  getAudioHeardTime,
  getLatencyHeardTime,
  heardTimeFromOutputTimestamp,
  resetAudioHeardTime,
  resolveAudioHeardTime,
  fractionalRowFromTimeMarkers,
  expectedLatencyRows,
  compensateWorkletSampleTime,
  TARGET_MAX_LAG_ROWS,
  type WorkletPositionSample,
} from '../utils/playheadPrediction';

const sample: WorkletPositionSample = {
  order: 0,
  row: 10.0,
  rowInt: 10,
  positionSeconds: 5.0,
  workletTime: 100.0,
  bpm: 125,
  speed: 6,
};

describe('playheadPrediction', () => {
  it('forward-extrapolates to heard time', () => {
    const predicted = predictPlayheadFromSample(sample, 100.05, 8);
    expect(predicted.playheadRow).toBeCloseTo(10.4, 3);
  });

  it('allows negative dt for output latency compensation', () => {
    const latPredicted = predictPlayheadFromSample(sample, 99.97, 8.333);
    expect(latPredicted.dtSec).toBeLessThan(0);
    expect(latPredicted.playheadRow).toBeLessThan(sample.row);
  });

  it('keeps 30ms device latency under 1 row at 125 BPM', () => {
    const lagRows = expectedLatencyRows(0.03, 125);
    expect(lagRows).toBeLessThanOrEqual(TARGET_MAX_LAG_ROWS + 0.05);
    expect(lagRows).toBeLessThan(1);
  });

  it('estimates rows/sec from consecutive samples', () => {
    const prev: WorkletPositionSample = {
      ...sample,
      row: 8,
      rowInt: 8,
      positionSeconds: 4.75,
      workletTime: 99.75,
    };
    const rps = updateRowsPerSecondEstimate(prev, sample, 64, rowsPerSecondFromBpm(125));
    expect(rps).toBeGreaterThanOrEqual(4);
    expect(rps).toBeLessThanOrEqual(12);
  });

  it('computes heard time from AudioContext latencies', () => {
    const fakeCtx = {
      currentTime: 10,
      baseLatency: 0.01,
      outputLatency: 0.02,
    } as AudioContext;
    expect(getAudioHeardTime(fakeCtx)).toBeCloseTo(9.97, 4);
  });

  it('derives fractional row from time markers', () => {
    const frac = fractionalRowFromTimeMarkers(12, 5.05, 5.0, 5.1);
    expect(frac).toBeCloseTo(12.5, 3);
  });

  it('native-anchored samples extrapolate like JS quantum tags', () => {
    const anchor = {
      frameSecondsAtAnchor: 0,
      mainHeardTimeAtAnchor: 100,
      bridgeLatencySec: 0,
    };
    const sample: WorkletPositionSample = {
      order: 0,
      row: 10,
      rowInt: 10,
      positionSeconds: 5,
      workletTime: 100.05,
      bpm: 125,
      speed: 6,
    };
    const heardTime = 100.1;
    const predicted = predictPlayheadFromSample(sample, heardTime, 8);
    expect(predicted.dtSec).toBeCloseTo(0.05, 3);
    expect(predicted.playheadRow).toBeCloseTo(10.4, 3);
    expect(anchor.mainHeardTimeAtAnchor + 0.05).toBeCloseTo(sample.workletTime, 3);
  });

  it('compensates worklet sample time by half a quantum', () => {
    const t = compensateWorkletSampleTime(100, 128, 44100);
    expect(t).toBeCloseTo(100 + (128 / 44100) * 0.5, 6);
    expect(compensateWorkletSampleTime(100)).toBe(100);
  });

  it('keeps quantum prediction step well under one row at 125 BPM', () => {
    const rps125 = rowsPerSecondFromBpm(125);
    const rowSec = 1 / rps125;
    const quantum = 128 / 44100;
    const step = quantum * rps125;
    expect(step).toBeLessThan(0.1);
    expect(rowSec).toBeGreaterThanOrEqual(0.05);
    expect(rowSec).toBeLessThanOrEqual(0.2);
  });
});

/**
 * Heard time from `AudioContext.getOutputTimestamp()` (#492), with the latency formula as the fallback.
 * The numbers are shaped like a real headless-Chromium reading: currentTime 0.512, contextTime 0.427
 * stamped 19.3 ms ago, baseLatency 21.3 ms + outputLatency 64 ms.
 */
describe('heard time: getOutputTimestamp, then the latency formula', () => {
  const NOW_MS = 794.3;

  function fakeCtx(
    currentTime: number,
    ts?: (() => { contextTime?: number; performanceTime?: number }) | null,
    baseLatency = 0.0213,
    outputLatency = 0.064,
  ): AudioContext {
    const ctx: Record<string, unknown> = { currentTime, baseLatency, outputLatency };
    if (ts) ctx.getOutputTimestamp = ts;
    return ctx as unknown as AudioContext;
  }

  it('extrapolates the output timestamp to now on the wall clock', () => {
    const heard = heardTimeFromOutputTimestamp({ contextTime: 0.427, performanceTime: 775 }, 0.512, NOW_MS);
    expect(heard).toBeCloseTo(0.427 + 0.0193, 6);
  });

  it('rejects readings that cannot be trusted', () => {
    // Chromium returns zeros until the first quantum is rendered.
    expect(heardTimeFromOutputTimestamp({ contextTime: 0, performanceTime: 0 }, 0.01, NOW_MS)).toBeNull();
    expect(heardTimeFromOutputTimestamp(undefined, 0.5, NOW_MS)).toBeNull();
    expect(heardTimeFromOutputTimestamp({ contextTime: 0.4 }, 0.5, NOW_MS)).toBeNull();
    expect(heardTimeFromOutputTimestamp({ contextTime: Number.NaN, performanceTime: 775 }, 0.5, NOW_MS)).toBeNull();
    // Heard before rendered: impossible.
    expect(heardTimeFromOutputTimestamp({ contextTime: 0.6, performanceTime: 790 }, 0.5, NOW_MS)).toBeNull();
    // Stale (suspended context, a device switch in progress): the stamp stopped moving.
    expect(heardTimeFromOutputTimestamp({ contextTime: 0.4, performanceTime: NOW_MS - 600 }, 0.5, NOW_MS)).toBeNull();
    // A performanceTime from another time origin.
    expect(heardTimeFromOutputTimestamp({ contextTime: 0.4, performanceTime: NOW_MS + 5000 }, 0.5, NOW_MS)).toBeNull();
    // An implausible output delay (> 1 s).
    expect(heardTimeFromOutputTimestamp({ contextTime: 1, performanceTime: NOW_MS }, 2.5, NOW_MS)).toBeNull();
  });

  it('caps a reading a hair past currentTime (currentTime moves per render callback), rejects a big one', () => {
    expect(heardTimeFromOutputTimestamp({ contextTime: 0.5, performanceTime: NOW_MS - 20 }, 0.51, NOW_MS)).toBe(0.51);
    expect(heardTimeFromOutputTimestamp({ contextTime: 0.5, performanceTime: NOW_MS - 200 }, 0.51, NOW_MS)).toBeNull();
  });

  it('prefers the output timestamp when it is sane', () => {
    const ctx = fakeCtx(0.512, () => ({ contextTime: 0.427, performanceTime: 775 }));
    const heard = resolveAudioHeardTime(ctx, NOW_MS);
    expect(heard.source).toBe('output-timestamp');
    expect(heard.time).toBeCloseTo(0.4463, 4);
  });

  it('falls back to currentTime − (baseLatency + outputLatency): missing, throwing, not yet valid, stale', () => {
    const fallback = 0.512 - 0.0213 - 0.064;
    const readers = [
      null, // Safari / node: no getOutputTimestamp
      () => { throw new Error('not allowed'); },
      () => ({ contextTime: 0, performanceTime: 0 }),
      () => ({ contextTime: 0.427, performanceTime: NOW_MS - 2000 }),
    ];
    for (const ts of readers) {
      const heard = resolveAudioHeardTime(fakeCtx(0.512, ts), NOW_MS);
      expect(heard.source).toBe('latency');
      expect(heard.time).toBeCloseTo(fallback, 6);
    }
    expect(getLatencyHeardTime(fakeCtx(10, null, 0.01, 0.02))).toBeCloseTo(9.97, 6);
  });

  it('holds over small backward jitter, re-syncs on a big step, and a reset drops the hold', () => {
    let reading = { contextTime: 10, performanceTime: NOW_MS };
    const ctx = fakeCtx(10.1, () => reading);
    expect(resolveAudioHeardTime(ctx, NOW_MS).time).toBeCloseTo(10, 6);
    // The next stamp lands 3 ms earlier (the device reported more delay): hold, never step back.
    reading = { contextTime: 9.997, performanceTime: NOW_MS };
    expect(resolveAudioHeardTime(ctx, NOW_MS).time).toBeCloseTo(10, 6);
    // Time moves on past the held value: follow it again.
    reading = { contextTime: 10.01, performanceTime: NOW_MS };
    expect(resolveAudioHeardTime(ctx, NOW_MS).time).toBeCloseTo(10.01, 6);
    // A 200 ms step back (a slower output device took over): accepted — it is what is heard now.
    reading = { contextTime: 9.81, performanceTime: NOW_MS };
    expect(resolveAudioHeardTime(ctx, NOW_MS).time).toBeCloseTo(9.81, 6);
    reading = { contextTime: 9.83, performanceTime: NOW_MS };
    resolveAudioHeardTime(ctx, NOW_MS);
    // After a sink change the engine drops the hold: a small step back is followed, not held.
    resetAudioHeardTime(ctx);
    reading = { contextTime: 9.8, performanceTime: NOW_MS };
    expect(resolveAudioHeardTime(ctx, NOW_MS).time).toBeCloseTo(9.8, 6);
  });

  it('getAudioHeardTime (UI loop, native anchor, native position fallback) goes through the same path', () => {
    const ctx = fakeCtx(20, () => ({ contextTime: 19.9, performanceTime: performance.now() }));
    expect(getAudioHeardTime(ctx)).toBeCloseTo(19.9, 2);
    expect(getAudioHeardTime(fakeCtx(20, null, 0.01, 0.02))).toBeCloseTo(19.97, 6);
  });
});
