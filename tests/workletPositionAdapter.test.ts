import { describe, expect, it } from 'vitest';
import {
  nativeWorkletTimeFromFrames,
  nativePositionToInput,
  jsWorkletPositionToInput,
  applyChannelVu,
  applyNormalizedPosition,
} from '../utils/workletPositionAdapter';
import type { WorkletPositionData } from '../audio-worklet/types';
import type { ChannelShadowState } from '../types';
import type { WorkletPositionRefs } from '../utils/playheadPrediction';

function makeRefs(): WorkletPositionRefs {
  return {
    workletOrderRef: { current: 0 },
    workletRowRef: { current: 0 },
    workletTimeRef: { current: 0 },
    workletTimestampRef: { current: 0 },
    lastWorkletUpdateRef: { current: 0 },
    workletBpmRef: { current: 125 },
    workletSpeedRef: { current: 6 },
    workletRowsPerSecRef: { current: 0 },
    workletPositionSampleRef: { current: null },
    patternMatricesRef: { current: [{ numRows: 64 }] },
  };
}

describe('workletPositionAdapter', () => {
  it('derives workletTime from native frame clock', () => {
    expect(nativeWorkletTimeFromFrames(48000, 48000, 99)).toBeCloseTo(1.0, 6);
    expect(nativeWorkletTimeFromFrames(undefined, 48000, 42)).toBe(42);
  });

  it('maps native PositionInfo fields to canonical input', () => {
    const data: WorkletPositionData = {
      positionMs: 2500,
      currentRow: 12,
      currentPattern: 3,
      currentOrder: 1,
      bpm: 140,
      numChannels: 4,
      channelVU: new Float32Array(4),
      rowFraction: 12.4,
      speed: 6,
      audioFramesRendered: 96000,
      sampleRate: 48000,
      workletTime: 2.0,
    };
    const input = nativePositionToInput(data, 99);
    expect(input.order).toBe(1);
    expect(input.row).toBe(12);
    expect(input.rowFraction).toBeCloseTo(12.4, 5);
    expect(input.positionSeconds).toBeCloseTo(2.5, 5);
    expect(input.workletTime).toBe(2.0);
  });

  it('falls back to frame clock when native workletTime unset', () => {
    const data: WorkletPositionData = {
      positionMs: 1000,
      currentRow: 0,
      currentPattern: 0,
      currentOrder: 0,
      bpm: 125,
      numChannels: 2,
      channelVU: new Float32Array(2),
      audioFramesRendered: 24000,
      sampleRate: 48000,
    };
    const input = nativePositionToInput(data, 99);
    expect(input.workletTime).toBeCloseTo(0.5, 6);
  });

  it('maps JS worklet message preferring audioTime', () => {
    const input = jsWorkletPositionToInput(
      {
        order: 2,
        row: 8,
        positionSeconds: 3.1,
        bpm: 130,
        audioTime: 10.5,
        workletTime: 9.9,
        rowFraction: 8.25,
      },
      1,
    );
    expect(input.workletTime).toBe(10.5);
    expect(input.rowFraction).toBeCloseTo(8.25, 5);
    expect(input.order).toBe(2);
  });

  it('prefers app-facing order/row aliases on native samples', () => {
    const data: WorkletPositionData = {
      positionMs: 0,
      currentRow: 3,
      currentPattern: 0,
      currentOrder: 1,
      order: 9,
      row: 4,
      bpm: 125,
      numChannels: 2,
      channelVU: new Float32Array(2),
    };
    const input = nativePositionToInput(data, 0);
    expect(input.order).toBe(9);
    expect(input.row).toBe(4);
  });

  it('applies VU/trigger without touching noteAge', () => {
    const states: ChannelShadowState[] = [
      { volume: 0, pan: 0, freq: 0, trigger: 0, noteAge: 5, activeEffect: 0, effectValue: 0, isMuted: 0 },
      { volume: 0, pan: 0, freq: 0, trigger: 0, noteAge: 3, activeEffect: 0, effectValue: 0, isMuted: 0 },
    ];
    applyChannelVu(states, [0.2, 0.01]);
    expect(states[0]!.volume).toBeCloseTo(0.2);
    expect(states[0]!.trigger).toBe(1);
    expect(states[0]!.noteAge).toBe(5);
    expect(states[1]!.trigger).toBe(0);
  });

  it('maps native PositionInfo with clock anchor onto heard-time', () => {
    const data: WorkletPositionData = {
      positionMs: 5000,
      currentRow: 10,
      currentPattern: 0,
      currentOrder: 0,
      bpm: 125,
      numChannels: 2,
      channelVU: new Float32Array(2),
      rowFraction: 10.2,
      audioFramesRendered: 48000,
      sampleRate: 48000,
    };
    const anchor = {
      frameSecondsAtAnchor: 0,
      mainHeardTimeAtAnchor: 50,
      bridgeLatencySec: 0,
    };
    const input = nativePositionToInput(data, 99, { clockAnchor: anchor, fallbackHeardTime: 99 });
    expect(input.workletTime).toBeCloseTo(51, 6);
  });

  it('feeds native-shaped samples through shared apply path', () => {
    const refs = makeRefs();
    const data: WorkletPositionData = {
      positionMs: 5000,
      currentRow: 10,
      currentPattern: 0,
      currentOrder: 0,
      bpm: 125,
      numChannels: 2,
      channelVU: new Float32Array([0.5, 0]),
      rowFraction: 10.2,
      audioFramesRendered: 48000,
      sampleRate: 48000,
    };
    const input = nativePositionToInput(data, 0);
    const states: ChannelShadowState[] = [
      { volume: 0, pan: 0, freq: 0, trigger: 0, noteAge: 0, activeEffect: 0, effectValue: 0, isMuted: 0 },
      { volume: 0, pan: 0, freq: 0, trigger: 0, noteAge: 0, activeEffect: 0, effectValue: 0, isMuted: 0 },
    ];
    const applied = applyNormalizedPosition(refs, input, {
      channelStates: states,
      channelVU: data.channelVU,
      numChannels: 2,
    });
    expect(applied.order).toBe(0);
    expect(applied.rowInt).toBe(10);
    expect(applied.sample.row).toBeCloseTo(10.2, 5);
    expect(applied.sample.workletTime).toBeCloseTo(1.0, 6);
    expect(states[0]!.volume).toBeCloseTo(0.5);
    expect(refs.workletPositionSampleRef.current?.workletTime).toBeCloseTo(1.0, 6);
  });
});
