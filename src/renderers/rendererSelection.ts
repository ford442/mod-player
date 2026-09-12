import type { PatternRendererBackend } from './types';

const STORAGE_KEY = 'xasm1_pattern_renderer';
const WEBGPU_PROBE_CACHE_KEY = 'xasm1_webgpu_adapter_ok';
const VALID_BACKENDS: ReadonlySet<PatternRendererBackend> = new Set(['webgpu', 'webgl2', 'html']);

/** Global runtime override — set from devtools or tests: `window.DEBUG_RENDERER = 'webgpu'`. */
declare global {
  interface Window {
    DEBUG_RENDERER?: PatternRendererBackend;
  }
}

let webgpuAdapterProbePromise: Promise<boolean> | null = null;
let webgpuAutoFallbackApplied = false;

function parseBackend(value: string | null | undefined): PatternRendererBackend | null {
  if (!value) return null;
  const normalized = value.toLowerCase() as PatternRendererBackend;
  return VALID_BACKENDS.has(normalized) ? normalized : null;
}

function readWebGPUProbeCache(): boolean | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const cached = sessionStorage.getItem(WEBGPU_PROBE_CACHE_KEY);
    if (cached === '1') return true;
    if (cached === '0') return false;
  } catch {
    /* private browsing / blocked storage */
  }
  return null;
}

function writeWebGPUProbeCache(ok: boolean): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(WEBGPU_PROBE_CACHE_KEY, ok ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/** Read preferred backend from URL `?renderer=`, localStorage, or `window.DEBUG_RENDERER`. */
export function readRendererPreference(): PatternRendererBackend | null {
  if (typeof window === 'undefined') return null;

  const fromGlobal = parseBackend(window.DEBUG_RENDERER);
  if (fromGlobal) return fromGlobal;

  const urlParam = parseBackend(new URLSearchParams(window.location.search).get('renderer'));
  if (urlParam) return urlParam;

  try {
    return parseBackend(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Persist renderer choice (survives reload; hot-reload picks it up on next HMR cycle). */
export function persistRendererPreference(backend: PatternRendererBackend): void {
  try {
    localStorage.setItem(STORAGE_KEY, backend);
  } catch {
    // private browsing / quota — ignore
  }
}

export function clearRendererPreference(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Fast sync check — API surface only; does not guarantee a usable adapter. */
export function isWebGPUAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

export function isWebGL2Available(): boolean {
  if (typeof document === 'undefined') return false;
  const canvas = document.createElement('canvas');
  return !!canvas.getContext('webgl2');
}

/**
 * Real WebGPU adapter probe (cached per session). Returns false when the API exists
 * but `requestAdapter()` yields null or throws.
 */
export async function probeWebGPUAdapter(): Promise<boolean> {
  if (!isWebGPUAvailable()) {
    writeWebGPUProbeCache(false);
    return false;
  }

  const cached = readWebGPUProbeCache();
  if (cached !== null) return cached;

  if (!webgpuAdapterProbePromise) {
    webgpuAdapterProbePromise = (async () => {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        const ok = adapter != null;
        writeWebGPUProbeCache(ok);
        return ok;
      } catch {
        writeWebGPUProbeCache(false);
        return false;
      } finally {
        webgpuAdapterProbePromise = null;
      }
    })();
  }

  return webgpuAdapterProbePromise;
}

/**
 * Resolve pattern renderer backend from a stated preference.
 *
 * - `html` → DOM pattern grid (tracker UI; not a GLSL shader session)
 * - `webgl2` → WebGL2 GLSL reference renderer (real session)
 * - `webgpu`, or no preference → WebGPU (primary production visuals)
 *
 * This only reflects the *stated* preference. Runtime WebGPU probe/device
 * failure is handled separately by `applyWebGPUFallback`, invoked once
 * `requestWebGPUDevice` actually fails (see `usePatternRendererBackend`).
 */
export function resolvePatternRenderer(
  preference: PatternRendererBackend | null = readRendererPreference(),
): PatternRendererBackend {
  const want = preference ?? 'webgpu';

  if (want === 'html') return 'html';
  if (want === 'webgl2') return 'webgl2';

  return 'webgpu';
}

/** Async resolver — same policy as sync; kept for callers awaiting a promise. */
export async function resolvePatternRendererAsync(
  preference: PatternRendererBackend | null = readRendererPreference(),
): Promise<PatternRendererBackend> {
  return resolvePatternRenderer(preference);
}

/**
 * Called once WebGPU probe/device creation actually fails at runtime.
 * Downgrades to the WebGL2 GLSL reference renderer when available, otherwise
 * the DOM pattern grid — never leaves the caller stuck on a dead WebGPU canvas.
 */
export function applyWebGPUFallback(reason: string): PatternRendererBackend {
  const fallback = isWebGL2Available() ? 'webgl2' : 'html';
  if (!webgpuAutoFallbackApplied) {
    webgpuAutoFallbackApplied = true;
    console.warn(`[Renderer] WebGPU unavailable (${reason}); falling back to ${fallback}.`);
  }
  return fallback;
}

/** Returns true if applyWebGPUFallback has been invoked this session. */
export function hasWebGPUAutoFallbackApplied(): boolean {
  return webgpuAutoFallbackApplied;
}

/** Subscribe to renderer preference changes (storage events + custom events). */
export function subscribeRendererPreference(
  onChange: (backend: PatternRendererBackend) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};

  const handler = () => onChange(resolvePatternRenderer());

  window.addEventListener('storage', handler);
  window.addEventListener('xasm1-renderer-change', handler);

  return () => {
    window.removeEventListener('storage', handler);
    window.removeEventListener('xasm1-renderer-change', handler);
  };
}

export function notifyRendererPreferenceChanged(): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new Event('xasm1-renderer-change'));
}

export function setRendererOverride(backend: PatternRendererBackend): void {
  window.DEBUG_RENDERER = backend;
  persistRendererPreference(backend);
  notifyRendererPreferenceChanged();
}

/** Test helper — reset session probe cache / legacy fallback guard. */
export function resetWebGPUFallbackStateForTests(): void {
  webgpuAutoFallbackApplied = false;
  webgpuAdapterProbePromise = null;
  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.removeItem(WEBGPU_PROBE_CACHE_KEY);
    } catch {
      /* ignore */
    }
  }
}
