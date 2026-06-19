/**
 * Audio-clock playhead prediction for worklet playback.
 *
 * Worklet position samples are tagged with AudioWorklet `currentTime` (when the
 * rendered block starts playing). The main thread extrapolates to the instant
 * currently heard at the speakers: audioContext.currentTime − output latency.
 */

export const ROWS_PER_BEAT = 4;

/** Maximum extrapolation window — avoids runaway after tab backgrounding. */
export const MAX_EXTRAPOLATION_SEC = 2;

export interface WorkletPositionSample {
  order: number;
  row: number;
  positionSeconds: number;
  /** AudioWorklet currentTime when the sample block begins playback. */
  workletTime: number;
  bpm: number;
  speed: number;
}

/** Playback instant currently at the speakers (seconds, audio clock). */
export function getAudioHeardTime(audioCtx: AudioContext, now = audioCtx.currentTime): number {
  const latency = (audioCtx.baseLatency ?? 0) + (audioCtx.outputLatency ?? 0);
  return now - latency;
}

/** Fallback rows/sec from estimated BPM (4 rows per beat). */
export function rowsPerSecondFromBpm(bpm: number): number {
  return Math.max(0.25, (Math.max(bpm, 1) / 60) * ROWS_PER_BEAT);
}

export function predictPlayheadFromSample(
  sample: WorkletPositionSample,
  heardTime: number,
  rowsPerSecond: number,
): { playheadRow: number; positionSeconds: number } {
  const dt = Math.max(0, Math.min(heardTime - sample.workletTime, MAX_EXTRAPOLATION_SEC));
  return {
    playheadRow: sample.row + dt * rowsPerSecond,
    positionSeconds: sample.positionSeconds + dt,
  };
}

/** Low-pass measured row rate from consecutive worklet samples (same order). */
export function updateRowsPerSecondEstimate(
  prev: WorkletPositionSample | null,
  current: WorkletPositionSample,
  numRows: number,
  currentEstimate: number,
): number {
  if (!prev || prev.order !== current.order) return currentEstimate;
  const wallDt = current.workletTime - prev.workletTime;
  if (wallDt < 0.0005 || wallDt > 0.25) return currentEstimate;

  let rowDelta = current.row - prev.row;
  if (rowDelta < -numRows / 2) rowDelta += numRows;
  if (rowDelta < 0 || rowDelta > 16) return currentEstimate;

  const measured = rowDelta / wallDt;
  if (!Number.isFinite(measured) || measured < 0.1 || measured > 64) return currentEstimate;
  return currentEstimate * 0.65 + measured * 0.35;
}

/** Circular overlay / WGSL v0.46 page start from fractional playhead. */
export function circularPageStart(playhead: number, numRows: number): number {
  if (numRows <= 0) return 0;
  return Math.floor(playhead / numRows) * numRows;
}

/** Row index fetched for overlay instance stepIndex (matches webGLShaders.ts VS). */
export function overlayActualRow(stepIndex: number, playhead: number, numRows: number): number {
  const pageStart = circularPageStart(playhead, numRows);
  return Math.max(0, Math.min(pageStart + stepIndex, numRows - 1));
}


type Ref<T> = { current: T };

export interface WorkletPositionRefs {
  workletOrderRef: Ref<number>;
  workletRowRef: Ref<number>;
  workletTimeRef: Ref<number>;
  workletTimestampRef: Ref<number>;
  lastWorkletUpdateRef: Ref<number>;
  workletBpmRef: Ref<number>;
  workletSpeedRef: Ref<number>;
  workletRowsPerSecRef: Ref<number>;
  workletPositionSampleRef: Ref<WorkletPositionSample | null>;
  patternMatricesRef: Ref<{ numRows?: number }[]>;
}

/** Apply a worklet/native position report and update rolling row-rate estimate. */
export function applyWorkletPositionSample(
  refs: WorkletPositionRefs,
  data: {
    order: number;
    row: number;
    positionSeconds: number;
    workletTime: number;
    bpm?: number;
    speed?: number;
  },
): WorkletPositionSample {
  const sample: WorkletPositionSample = {
    order: data.order,
    row: data.row,
    positionSeconds: data.positionSeconds,
    workletTime: data.workletTime,
    bpm: (data.bpm != null && data.bpm > 0) ? data.bpm : refs.workletBpmRef.current,
    speed: (data.speed != null && data.speed > 0) ? data.speed : refs.workletSpeedRef.current,
  };

  const numRows = refs.patternMatricesRef.current[sample.order]?.numRows ?? 64;
  refs.workletRowsPerSecRef.current = updateRowsPerSecondEstimate(
    refs.workletPositionSampleRef.current,
    sample,
    numRows,
    refs.workletRowsPerSecRef.current,
  );

  refs.workletPositionSampleRef.current = sample;
  refs.workletOrderRef.current = sample.order;
  refs.workletRowRef.current = sample.row;
  refs.workletTimeRef.current = sample.positionSeconds;
  refs.workletTimestampRef.current = sample.workletTime;
  refs.lastWorkletUpdateRef.current = sample.workletTime;
  if (sample.bpm > 0) refs.workletBpmRef.current = sample.bpm;
  if (sample.speed > 0) refs.workletSpeedRef.current = sample.speed;

  return sample;
}
