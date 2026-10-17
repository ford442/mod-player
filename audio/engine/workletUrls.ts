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

/**
 * The full URL for the native C++ AudioWorklet glue (openmpt-native.js), with the same BASE_URL
 * logic as getWorkletUrl().
 */
export const getNativeGlueUrl = (): string => {
  return `${detectRuntimeBase()}worklets/openmpt-native.js`;
};

/**
 * Probe whether openmpt-native.js is Emscripten glue safe to import on the main thread.
 * AudioWorklet processor scripts reference AudioWorkletProcessor and must NOT be import()'d here.
 */
export async function isNativeGlueAvailable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'GET', cache: 'no-cache' });
    if (!response.ok) return false;
    const text = await response.text();
    const hasFactory = text.includes('createOpenMPTModule');
    // Never import() scripts that register an AudioWorkletProcessor on the main thread
    const isWorkletProcessorScript =
      /extends\s+AudioWorkletProcessor/.test(text) ||
      /registerProcessor\s*\(/.test(text);
    if (!hasFactory || isWorkletProcessorScript) return false;

    // Require the Emscripten .wasm sibling — stale/misnamed JS-only uploads must
    // not flip the app into native-worklet mode (breaks playback on xm-player).
    const wasmUrl = url.replace(/\.js(?:\?.*)?$/, '.wasm');
    const wasmHead = await fetch(wasmUrl, { method: 'HEAD', cache: 'no-cache' });
    return wasmHead.ok;
  } catch {
    return false;
  }
}

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
