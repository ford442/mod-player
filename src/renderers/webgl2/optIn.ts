/**
 * Opt-in state for the WebGL2 pattern renderer (#462 / #436 "Option B").
 *
 * Owner policy: there is **no automatic or silent** WebGPU → WebGL2 fallback.
 * WebGL2 renders only when the user asked for it, via either
 *   - the URL: `?webgl2=1` (canonical; `?renderer=webgl2` is an alias), or
 *   - the "Use WebGL2 visualizer" button on the WebGPU failure card.
 *
 * The opt-in is per page load: nothing here touches localStorage/sessionStorage.
 * The button choice lives at module level (not in component state) because
 * `PerformanceStage` remounts `PatternDisplay` on every shader switch.
 *
 * No imports on purpose — `src/renderers` is madge-checked for cycles.
 */

export type WebGL2OptInSource = 'url' | 'button';

export interface WebGL2OptIn {
  source: WebGL2OptInSource;
  /** Shown in the activation warn + debug panel: `url-optin` or the WebGPU hard-fail status. */
  reason: string;
}

/** Reason reported when the URL opt-in skipped WebGPU entirely (it was never probed). */
export const WEBGL2_URL_OPT_IN_REASON = 'url-optin';

const TRUTHY = new Set(['1', 'true', 'on']);
const FALSY = new Set(['0', 'false', 'off']);

let buttonOptIn: WebGL2OptIn | null = null;
let activationLogged = false;

/**
 * True for `?webgl2=1|true|on`, or the `?renderer=webgl2` alias.
 * An explicit `?webgl2=0|false|off` wins over the alias.
 */
export function parseWebGL2OptInParam(search: string | URLSearchParams): boolean {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const flag = params.get('webgl2')?.trim().toLowerCase();
  if (flag != null) {
    if (TRUTHY.has(flag)) return true;
    if (FALSY.has(flag)) return false;
  }
  return params.get('renderer')?.trim().toLowerCase() === 'webgl2';
}

/** Current opt-in, or null. The URL (read live) wins over a button click. */
export function getWebGL2OptIn(): WebGL2OptIn | null {
  if (typeof window !== 'undefined' && parseWebGL2OptInParam(window.location?.search ?? '')) {
    return { source: 'url', reason: WEBGL2_URL_OPT_IN_REASON };
  }
  return buttonOptIn;
}

/**
 * Record the failure-card button click. Idempotent: the first reason (the
 * original WebGPU hard-fail status) is kept. Callers should follow with
 * `notifyRendererPreferenceChanged()` — see `activateWebGL2FromFailureCard`.
 */
export function requestWebGL2OptIn(reason: string): void {
  if (!buttonOptIn) buttonOptIn = { source: 'button', reason };
}

/**
 * Log the one-and-only activation warning. Guarded at module level so React
 * StrictMode double-effects and PatternDisplay remounts (shader switches)
 * cannot emit it twice in one page load.
 */
export function logWebGL2FallbackActivation(reason: string): void {
  if (activationLogged) return;
  activationLogged = true;
  console.warn(`[Renderer] WebGL2 fallback active — WebGPU not in use (reason: ${reason})`);
}

/** Test helper. */
export function resetWebGL2OptInForTests(): void {
  buttonOptIn = null;
  activationLogged = false;
}
