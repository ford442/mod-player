import type { PatternRendererBackend } from './types';

const STORAGE_KEY = 'xasm1_pattern_renderer';
const WEBGPU_PROBE_CACHE_KEY = 'xasm1_webgpu_adapter_ok';
const VALID_BACKENDS: ReadonlySet<PatternRendererBackend> = new Set(['webgpu', 'webgl2', 'html']);

/** Global runtime override — set from devtools or tests: `window.DEBUG_RENDERER = 'webgl2'`. */
declare global {
  interface Window {
    DEBUG_RENDERER?: PatternRendererBackend;
  }
}

let webgpuAutoFallbackApplied = false;
let webgpuAdapterProbePromise: Promise<boolean> | null = null;

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

function fallbackAfterWebGPU(): PatternRendererBackend {
  return isWebGL2Available() ? 'webgl2' : 'html';
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
 * Resolve the effective backend with automatic fallback:
 * webgpu → webgl2 → html
 *
 * Uses a cached adapter probe for the implicit default path only. Explicit
 * `?renderer=webgpu` (or stored preference) still selects webgpu synchronously
 * so init can run and runtime fallback handles failures.
 */
export function resolvePatternRenderer(
  preference: PatternRendererBackend | null = readRendererPreference(),
): PatternRendererBackend {
  const want = preference ?? 'webgpu';

  if (want === 'html') return 'html';

  if (want === 'webgl2') {
    return isWebGL2Available() ? 'webgl2' : 'html';
  }

  // Default / explicit webgpu
  if (!isWebGPUAvailable()) {
    return fallbackAfterWebGPU();
  }

  if (preference === null) {
    const cachedProbe = readWebGPUProbeCache();
    if (cachedProbe === false) {
      return fallbackAfterWebGPU();
    }
  }

  return 'webgpu';
}

/** Async resolver — probes adapter for implicit default; explicit webgpu skips probe downgrade. */
export async function resolvePatternRendererAsync(
  preference: PatternRendererBackend | null = readRendererPreference(),
): Promise<PatternRendererBackend> {
  const want = preference ?? 'webgpu';

  if (want === 'html') return 'html';

  if (want === 'webgl2') {
    return isWebGL2Available() ? 'webgl2' : 'html';
  }

  if (!isWebGPUAvailable()) {
    return fallbackAfterWebGPU();
  }

  // Explicit webgpu request — attempt init; runtime fallback handles adapter/init failure.
  if (preference !== null) {
    return 'webgpu';
  }

  const adapterOk = await probeWebGPUAdapter();
  if (!adapterOk) {
    return fallbackAfterWebGPU();
  }

  return 'webgpu';
}

/**
 * Runtime fallback when WebGPU init fails after webgpu was selected.
 * Persists the fallback once per session unless the user explicitly picks webgpu again.
 */
export function applyWebGPUFallback(reason: string): PatternRendererBackend {
  const fallback = fallbackAfterWebGPU();
  if (!webgpuAutoFallbackApplied) {
    webgpuAutoFallbackApplied = true;
    console.warn(`[Renderer] WebGPU unavailable (${reason}); falling back to ${fallback}`);
    persistRendererPreference(fallback);
    window.DEBUG_RENDERER = fallback;
    notifyRendererPreferenceChanged();
  }
  return fallback;
}

/** Returns true if the automatic WebGPU → WebGL2/HTML fallback has already run this session. */
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
  window.dispatchEvent(new Event('xasm1-renderer-change'));
}

export function setRendererOverride(backend: PatternRendererBackend): void {
  if (backend === 'webgpu') {
    webgpuAutoFallbackApplied = false;
  }
  window.DEBUG_RENDERER = backend;
  persistRendererPreference(backend);
  notifyRendererPreferenceChanged();
}

/** Test helper — reset session fallback guard. */
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
