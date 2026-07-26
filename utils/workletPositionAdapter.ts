/**
 * Unify JS worklet and native engine position/VU reports into one apply path.
 *
 * Both engines feed `applyWorkletPositionSample` via `toWorkletPositionInput`.
 * Native uses the sample-accurate frame clock (`audioFramesRendered/sampleRate`)
 * when available; JS uses quantum `audioTime` / `workletTime`.
 */

import type { ChannelShadowState } from '../types';
import type { WorkletPositionData } from '../audio-worklet/types';
import {
  applyWorkletPositionSample,
  type WorkletPositionInput,
  type WorkletPositionRefs,
  type WorkletPositionSample,
} from './playheadPrediction';

export type PositionSource = 'js-worklet' | 'native' | 'scriptprocessor';

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
  channelVU?: Float32Array | number[] | null;
}

export interface ApplyPositionResult {
  sample: WorkletPositionSample;
  order: number;
  rowInt: number;
}

/**
 * Native frame clock: seconds of audio rendered since load/play.
 * Prefers pre-quantum count when the struct is tagged that way; otherwise
 * uses cumulative frames / sampleRate.
 */
export function nativeWorkletTimeFromFrames(
  audioFramesRendered: number | undefined,
  sampleRate: number | undefined,
  fallbackTime: number,
): number {
  if (
    audioFramesRendered != null &&
    Number.isFinite(audioFramesRendered) &&
    sampleRate != null &&
    sampleRate > 0
  ) {
    return audioFramesRendered / sampleRate;
  }
  return fallbackTime;
}

/** Map native `WorkletPositionData` → canonical position input. */
export function nativePositionToInput(
  data: WorkletPositionData,
  fallbackWorkletTime: number,
): WorkletPositionInput {
  const workletTime = data.workletTime ?? nativeWorkletTimeFromFrames(
    data.audioFramesRendered,
    data.sampleRate,
    fallbackWorkletTime,
  );
  const input: WorkletPositionInput = {
    order: data.currentOrder,
    row: data.currentRow,
    positionSeconds: data.positionMs / 1000,
    workletTime,
    bpm: data.bpm,
  };
  if (data.rowFraction != null && Number.isFinite(data.rowFraction)) {
    input.rowFraction = data.rowFraction;
  }
  if (data.speed != null && data.speed > 0) {
    input.speed = data.speed;
  }
  return input;
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
