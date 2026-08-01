/**
 * Playhead lag + position-report diagnostics (Phase 1 stabilization).
 * Pure helpers — no DOM/audio dependencies. Used by updateUI when debug is on.
 */

import { TARGET_MAX_LAG_ROWS } from './playheadPrediction';
import { WORKLET_POSITION_REPORT_HZ } from './workletAudioLifecycle';

/** Warn when |smoothed − sample| exceeds this for consecutive RAF frames. */
export const PLAYHEAD_LAG_WARN_ROWS = TARGET_MAX_LAG_ROWS + 0.5; // 1.5 rows

/** ~0.75 s of 60 fps RAF with sustained high lag before warning. */
export const PLAYHEAD_LAG_WARN_CONSECUTIVE = 45;

/** Growing drift: lag slope (rows/s) above this triggers a warning. */
export const PLAYHEAD_DRIFT_GROWTH_WARN_ROWS_PER_SEC = 1.5;

/** Position reports faster than this (Hz) suggest throttle regression (#354). */
export const POSITION_REPORT_HZ_WARN_ABOVE = WORKLET_POSITION_REPORT_HZ + 15; // 75 Hz

export interface PlayheadLagTracker {
  consecutiveHighLag: number;
  lastLagRows: number;
  maxAbsLagRows: number;
  lastUpdateMs: number;
  lastWarnHighLagMs: number;
  lastWarnDriftMs: number;
}

export interface PositionReportTracker {
  windowStartMs: number;
  count: number;
  hz: number;
  lastWarnFloodMs: number;
}

export function createPlayheadLagTracker(): PlayheadLagTracker {
  return {
    consecutiveHighLag: 0,
    lastLagRows: 0,
    maxAbsLagRows: 0,
    lastUpdateMs: 0,
    lastWarnHighLagMs: Number.NEGATIVE_INFINITY,
    lastWarnDriftMs: Number.NEGATIVE_INFINITY,
  };
}

export function createPositionReportTracker(nowMs = 0): PositionReportTracker {
  return {
    windowStartMs: nowMs,
    count: 0,
    hz: 0,
    lastWarnFloodMs: Number.NEGATIVE_INFINITY,
  };
}

const WARN_COOLDOWN_MS = 5000;
const POSITION_RATE_WINDOW_MS = 1000;

export interface PlayheadLagUpdate {
  tracker: PlayheadLagTracker;
  lagRows: number;
  warning: string | null;
}

/**
 * Track smoothed-vs-sample lag; emit throttled warnings for sustained high lag
 * or monotonically growing drift.
 */
export function updatePlayheadLagTracker(
  tracker: PlayheadLagTracker,
  sampleRow: number,
  smoothedRow: number,
  nowMs: number,
): PlayheadLagUpdate {
  const lagRows = smoothedRow - sampleRow;
  const absLag = Math.abs(lagRows);
  const next: PlayheadLagTracker = {
    ...tracker,
    lastLagRows: lagRows,
    maxAbsLagRows: Math.max(tracker.maxAbsLagRows, absLag),
    lastUpdateMs: nowMs,
  };

  let warning: string | null = null;

  if (absLag > PLAYHEAD_LAG_WARN_ROWS) {
    next.consecutiveHighLag = tracker.consecutiveHighLag + 1;
    if (
      next.consecutiveHighLag >= PLAYHEAD_LAG_WARN_CONSECUTIVE &&
      nowMs - tracker.lastWarnHighLagMs >= WARN_COOLDOWN_MS
    ) {
      warning =
        `sustained playhead lag ${lagRows.toFixed(2)} rows ` +
        `(sample=${sampleRow.toFixed(2)} smoothed=${smoothedRow.toFixed(2)}) ` +
        `for ${next.consecutiveHighLag} frames — check prediction/latency`;
      next.lastWarnHighLagMs = nowMs;
    }
  } else {
    next.consecutiveHighLag = 0;
  }

  const dtMs = nowMs - tracker.lastUpdateMs;
  if (dtMs > 200 && tracker.lastUpdateMs > 0) {
    const slope = (lagRows - tracker.lastLagRows) / (dtMs / 1000);
    if (
      Math.abs(slope) > PLAYHEAD_DRIFT_GROWTH_WARN_ROWS_PER_SEC &&
      absLag > TARGET_MAX_LAG_ROWS &&
      nowMs - tracker.lastWarnDriftMs >= WARN_COOLDOWN_MS
    ) {
      warning =
        `growing playhead drift ${slope.toFixed(2)} rows/s ` +
        `(lag now ${lagRows.toFixed(2)} rows, max observed ${next.maxAbsLagRows.toFixed(2)})`;
      next.lastWarnDriftMs = nowMs;
    }
  }

  return { tracker: next, lagRows, warning };
}

export interface PositionReportUpdate {
  tracker: PositionReportTracker;
  warning: string | null;
}

/** Count worklet position messages in a 1 s sliding window. */
export function trackPositionReport(
  tracker: PositionReportTracker,
  nowMs: number,
): PositionReportUpdate {
  let warning: string | null = null;
  let { windowStartMs, count, hz, lastWarnFloodMs } = tracker;

  if (windowStartMs === 0) {
    windowStartMs = nowMs;
  }

  const elapsed = nowMs - windowStartMs;
  if (elapsed >= POSITION_RATE_WINDOW_MS) {
    hz = (count * 1000) / Math.max(elapsed, 1);
    if (hz > POSITION_REPORT_HZ_WARN_ABOVE && nowMs - lastWarnFloodMs >= WARN_COOLDOWN_MS) {
      warning =
        `position report flood ~${hz.toFixed(0)} Hz (target ≤${WORKLET_POSITION_REPORT_HZ} Hz) — #354 regression?`;
      lastWarnFloodMs = nowMs;
    }
    windowStartMs = nowMs;
    count = 1;
  } else {
    count += 1;
    hz = elapsed > 0 ? (count * 1000) / elapsed : 0;
    if (
      elapsed >= 500 &&
      hz > POSITION_REPORT_HZ_WARN_ABOVE &&
      nowMs - lastWarnFloodMs >= WARN_COOLDOWN_MS
    ) {
      warning =
        `position report flood ~${hz.toFixed(0)} Hz (target ≤${WORKLET_POSITION_REPORT_HZ} Hz) — #354 regression?`;
      lastWarnFloodMs = nowMs;
    }
  }

  return {
    tracker: { windowStartMs, count, hz, lastWarnFloodMs },
    warning,
  };
}
