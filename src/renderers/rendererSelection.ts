import type { PatternRendererBackend } from './types';

const STORAGE_KEY = 'xasm1_pattern_renderer';
const WEBGPU_PROBE_CACHE_KEY = 'xasm1_webgpu_adapter_ok';
const VALID_BACKENDS: ReadonlySet<PatternRendererBackend> = new Set(['webgpu', 'webgl2', 'html']);

/**
 * Phase policy: GPU viz requires WebGPU. Automatic WebGPU → WebGL2/HTML
 * shader fallback is disabled. `?renderer=webgl2` is a no-op (stays WebGPU).
 * Explicit `?renderer=html` still selects the DOM pattern grid (tracker UI).
 */
export const WEBGPU_VIZ_REQUIRED = true;

/** Global runtime override — set from devtools or tests: `window.DEBUG_RENDERER = 'webgpu'`. */
declare global {
  interface Window {
    DEBUG_RENDERER?: PatternRendererBackend;
  }
}

let webgpuAdapterProbePromise: Promise<boolean> | null = null;
/** @deprecated Auto WebGL2 fallback removed — kept for test reset / legacy callers. */
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
 * Resolve pattern renderer backend.
 *
 * - Default / `webgpu` → WebGPU (required for GPU viz this phase)
 * - `html` → DOM pattern grid (tracker UI; not a GLSL shader session)
 * - `webgl2` → **no-op**: stays WebGPU (WebGL2 shader path deferred)
 */
export function resolvePatternRenderer(
  preference: PatternRendererBackend | null = readRendererPreference(),
): PatternRendererBackend {
  const want = preference ?? 'webgpu';

  if (want === 'html') return 'html';

  if (want === 'webgl2') {
    console.warn(
      '[Renderer] ?renderer=webgl2 is deferred this phase — GPU viz requires WebGPU '
        + '(WebGL2 shader path will not auto-start). Using webgpu.',
    );
    return 'webgpu';
  }

  return 'webgpu';
}

/** Async resolver — same policy as sync; no adapter-based downgrade to WebGL2. */
export async function resolvePatternRendererAsync(
  preference: PatternRendererBackend | null = readRendererPreference(),
): Promise<PatternRendererBackend> {
  return resolvePatternRenderer(preference);
}

/**
 * @deprecated Auto WebGL2/HTML shader fallback removed. Records a warning only;
 * always returns `webgpu` so callers cannot silently start WebGL2 shaders.
 */
export function applyWebGPUFallback(reason: string): PatternRendererBackend {
  if (!webgpuAutoFallbackApplied) {
    webgpuAutoFallbackApplied = true;
    console.warn(
      `[Renderer] WebGPU unavailable (${reason}); auto WebGL2/HTML shader fallback is disabled — viz hard-fail.`,
    );
  }
  return 'webgpu';
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
  if (backend === 'webgl2') {
    console.warn(
      '[Renderer] WebGL2 shader override deferred — selecting webgpu. Use html for DOM pattern grid only.',
    );
    backend = 'webgpu';
  }
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
