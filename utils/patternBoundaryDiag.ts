/**
 * Opt-in pattern-boundary hitch diagnostics.
 *
 * Worklet quantum timing already lives on `?audioDiag=1` (`window.__AUDIO_DIAG__`).
 * That cannot see the main-thread/GPU work that also fires at order changes
 * (React matrix swap, DURA compute rebuild, native cell-by-cell pattern read).
 *
 * Enable with `?patternDiag=1`, `?audioDiag=1`, or localStorage
 * `xasm1_pattern_diag=1`. Results: `window.__PATTERN_DIAG__`.
 */

import { pcmBusHasSubscribers } from './pcmBus';

export const PATTERN_DIAG_STORAGE_KEY = 'xasm1_pattern_diag';
export const PATTERN_DIAG_MAX_EVENTS = 32;

/** GPU rebuilds longer than this are logged as warnings (one quantum ≈ 2.9 ms). */
export const GPU_MATRIX_WARN_MS = 8;
export const ORDER_CHANGE_UI_WARN_MS = 4;
export const NATIVE_PATTERN_READ_WARN_MS = 8;

export type PatternBoundaryKind = 'order-change-ui' | 'gpu-matrix' | 'native-pattern-read';

export interface PatternBoundaryEvent {
  kind: PatternBoundaryKind;
  ms: number;
  at: number;
  order?: number | undefined;
  row?: number | undefined;
  rows?: number | undefined;
  channels?: number | undefined;
  shader?: string | undefined;
  engine?: string | undefined;
  path?: 'compute' | 'cpu' | undefined;
  packMs?: number | undefined;
  computeMs?: number | undefined;
  liteMode?: boolean | undefined;
  gpuSpectrum?: boolean | undefined;
  pcmSubscribers?: boolean | undefined;
  parityReadback?: boolean | undefined;
}

export interface PatternDiagSnapshot {
  events: PatternBoundaryEvent[];
  lastGpuMatrixMs: number;
  maxGpuMatrixMs: number;
  lastOrderChangeUiMs: number;
  maxOrderChangeUiMs: number;
  lastNativeReadMs: number;
  maxNativeReadMs: number;
  lastPath?: 'compute' | 'cpu';
  lastShader?: string;
  lastEngine?: string;
  pcmSubscribers?: boolean;
  gpuSpectrum?: boolean;
  updatedAt: number;
}

let cachedEnabled: boolean | undefined;

function readEnabled(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('patternDiag') === '1') return true;
    // Same isolation session as worklet wrap timing.
    if (params.get('audioDiag') === '1') return true;
    if (localStorage.getItem(PATTERN_DIAG_STORAGE_KEY) === '1') return true;
    if (localStorage.getItem('xasm1_audio_diag') === '1') return true;
  } catch {
    /* node / restricted storage */
  }
  return false;
}

export function isPatternDiagEnabled(): boolean {
  if (cachedEnabled !== undefined) return cachedEnabled;
  cachedEnabled = readEnabled();
  return cachedEnabled;
}

/** Test-only: drop the URL/storage cache so the next read sees a new search string. */
export function resetPatternDiagCache(): void {
  cachedEnabled = undefined;
}

export function emptyPatternDiagSnapshot(): PatternDiagSnapshot {
  return {
    events: [],
    lastGpuMatrixMs: 0,
    maxGpuMatrixMs: 0,
    lastOrderChangeUiMs: 0,
    maxOrderChangeUiMs: 0,
    lastNativeReadMs: 0,
    maxNativeReadMs: 0,
    updatedAt: 0,
  };
}

export function applyPatternBoundaryEvent(
  prev: PatternDiagSnapshot,
  event: PatternBoundaryEvent,
): PatternDiagSnapshot {
  const events = prev.events.length >= PATTERN_DIAG_MAX_EVENTS
    ? [...prev.events.slice(prev.events.length - (PATTERN_DIAG_MAX_EVENTS - 1)), event]
    : [...prev.events, event];

  const next: PatternDiagSnapshot = {
    ...prev,
    events,
    updatedAt: event.at,
  };

  if (event.kind === 'gpu-matrix') {
    next.lastGpuMatrixMs = event.ms;
    next.maxGpuMatrixMs = Math.max(prev.maxGpuMatrixMs, event.ms);
    if (event.path) next.lastPath = event.path;
    if (event.shader) next.lastShader = event.shader;
  } else if (event.kind === 'order-change-ui') {
    next.lastOrderChangeUiMs = event.ms;
    next.maxOrderChangeUiMs = Math.max(prev.maxOrderChangeUiMs, event.ms);
    if (event.engine) next.lastEngine = event.engine;
  } else {
    next.lastNativeReadMs = event.ms;
    next.maxNativeReadMs = Math.max(prev.maxNativeReadMs, event.ms);
  }

  if (event.pcmSubscribers !== undefined) next.pcmSubscribers = event.pcmSubscribers;
  if (event.gpuSpectrum !== undefined) next.gpuSpectrum = event.gpuSpectrum;
  return next;
}

function warnThreshold(kind: PatternBoundaryKind): number {
  if (kind === 'gpu-matrix') return GPU_MATRIX_WARN_MS;
  if (kind === 'order-change-ui') return ORDER_CHANGE_UI_WARN_MS;
  return NATIVE_PATTERN_READ_WARN_MS;
}

function logEvent(event: PatternBoundaryEvent): void {
  const bits = [`${event.ms.toFixed(2)}ms`, event.kind];
  if (event.order != null) bits.push(`order=${event.order}`);
  if (event.row != null) bits.push(`row=${event.row}`);
  if (event.rows != null && event.channels != null) bits.push(`${event.rows}x${event.channels}`);
  if (event.path) bits.push(event.path);
  if (event.shader) bits.push(event.shader);
  if (event.engine) bits.push(event.engine);
  if (event.packMs != null) bits.push(`pack=${event.packMs.toFixed(2)}ms`);
  if (event.computeMs != null && event.computeMs > 0) bits.push(`dura=${event.computeMs.toFixed(2)}ms`);
  if (event.gpuSpectrum) bits.push('gpuSpectrum');
  if (event.pcmSubscribers) bits.push('pcmOn');
  if (event.parityReadback) bits.push('parityReadback');
  const line = `[PatternDiag] ${bits.join(' ')}`;
  if (event.ms >= warnThreshold(event.kind)) {
    console.warn(line);
  } else {
    console.log(line);
  }
}

/** Ensure `window.__PATTERN_DIAG__` exists as soon as the flag is on. */
export function seedPatternDiag(): void {
  if (!isPatternDiagEnabled()) return;
  try {
    if (!window.__PATTERN_DIAG__) {
      window.__PATTERN_DIAG__ = emptyPatternDiagSnapshot();
      window.__PATTERN_DIAG__.updatedAt = typeof performance !== 'undefined' ? performance.now() : 0;
    }
  } catch {
    /* no window */
  }
}

export function recordPatternBoundaryEvent(event: PatternBoundaryEvent): void {
  if (!isPatternDiagEnabled()) return;
  const at = event.at || (typeof performance !== 'undefined' ? performance.now() : 0);
  const full: PatternBoundaryEvent = { ...event, at };
  try {
    const prev = window.__PATTERN_DIAG__ ?? emptyPatternDiagSnapshot();
    window.__PATTERN_DIAG__ = applyPatternBoundaryEvent(prev, full);
  } catch {
    /* no window */
  }
  logEvent(full);
}

export function livePcmSubscribers(): boolean {
  try {
    return pcmBusHasSubscribers();
  } catch {
    return false;
  }
}
