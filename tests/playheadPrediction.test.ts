import { describe, expect, it } from 'vitest';
import {
  predictPlayheadFromSample,
  updateRowsPerSecondEstimate,
  rowsPerSecondFromBpm,
  getAudioHeardTime,
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
