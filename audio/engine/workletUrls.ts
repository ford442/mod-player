/**
 * AudioWorklet asset URLs and pre-flight probes (#492: moved out of the old `hooks/useWorkletLoader.ts`,
 * whose retrying `loadWorklet` hook had no caller, so the engine core has no React dependency).
 */
import { detectRuntimeBase, withBase } from '../../src/lib/paths';
import workletVersionData from '../../audio-worklet/js/worklet-version.generated.json';
import { createLogger } from '../../utils/log';

const log = createLogger('WorkletLoader');

export { withBase };

/**
 * The JS worklet URL with proper base path handling for Vite deployments (BASE_URL, subdirectory
 * hosting).
 *
 * Cache-busting: AudioWorklet modules are cached extremely aggressively by browsers. A version
 * query parameter forces a fresh load after deploys.
 */
export const getWorkletUrl = (): string => {
  const base = detectRuntimeBase();
  // Cache-bust with a content hash of the compiled processor (written by
  // scripts/build-js-worklet.mjs to worklet-version.generated.json) instead
  // of a hand-maintained version counter — it changes exactly when the
  // generated openmpt-worklet.js changes, no manual bump required.
  const WORKLET_VERSION = workletVersionData.version;
  return `${base}worklets/openmpt-worklet.js?v=${WORKLET_VERSION}`;
};

/** Absolute URL for the worklet (useful for cross-origin scenarios). */
export const getAbsoluteWorkletUrl = (): string => {
  return new URL(getWorkletUrl(), window.location.href).toString();
};

/** The AudioWorklet API exists in this browser. */
export const isAudioWorkletSupported = (): boolean => {
  return typeof window !== 'undefined' &&
         'AudioContext' in window &&
         'audioWorklet' in AudioContext.prototype;
};

/** Pre-flight: the compiled worklet answers a HEAD request (a missing deploy fails fast, with a reason). */
export async function verifyWorkletFile(): Promise<boolean> {
  const workletUrl = getWorkletUrl();
  try {
    log.log('Verifying worklet file accessibility...');
    const response = await fetch(workletUrl, { method: 'HEAD' });
    if (response.ok) {
      log.log('✅ Worklet file is accessible');
      return true;
    }
    log.error(`❌ Worklet file returned status ${response.status}`);
    return false;
  } catch (error) {
    log.error('❌ Failed to verify worklet file:', error);
    return false;
  }
}
