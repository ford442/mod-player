/**
 * Normalize JS worklet position/VU reports into the one apply path
 * (`applyWorkletPositionSample` via `jsWorkletPositionToInput`), clocked by the
 * quantum `audioTime` / `workletTime`.
 */

import type { ChannelShadowState } from '../types';
import {
  applyWorkletPositionSample,
  type WorkletPositionInput,
  type WorkletPositionRefs,
  type WorkletPositionSample,
} from './playheadPrediction';

/** Loose JS worklet `position` message fields. */
export interface JsWorkletPositionMessage {
  order: number;
  row: number;
  positionSeconds: number;
  bpm?: number;
  speed?: number;
  rowFraction?: number;
  audioTime?: number;
  workletTime?: number;
  samplesWritten?: number;
  sampleRate?: number;
  channelVU?: Float32Array | number[] | null;
}

export interface ApplyPositionResult {
  sample: WorkletPositionSample;
  order: number;
  rowInt: number;
}

/** Map JS worklet position message → canonical position input. */
export function jsWorkletPositionToInput(
  data: JsWorkletPositionMessage,
  fallbackWorkletTime: number,
): WorkletPositionInput {
  const workletTime =
    (typeof data.audioTime === 'number' ? data.audioTime : null) ??
    (typeof data.workletTime === 'number' ? data.workletTime : null) ??
    fallbackWorkletTime;

  const input: WorkletPositionInput = {
    order: data.order,
    row: data.row,
    positionSeconds: data.positionSeconds,
    workletTime,
  };
  if (data.samplesWritten != null && data.samplesWritten > 0) {
    input.samplesWritten = data.samplesWritten;
  }
  if (data.sampleRate != null && data.sampleRate > 0) {
    input.sampleRate = data.sampleRate;
  }
  if (typeof data.rowFraction === 'number' && Number.isFinite(data.rowFraction)) {
    input.rowFraction = data.rowFraction;
  }
  if (data.bpm != null && data.bpm > 0) {
    input.bpm = data.bpm;
  }
  if (data.speed != null && data.speed > 0) {
    input.speed = data.speed;
  }
  return input;
}

/** Apply VU/trigger only — noteAge is owned by updateUI (fractional playhead). */
export function applyChannelVu(
  channelStates: ChannelShadowState[],
  channelVU: Float32Array | number[] | null | undefined,
  numChannels?: number,
): void {
  if (!channelVU || channelStates.length === 0) return;
  const limit = Math.min(
    channelVU.length,
    channelStates.length,
    numChannels ?? channelVU.length,
  );
  for (let c = 0; c < limit; c++) {
    const existing = channelStates[c];
    if (!existing) continue;
    const vu = channelVU[c] != null ? Number(channelVU[c]) : existing.volume;
    existing.volume = vu;
    existing.trigger = vu > 0.05 ? 1 : 0;
  }
}

/**
 * Shared apply path: normalize → applyWorkletPositionSample → optional VU.
 */
export function applyNormalizedPosition(
  refs: WorkletPositionRefs,
  input: WorkletPositionInput,
  options?: {
    channelStates?: ChannelShadowState[];
    channelVU?: Float32Array | number[] | null;
    numChannels?: number;
  },
): ApplyPositionResult {
  const sample = applyWorkletPositionSample(refs, input);
  if (options?.channelStates) {
    applyChannelVu(options.channelStates, options.channelVU, options.numChannels);
  }
  return {
    sample,
    order: sample.order,
    rowInt: sample.rowInt,
  };
}
