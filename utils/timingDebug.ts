/** Opt-in v0.30b timing visualization via `?timingDebug=1` or `localStorage xasm1_v030b_timing_debug=1`. */
export function isV030bTimingDebugEnabled(shaderFile?: string): boolean {
  if (shaderFile && shaderFile !== 'patternv0.30b.wgsl') return false;
  if (typeof window === 'undefined') return false;
  try {
    if (new URLSearchParams(window.location.search).get('timingDebug') === '1') return true;
    if (localStorage.getItem('xasm1_v030b_timing_debug') === '1') return true;
  } catch {
    /* ignore */
  }
  return false;
}
