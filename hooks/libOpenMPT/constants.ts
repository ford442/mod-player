import { getWorkletUrl, getAbsoluteWorkletUrl, withBase } from '../useWorkletLoader';

/** Default auto-load module (served from public/). */
export const DEFAULT_MODULE_URL = withBase('4-mat_madness.mod');

/** AUDIO-001 FIX COMPLETE: Use centralized worklet URL construction from useWorkletLoader */
export const WORKLET_URL = getWorkletUrl();

// AUDIO-001 FIX COMPLETE: Enhanced logging for diagnostics
console.log('[AudioWorklet] Configuration:', {
  workletUrl: WORKLET_URL,
  absoluteWorkletUrl: getAbsoluteWorkletUrl(),
  viteBaseUrl: import.meta.env.BASE_URL,
  currentPath: window.location.pathname,
  origin: window.location.origin,
  crossOriginIsolated: window.crossOriginIsolated,
  hasSharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
  hardwareConcurrency: navigator.hardwareConcurrency,
});

/** TIMING FIX: Maximum allowed drift before correction (in seconds) */
export const MAX_DRIFT_SECONDS = 0.1;
/** Worklet: prediction already tracks audio clock — only light EMA to hide postMessage jitter */
export const WORKLET_ROW_SMOOTHING = 0.98;
/** ScriptProcessor / direct lib query: near-instant follow */
export const DIRECT_ROW_SMOOTHING = 0.99;
/** How often sync-debug HUD React state may update (ms). */
export const SYNC_DEBUG_UI_INTERVAL_MS = 250;

export function isPlayheadDebugEnabled(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('playheadDebug') === '1') return true;
    return localStorage.getItem('xasm1_playhead_debug') === '1';
  } catch {
    return false;
  }
}
