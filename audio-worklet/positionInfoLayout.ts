/**
 * Native C++ PositionInfo struct layout — single source of truth for byte offsets.
 *
 * Must stay in sync with cpp/openmpt_wrapper.h struct PositionInfo.
 * Fixture-based tests in tests/positionInfoLayout.test.ts catch drift.
 */

import type { WorkletPositionData } from './types';

/** Maximum VU channels in the C++ struct (MAX_VU_CHANNELS). */
export const MAX_VU_CHANNELS = 32;

/**
 * Documented byte offsets within the PositionInfo POD struct (little-endian).
 *
 * struct PositionInfo {
 *   double positionMs;           // 0, 8
 *   int    currentRow;           // 8, 4
 *   int    currentPattern;       // 12, 4
 *   int    currentOrder;         // 16, 4
 *   (pad 4 for double align)
 *   double bpm;                  // 24, 8
 *   int    numChannels;          // 32, 4
 *   float  channelVU[32];        // 36, 128 → ends 164
 *   (pad 4 for double align)
 *   double audioFramesRendered;  // 168, 8
 *   float  rowFraction;          // 176, 4
 *   int    speed;                // 180, 4
 *   int    sampleRate;           // 184, 4
 * };
 */
export const POSITION_INFO_LAYOUT = {
  positionMs: { offset: 0, size: 8, kind: 'float64' as const },
  currentRow: { offset: 8, size: 4, kind: 'int32' as const },
  currentPattern: { offset: 12, size: 4, kind: 'int32' as const },
  currentOrder: { offset: 16, size: 4, kind: 'int32' as const },
  bpm: { offset: 24, size: 8, kind: 'float64' as const },
  numChannels: { offset: 32, size: 4, kind: 'int32' as const },
  channelVU: { offset: 36, size: MAX_VU_CHANNELS * 4, kind: 'float32[]' as const },
  audioFramesRendered: { offset: 168, size: 8, kind: 'float64' as const },
  rowFraction: { offset: 176, size: 4, kind: 'float32' as const },
  speed: { offset: 180, size: 4, kind: 'int32' as const },
  sampleRate: { offset: 184, size: 4, kind: 'int32' as const },
} as const;

/** Minimum bytes for core fields (through channelVU[32]). */
export const POSITION_INFO_CORE_BYTES = POSITION_INFO_LAYOUT.channelVU.offset
  + POSITION_INFO_LAYOUT.channelVU.size;

/** Minimum bytes for extended fields (frame clock + rowFraction + speed + sampleRate). */
export const POSITION_INFO_EXTENDED_BYTES = POSITION_INFO_LAYOUT.sampleRate.offset
  + POSITION_INFO_LAYOUT.sampleRate.size;

/** Shorthand offsets for consumers that only need the numeric value. */
export const POS_OFFSET_POSITION_MS = POSITION_INFO_LAYOUT.positionMs.offset;
export const POS_OFFSET_CURRENT_ROW = POSITION_INFO_LAYOUT.currentRow.offset;
export const POS_OFFSET_CURRENT_PATTERN = POSITION_INFO_LAYOUT.currentPattern.offset;
export const POS_OFFSET_CURRENT_ORDER = POSITION_INFO_LAYOUT.currentOrder.offset;
export const POS_OFFSET_BPM = POSITION_INFO_LAYOUT.bpm.offset;
export const POS_OFFSET_NUM_CHANNELS = POSITION_INFO_LAYOUT.numChannels.offset;
export const POS_OFFSET_CHANNEL_VU = POSITION_INFO_LAYOUT.channelVU.offset;
export const POS_OFFSET_AUDIO_FRAMES = POSITION_INFO_LAYOUT.audioFramesRendered.offset;
export const POS_OFFSET_ROW_FRACTION = POSITION_INFO_LAYOUT.rowFraction.offset;
export const POS_OFFSET_SPEED = POSITION_INFO_LAYOUT.speed.offset;
export const POS_OFFSET_SAMPLE_RATE = POSITION_INFO_LAYOUT.sampleRate.offset;

export interface DecodePositionInfoOptions {
  /** End of valid struct bytes within the backing buffer (default: buffer length). */
  bufferByteLength?: number;
}

/**
 * Decode a PositionInfo struct from WASM linear memory at `ptr`.
 * Returns null when the buffer is too small for core fields.
 */
