/**
 * Audio-clock playhead prediction for worklet playback.
 *
 * Worklet position samples are tagged with AudioWorklet `currentTime` at the
 * start of the quantum whose first sample matches the reported row state
 * (pre-render snapshot). The main thread maps that to the instant currently
 * heard at the speakers:
 *
 *   heardTime = audioContext.currentTime − (baseLatency + outputLatency)
 *   playhead  = sample.row + (heardTime − sample.workletTime) × rowsPerSecond
 *
 * Negative dt is allowed (bounded) so we can step slightly *behind* a just-
 * reported sample when output latency means the ear is still hearing earlier
 * audio. Clamping dt≥0 was a common source of ~1–several-row visual lead/lag.
 *
 * ScriptProcessor path does not use this module for display — it queries
 * libopenmpt inside `onaudioprocess` (inherently sample-aligned).
 */

export const ROWS_PER_BEAT = 4;

/** Maximum |extrapolation| window — avoids runaway after tab backgrounding. */
export const MAX_EXTRAPOLATION_SEC = 2;

/**
 * At 125 BPM / speed 6, rows/sec ≈ 125/60×4 ≈ 8.33.
 * One row ≈ 120 ms. Lag budget of ~1 row ≈ 0.12 s.
 */
export const TARGET_MAX_LAG_ROWS = 1;

export interface WorkletPositionSample {
  order: number;
  /**
   * Fractional playhead row within the current order/pattern
   * (integer part = libopenmpt row, fraction = progress within row).
   */
  row: number;
  /** Integer row as reported by libopenmpt (for seek ack / UI). */
  rowInt: number;
  positionSeconds: number;
  /**
   * Audio timeline time (AudioContext/currentTime domain) when this sample's
   * first output frame is scheduled — pre-render snapshot tag.
   */
  workletTime: number;
  bpm: number;
  speed: number;
}

/** Playback instant currently at the speakers (seconds, audio clock). */
export function getAudioHeardTime(audioCtx: AudioContext, now = audioCtx.currentTime): number {
  const base = audioCtx.baseLatency ?? 0;
  // outputLatency is missing or 0 in some browsers; baseLatency alone is still useful.
  const output = audioCtx.outputLatency ?? 0;
  return now - base - output;
}

/** Fallback rows/sec from estimated BPM (4 rows per beat). */
export function rowsPerSecondFromBpm(bpm: number): number {
  return Math.max(0.25, (Math.max(bpm, 1) / 60) * ROWS_PER_BEAT);
}

/**
 * Tracker-aware rows/sec. libopenmpt's estimated BPM already folds speed/tempo
 * changes; speed is retained for diagnostics and future tick-level models.
 */
export function rowsPerSecondFromTempo(bpm: number, _speed?: number): number {
  return rowsPerSecondFromBpm(bpm);
}

/**
 * Predict fractional playhead from a worklet-authored sample.
 * Allows bounded negative dt for output-latency compensation.
 */
export function predictPlayheadFromSample(
  sample: WorkletPositionSample,
  heardTime: number,
  rowsPerSecond: number,
): { playheadRow: number; positionSeconds: number; dtSec: number } {
  const rawDt = heardTime - sample.workletTime;
  const dt = Math.max(-MAX_EXTRAPOLATION_SEC, Math.min(rawDt, MAX_EXTRAPOLATION_SEC));
  return {
    playheadRow: sample.row + dt * rowsPerSecond,
    positionSeconds: sample.positionSeconds + dt,
    dtSec: dt,
  };
}

/**
 * Estimate fractional row from song position vs libopenmpt time-at-row markers.
 * Returns integer row when times are unavailable.
 */
export function fractionalRowFromTimeMarkers(
  rowInt: number,
  positionSeconds: number,
  rowStartSec: number,
  nextRowStartSec: number,
): number {
  if (!Number.isFinite(rowStartSec) || !Number.isFinite(nextRowStartSec)) {
    return rowInt;
  }
  if (!(nextRowStartSec > rowStartSec)) {
    return rowInt;
  }
  const frac = (positionSeconds - rowStartSec) / (nextRowStartSec - rowStartSec);
  if (!Number.isFinite(frac)) return rowInt;
  return rowInt + Math.min(0.999, Math.max(0, frac));
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
  // Pattern wrap (fractional)
  if (rowDelta < -numRows / 2) rowDelta += numRows;
  if (rowDelta < 0 || rowDelta > 16) return currentEstimate;

  const measured = rowDelta / wallDt;
  if (!Number.isFinite(measured) || measured < 0.1 || measured > 64) return currentEstimate;
  // Slightly favor measured rate so prediction tracks tempo slides.
  return currentEstimate * 0.55 + measured * 0.45;
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

/**
 * Expected max lag in rows for a given output latency and tempo.
 * Used by measurement docs / automated checks.
 */
export function expectedLatencyRows(latencySec: number, bpm: number): number {
  return Math.abs(latencySec) * rowsPerSecondFromBpm(bpm);
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

export interface WorkletPositionInput {
  order: number;
  /** Integer or fractional row; prefer rowFraction when provided. */
  row: number;
  /** Explicit fractional playhead from worklet (preferred). */
  rowFraction?: number;
  positionSeconds: number;
  workletTime: number;
  bpm?: number;
  speed?: number;
}

/** Apply a worklet/native position report and update rolling row-rate estimate. */
export function applyWorkletPositionSample(
  refs: WorkletPositionRefs,
  data: WorkletPositionInput,
): WorkletPositionSample {
  const rowInt = Math.floor(data.row);
  const rowFrac =
    data.rowFraction != null && Number.isFinite(data.rowFraction)
      ? data.rowFraction
      : data.row;

  const sample: WorkletPositionSample = {
    order: data.order,
    row: rowFrac,
    rowInt,
    positionSeconds: data.positionSeconds,
    workletTime: data.workletTime,
    bpm: (data.bpm != null && data.bpm > 0) ? data.bpm : refs.workletBpmRef.current,
    speed: (data.speed != null && data.speed > 0) ? data.speed : refs.workletSpeedRef.current,
  };

  const numRows = refs.patternMatricesRef.current[sample.order]?.numRows ?? 64;
  const tempoRps = rowsPerSecondFromTempo(sample.bpm, sample.speed);
  // Seed estimate from tempo when empty/stale
  if (!(refs.workletRowsPerSecRef.current > 0.1)) {
    refs.workletRowsPerSecRef.current = tempoRps;
  }
  refs.workletRowsPerSecRef.current = updateRowsPerSecondEstimate(
    refs.workletPositionSampleRef.current,
    sample,
    numRows,
    refs.workletRowsPerSecRef.current || tempoRps,
  );

  refs.workletPositionSampleRef.current = sample;
  refs.workletOrderRef.current = sample.order;
  // Keep integer ref for seek-ack / moduleInfo; fractional lives on sample + prediction.
  refs.workletRowRef.current = sample.rowInt;
  refs.workletTimeRef.current = sample.positionSeconds;
  refs.workletTimestampRef.current = sample.workletTime;
  refs.lastWorkletUpdateRef.current = sample.workletTime;
  if (sample.bpm > 0) refs.workletBpmRef.current = sample.bpm;
  if (sample.speed > 0) refs.workletSpeedRef.current = sample.speed;

  return sample;
}
