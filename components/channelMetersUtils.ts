/** Constants and pure helpers for ChannelMeters canvas VU rendering. */

export const DB_FLOOR = -60;
export const HOT_THRESHOLD_DB = -1.5;
export const PEAK_HOLD_MS = 800;
export const PEAK_DECAY_DB_PER_SEC = 60;
export const CLIP_HOLD_MS = 2000;
export const TAU_ATTACK_SEC = 0.010;
export const TAU_RELEASE_SEC = 0.150;
export const MAX_DELTA_TIME_SEC = 0.050;

/** dB → color stops for meter gradient (bottom = floor, top = 0 dBFS). */
export const DB_COLOR_STOPS: ReadonlyArray<{ db: number; color: string }> = [
  { db: -60, color: '#1a472a' },
  { db: -20, color: '#22c55e' },
  { db: -12, color: '#eab308' },
  { db: -6, color: '#f97316' },
  { db: 0, color: '#ef4444' },
];

export function linearToDb(linear: number): number {
  const x = Math.max(linear, 1e-10);
  const db = 20 * Math.log10(x);
  return Math.max(db, DB_FLOOR);
}

export function dbToNormalized(db: number): number {
  return Math.min(1, Math.max(0, (db + 60) / 60));
}

export function capDeltaTime(dtSec: number): number {
  if (!Number.isFinite(dtSec) || dtSec <= 0) {
    return 1 / 60;
  }
  return Math.min(dtSec, MAX_DELTA_TIME_SEC);
}

/** One-pole exponential smoothing in the linear domain (time-based, frame-rate independent). */
export function onePoleStep(current: number, target: number, dtSec: number): number {
  const tau = target > current ? TAU_ATTACK_SEC : TAU_RELEASE_SEC;
  const alpha = 1 - Math.exp(-dtSec / tau);
  return current + (target - current) * alpha;
}

export interface PeakHoldResult {
  peakDb: number;
  holdUntil: number;
}

/** Time-based peak-hold with instant attack, hold window, then dB/sec decay. */
export function updatePeakHold(
  peakDb: number,
  levelDb: number,
  holdUntil: number,
  nowMs: number,
  dtSec: number,
): PeakHoldResult {
  if (levelDb > peakDb) {
    return { peakDb: levelDb, holdUntil: nowMs + PEAK_HOLD_MS };
  }
  if (nowMs < holdUntil) {
    return { peakDb, holdUntil };
  }
  const floor = Math.max(levelDb, DB_FLOOR);
  const decayed = peakDb - PEAK_DECAY_DB_PER_SEC * dtSec;
  return { peakDb: Math.max(decayed, floor), holdUntil };
}

export interface HotIndicatorResult {
  hotLatched: boolean;
  clearAt: number;
}

/**
 * Latch hot indicator when level crosses HOT_THRESHOLD_DB.
 * Auto-clears CLIP_HOLD_MS after level drops below threshold.
 * True 0 dBFS clip is not detectable from pre-clamped channelVU — uses near-full-scale warning.
 */
export function updateHotIndicator(
  hotLatched: boolean,
  clearAt: number,
  levelDb: number,
  nowMs: number,
): HotIndicatorResult {
  if (levelDb >= HOT_THRESHOLD_DB) {
    return { hotLatched: true, clearAt: 0 };
  }
  if (!hotLatched) {
    return { hotLatched: false, clearAt: 0 };
  }
  if (clearAt === 0) {
    return { hotLatched: true, clearAt: nowMs + CLIP_HOLD_MS };
  }
  if (nowMs >= clearAt) {
    return { hotLatched: false, clearAt: 0 };
  }
  return { hotLatched: true, clearAt };
}

export interface ChannelMeterState {
  smoothedLinear: number;
  peakDb: number;
  holdUntil: number;
  hotLatched: boolean;
  clearAt: number;
}

export function createChannelMeterState(): ChannelMeterState {
  return {
    smoothedLinear: 0,
    peakDb: DB_FLOOR,
    holdUntil: 0,
    hotLatched: false,
    clearAt: 0,
  };
}

export function resetChannelMeterState(state: ChannelMeterState): void {
  state.smoothedLinear = 0;
  state.peakDb = DB_FLOOR;
  state.holdUntil = 0;
  state.hotLatched = false;
  state.clearAt = 0;
}

export interface ChannelMeterFrame {
  smoothedDb: number;
  peakDb: number;
  hotLatched: boolean;
}

/** Advance one channel by dtSec; returns display values for the current frame. */
export function advanceChannelMeter(
  state: ChannelMeterState,
  targetLinear: number,
  dtSec: number,
  nowMs: number,
): ChannelMeterFrame {
  const rectified = Math.min(1, Math.max(0, targetLinear));
  state.smoothedLinear = onePoleStep(state.smoothedLinear, rectified, dtSec);
  const smoothedDb = linearToDb(state.smoothedLinear);
  const instantDb = linearToDb(rectified);

  const peak = updatePeakHold(state.peakDb, instantDb, state.holdUntil, nowMs, dtSec);
  state.peakDb = peak.peakDb;
  state.holdUntil = peak.holdUntil;

  const hot = updateHotIndicator(state.hotLatched, state.clearAt, smoothedDb, nowMs);
  state.hotLatched = hot.hotLatched;
  state.clearAt = hot.clearAt;

  return { smoothedDb, peakDb: state.peakDb, hotLatched: state.hotLatched };
}

/** Apply a dB-scaled gradient to a canvas context spanning barTop..barBottom. */
export function applyDbGradient(
  ctx: CanvasRenderingContext2D,
  x: number,
  barTop: number,
  barBottom: number,
): CanvasGradient {
  const grad = ctx.createLinearGradient(x, barBottom, x, barTop);
  for (const stop of DB_COLOR_STOPS) {
    grad.addColorStop(dbToNormalized(stop.db), stop.color);
  }
  return grad;
}

/**
 * Simulate peak decay from 0 dB to floor over wall-clock time (for unit tests).
 * Returns final peak dB after elapsedSec of decay (post hold window).
 */
export function simulatePeakDecay(
  fps: number,
  elapsedSec: number,
  holdMs: number = PEAK_HOLD_MS,
): number {
  const frameDt = 1 / fps;
  let peakDb = 0;
  let holdUntil = holdMs;
  let t = 0;
  while (t < elapsedSec) {
    const dt = capDeltaTime(frameDt);
    const nowMs = t * 1000;
    const levelDb = DB_FLOOR;
    const result = updatePeakHold(peakDb, levelDb, holdUntil, nowMs, dt);
    peakDb = result.peakDb;
    holdUntil = result.holdUntil;
    t += frameDt;
  }
  return peakDb;
}
