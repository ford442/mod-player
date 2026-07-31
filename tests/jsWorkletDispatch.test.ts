import { describe, expect, it } from 'vitest';
import { dispatchWorkletToMainMessage } from '../audio-worklet/jsWorkletDispatch';
import { WORKLET_TO_MAIN } from '../audio-worklet/workletProtocolConstants';
import { parseWorkletToMainMessage } from '../audio-worklet/protocol';
import type { ChannelShadowState } from '../types';
import type { WorkletPositionRefs } from '../utils/playheadPrediction';

function makeRefs(token = 1, lastSent = 1) {
  const channelStates: ChannelShadowState[] = [
    { volume: 0, pan: 0, freq: 0, trigger: 0, noteAge: 0, activeEffect: 0, effectValue: 0, isMuted: 0 },
  ];
  const refs: WorkletPositionRefs & {
    pendingSeekRef: { current: { order: number; row: number; timestamp: number } | null };
    seekAcknowledgedRef: { current: boolean };
    workletModuleTokenRef: { current: number };
    lastWorkletModuleTokenSentRef: { current: number };
    spFallbackTriggered: { current: boolean };
    channelStatesRef: { current: ChannelShadowState[] };
  } = {
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
    pendingSeekRef: { current: null },
    seekAcknowledgedRef: { current: false },
    workletModuleTokenRef: { current: token },
    lastWorkletModuleTokenSentRef: { current: lastSent },
    spFallbackTriggered: { current: false },
    channelStatesRef: { current: channelStates },
  };
  return refs;
}

function dispatchRaw(data: unknown, audioContextCurrentTime = 0) {
  const parsed = parseWorkletToMainMessage(data);
  expect(parsed.ok, parsed.ok ? '' : (parsed as { error: string }).error).toBe(true);
  if (!parsed.ok) throw new Error('parse failed');
  return dispatchWorkletToMainMessage({
    refs: makeRefs(),
    message: parsed.message,
    audioContextCurrentTime,
  });
}

describe('jsWorkletDispatch onmessage path', () => {
  it('applies valid position messages', () => {
    const refs = makeRefs();
    const parsed = parseWorkletToMainMessage({
      type: WORKLET_TO_MAIN.position,
      order: 2,
      row: 8,
      positionSeconds: 3.1,
      bpm: 130,
      audioTime: 10.5,
      rowFraction: 8.25,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const result = dispatchWorkletToMainMessage({
      refs,
      message: parsed.message,
      audioContextCurrentTime: 1,
    });

    expect(result.kind).toBe('position');
    expect(refs.workletOrderRef.current).toBe(2);
    expect(refs.workletRowRef.current).toBe(8);
  });

  it('rejects malformed messages before dispatch', () => {
    const malformed = parseWorkletToMainMessage({
      type: WORKLET_TO_MAIN.position,
      order: NaN,
      row: 0,
      positionSeconds: 1,
      bpm: 125,
    });
    expect(malformed.ok).toBe(false);
  });

  it('drops stale loaded ack when token mismatches', () => {
    const refs = makeRefs(2, 1);
    const parsed = parseWorkletToMainMessage({ type: WORKLET_TO_MAIN.loaded });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const result = dispatchWorkletToMainMessage({
      refs,
      message: parsed.message,
      audioContextCurrentTime: 0,
    });
    expect(result.kind).toBe('loaded-stale');
  });

  it('accepts loaded ack when tokens match', () => {
    const result = dispatchRaw({ type: WORKLET_TO_MAIN.loaded });
    expect(result.kind).toBe('loaded-accepted');
  });

  it('handles ended and seekAck messages', () => {
    expect(dispatchRaw({ type: WORKLET_TO_MAIN.ended }).kind).toBe('ended');

    const refs = makeRefs();
    refs.pendingSeekRef.current = { order: 1, row: 4, timestamp: 0 };
    const parsed = parseWorkletToMainMessage({ type: WORKLET_TO_MAIN.seekAck });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = dispatchWorkletToMainMessage({
      refs,
      message: parsed.message,
      audioContextCurrentTime: 0,
    });
    expect(result.kind).toBe('seek-ack');
    expect(refs.seekAcknowledgedRef.current).toBe(true);
    expect(refs.pendingSeekRef.current).toBeNull();
  });

  it('flags WASM init errors for SP fallback', () => {
    const result = dispatchRaw({
      type: WORKLET_TO_MAIN.error,
      message: 'Lib init failed: timeout',
    });
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.shouldAttemptSpFallback).toBe(true);
    }
  });

  it('does not re-trigger SP fallback after first attempt', () => {
    const refs = makeRefs();
    refs.spFallbackTriggered.current = true;
    const parsed = parseWorkletToMainMessage({
      type: WORKLET_TO_MAIN.error,
      message: 'Lib init failed: oops',
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = dispatchWorkletToMainMessage({
      refs,
      message: parsed.message,
      audioContextCurrentTime: 0,
    });
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.shouldAttemptSpFallback).toBe(false);
    }
  });

  it('forwards projectm-pcm when shape is valid', () => {
    const buf = new Float32Array(1024);
    const result = dispatchRaw({
      type: WORKLET_TO_MAIN.projectmPcm,
      buffer: buf,
      channels: 2,
    });
    expect(result.kind).toBe('projectm-pcm');
  });
});

describe('native path decode (PositionInfo fixture)', () => {
  it('decodePositionInfo is used by OpenMPTWorkletEngine poll path', async () => {
    const { readFileSync } = await import('node:fs');
    const { join, resolve } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
    const engineSrc = readFileSync(join(ROOT, 'audio-worklet/OpenMPTWorkletEngine.ts'), 'utf8');
    expect(engineSrc).toContain('decodePositionInfo');
    expect(engineSrc).not.toContain('POS_OFFSET_POSITION_MS');
  });
});
