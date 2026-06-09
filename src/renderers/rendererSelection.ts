import type { PatternRendererBackend } from './types';

const STORAGE_KEY = 'xasm1_pattern_renderer';
const VALID_BACKENDS: ReadonlySet<PatternRendererBackend> = new Set(['webgpu', 'webgl2', 'html']);

/** Global runtime override — set from devtools or tests: `window.DEBUG_RENDERER = 'webgl2'`. */
declare global {
  interface Window {
    DEBUG_RENDERER?: PatternRendererBackend;
  }
}

function parseBackend(value: string | null | undefined): PatternRendererBackend | null {
  if (!value) return null;
  const normalized = value.toLowerCase() as PatternRendererBackend;
  return VALID_BACKENDS.has(normalized) ? normalized : null;
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

export function isWebGPUAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

export function isWebGL2Available(): boolean {
  if (typeof document === 'undefined') return false;
  const canvas = document.createElement('canvas');
  return !!canvas.getContext('webgl2');
}

/**
 * Resolve the effective backend with automatic fallback:
 * webgpu → webgl2 → html
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
  if (isWebGPUAvailable()) return 'webgpu';
  if (isWebGL2Available()) return 'webgl2';
  return 'html';
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
  window.DEBUG_RENDERER = backend;
  persistRendererPreference(backend);
  notifyRendererPreferenceChanged();
}
