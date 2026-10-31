import { describe, expect, it } from 'vitest';
import {
  jsWorkletPositionToInput,
  applyChannelVu,
  applyNormalizedPosition,
} from '../utils/workletPositionAdapter';
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

  it('feeds JS worklet samples through the shared apply path', () => {
    const refs = makeRefs();
    const channelVU = new Float32Array([0.5, 0]);
    const input = jsWorkletPositionToInput(
      { order: 0, row: 10, positionSeconds: 5, bpm: 125, rowFraction: 10.2, audioTime: 1.0 },
      0,
    );
    const states: ChannelShadowState[] = [
      { volume: 0, pan: 0, freq: 0, trigger: 0, noteAge: 0, activeEffect: 0, effectValue: 0, isMuted: 0 },
      { volume: 0, pan: 0, freq: 0, trigger: 0, noteAge: 0, activeEffect: 0, effectValue: 0, isMuted: 0 },
    ];
    const applied = applyNormalizedPosition(refs, input, {
      channelStates: states,
      channelVU,
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