export function decodePositionInfo(
  view: DataView,
  ptr: number,
  options: DecodePositionInfoOptions = {},
): WorkletPositionData | null {
  const bufferEnd = options.bufferByteLength ?? view.byteLength;
  const bytesAvailable = bufferEnd - ptr;
  if (bytesAvailable < POSITION_INFO_CORE_BYTES) {
    return null;
  }

  const positionMs = view.getFloat64(ptr + POS_OFFSET_POSITION_MS, true);
  const currentRow = view.getInt32(ptr + POS_OFFSET_CURRENT_ROW, true);
  const currentPattern = view.getInt32(ptr + POS_OFFSET_CURRENT_PATTERN, true);
  const currentOrder = view.getInt32(ptr + POS_OFFSET_CURRENT_ORDER, true);
  const bpm = view.getFloat64(ptr + POS_OFFSET_BPM, true);
  const numChannels = view.getInt32(ptr + POS_OFFSET_NUM_CHANNELS, true);

  const vuCount = Math.min(Math.max(0, numChannels), MAX_VU_CHANNELS);
  const channelVU = new Float32Array(MAX_VU_CHANNELS);
  for (let i = 0; i < vuCount; i++) {
    channelVU[i] = view.getFloat32(ptr + POS_OFFSET_CHANNEL_VU + i * 4, true);
  }

  let rowFraction: number | undefined;
  let speed: number | undefined;
  let audioFramesRendered: number | undefined;
  let sampleRate: number | undefined;

  if (bytesAvailable >= POSITION_INFO_EXTENDED_BYTES) {
    audioFramesRendered = view.getFloat64(ptr + POS_OFFSET_AUDIO_FRAMES, true);
    rowFraction = view.getFloat32(ptr + POS_OFFSET_ROW_FRACTION, true);
    speed = view.getInt32(ptr + POS_OFFSET_SPEED, true);
    sampleRate = view.getInt32(ptr + POS_OFFSET_SAMPLE_RATE, true);
  }

  const result: WorkletPositionData = {
    positionMs,
    currentRow,
    currentPattern,
    currentOrder,
    bpm,
    numChannels,
    channelVU,
  };

  if (rowFraction != null && Number.isFinite(rowFraction)) {
    result.rowFraction = rowFraction;
  }
  if (speed != null && speed > 0) {
    result.speed = speed;
  }
  if (audioFramesRendered != null && Number.isFinite(audioFramesRendered)) {
    result.audioFramesRendered = audioFramesRendered;
  }
  if (sampleRate != null && sampleRate > 0) {
    result.sampleRate = sampleRate;
  }
  if (
    audioFramesRendered != null &&
    Number.isFinite(audioFramesRendered) &&
    sampleRate != null &&
    sampleRate > 0
  ) {
    result.workletTime = audioFramesRendered / sampleRate;
  }

  return result;
}

/**
 * Encode a PositionInfo fixture for tests (little-endian layout).
 */
export function encodePositionInfoFixture(fields: {
  positionMs: number;
  currentRow: number;
  currentPattern: number;
  currentOrder: number;
  bpm: number;
  numChannels: number;
  channelVU?: number[];
  audioFramesRendered?: number;
  rowFraction?: number;
  speed?: number;
  sampleRate?: number;
}): ArrayBuffer {
  const buf = new ArrayBuffer(POSITION_INFO_EXTENDED_BYTES);
  const view = new DataView(buf);

  view.setFloat64(POS_OFFSET_POSITION_MS, fields.positionMs, true);
  view.setInt32(POS_OFFSET_CURRENT_ROW, fields.currentRow, true);
  view.setInt32(POS_OFFSET_CURRENT_PATTERN, fields.currentPattern, true);
  view.setInt32(POS_OFFSET_CURRENT_ORDER, fields.currentOrder, true);
  view.setFloat64(POS_OFFSET_BPM, fields.bpm, true);
  view.setInt32(POS_OFFSET_NUM_CHANNELS, fields.numChannels, true);

  const vu = fields.channelVU ?? [];
  for (let i = 0; i < MAX_VU_CHANNELS; i++) {
    view.setFloat32(POS_OFFSET_CHANNEL_VU + i * 4, vu[i] ?? 0, true);
  }

  if (fields.audioFramesRendered != null) {
    view.setFloat64(POS_OFFSET_AUDIO_FRAMES, fields.audioFramesRendered, true);
  }
  if (fields.rowFraction != null) {
    view.setFloat32(POS_OFFSET_ROW_FRACTION, fields.rowFraction, true);
  }
  if (fields.speed != null) {
    view.setInt32(POS_OFFSET_SPEED, fields.speed, true);
  }
  if (fields.sampleRate != null) {
    view.setInt32(POS_OFFSET_SAMPLE_RATE, fields.sampleRate, true);
  }

  return buf;
}
