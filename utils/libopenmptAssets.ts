/**
 * Pinned libopenmpt main-thread / parser-worker assets (self-hosted under public/libmpt/).
 *
 * Version aligns with vendor/libopenmpt used by scripts/build-wasm.sh (native C++ path).
 * Refresh vendored files: npm run vendor:libmpt
 */

/** libopenmpt release pinned in public/libmpt/ (see public/libmpt/README.md). */
export const LIBOPENMPT_VERSION = '0.8.4';

/** Directory under the site base URL, e.g. /xm-player/libmpt/ */
export const LIBOPENMPT_DIR = 'libmpt';

const DEFAULT_CDN_BASE = 'https://wasm.noahcohn.com/libmpt/';

function normalizeTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

/**
 * Base URL for libopenmpt JS + WASM (trailing slash).
 * Set VITE_LIBOPENMPT_CDN_URL to override with an external CDN (dev / experiments).
 */
export function getLibOpenMPTBaseUrl(): string {
  const override = (import.meta.env.VITE_LIBOPENMPT_CDN_URL ?? '').trim();
  if (override) {
    return normalizeTrailingSlash(override);
  }
  const base = import.meta.env.BASE_URL || '/';
  return normalizeTrailingSlash(`${base}${LIBOPENMPT_DIR}`);
}

export function getLibOpenMPTJsUrl(): string {
  return `${getLibOpenMPTBaseUrl()}libopenmptjs.js`;
}

export function getLibOpenMPTWasmUrl(): string {
  return `${getLibOpenMPTBaseUrl()}libopenmpt.wasm`;
}

/** True when loading from the optional CDN override (SRI not applied). */
export function isLibOpenMPTCdnOverride(): boolean {
  return Boolean((import.meta.env.VITE_LIBOPENMPT_CDN_URL ?? '').trim());
}

/**
 * SRI for pinned self-hosted libopenmptjs.js.
 * Regenerate after `npm run vendor:libmpt`.
 */
export const LIBOPENMPT_JS_INTEGRITY =
  'sha384-ipcKRrZVBcb+7l03Qq3TnQK13PzDQOeBtP+XmwYCyMfN3gCD1iHcCpfua2/9qW2F';

/** SRI for pinned self-hosted libopenmpt.wasm (documentation / future preload). */
export const LIBOPENMPT_WASM_INTEGRITY =
  'sha384-kljxAFeGXestRC2jij7nMY4UGS/t1o7mk5X5tdiUs6e8HglLQGk657rKDzj4TEgM';

/** Default CDN base when refreshing vendored copies (scripts/vendor-libopenmpt.mjs). */
export const LIBOPENMPT_VENDOR_SOURCE_BASE = DEFAULT_CDN_BASE;

/**
 * Emscripten locateFile hook for worker / dynamic eval contexts where
 * document.currentScript is unavailable.
 */
export function createLibOpenMPTLocateFile(): (path: string) => string {
  const base = getLibOpenMPTBaseUrl();
  return (path: string) => new URL(path, base).href;
}
