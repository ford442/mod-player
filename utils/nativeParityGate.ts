/**
 * Native engine A/V parity gate — blocks auto-prefer / deploy promotion until
 * CI or local smoke confirms playhead lag ≤ JS budget.
 *
 * Explicit opt-in (`?engine=native`, localStorage `native`) is never blocked.
 */

/** Dev/local override after `npm run smoke:playhead:native` passes. */
export const NATIVE_PARITY_STORAGE_KEY = 'xasm1_native_parity_passed';

/**
 * True when a verified parity run has passed (build env or localStorage).
 * Set `VITE_NATIVE_PARITY_GATE=1` only in deploy profiles that ran native smoke.
 */
export function isNativeParityGateOpen(): boolean {
  try {
    if (
      typeof import.meta !== 'undefined'
      && import.meta.env
      && import.meta.env.VITE_NATIVE_PARITY_GATE === '1'
    ) {
      return true;
    }
  } catch {
    // non-Vite contexts
  }

  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(NATIVE_PARITY_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Mark parity passed (smoke script / manual sign-off). */
export function markNativeParityPassed(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(NATIVE_PARITY_STORAGE_KEY, '1');
  } catch {
    // quota / private mode
  }
}

/** Clear parity marker (tests / debug). */
export function clearNativeParityPassed(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(NATIVE_PARITY_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Whether init should promote native under `auto` preference when glue exists.
 * Requires parity gate — never flips default without measured lag budget.
 */
export function shouldAutoPreferNative(glueAvailable: boolean): boolean {
  if (!glueAvailable) return false;
  return isNativeParityGateOpen();
}
