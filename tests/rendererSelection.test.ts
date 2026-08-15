import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyWebGPUFallback,
  hasWebGPUAutoFallbackApplied,
  readRendererPreference,
  resetWebGPUFallbackStateForTests,
  resolvePatternRenderer,
  resolvePatternRendererAsync,
  setRendererOverride,
  WEBGPU_VIZ_REQUIRED,
} from '../src/renderers/rendererSelection';

function setSearch(search: string): void {
  const loc = (window as { location?: { search?: string; href?: string } }).location;
  if (loc) {
    loc.search = search.startsWith('?') || search === '' ? search : `?${search}`;
  }
}

function installMemoryLocalStorage(): void {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => { store.clear(); },
    },
    configurable: true,
  });
}

describe('rendererSelection (WebGPU viz required)', () => {
  beforeEach(() => {
    resetWebGPUFallbackStateForTests();
    installMemoryLocalStorage();
    delete (window as { DEBUG_RENDERER?: string }).DEBUG_RENDERER;
    setSearch('');
  });

  afterEach(() => {
    resetWebGPUFallbackStateForTests();
    delete (window as { DEBUG_RENDERER?: string }).DEBUG_RENDERER;
    setSearch('');
  });

  it('requires WebGPU for GPU viz this phase', () => {
    expect(WEBGPU_VIZ_REQUIRED).toBe(true);
  });

  it('defaults to webgpu', () => {
    expect(resolvePatternRenderer(null)).toBe('webgpu');
  });

  it('allows explicit html (DOM tracker UI, not GLSL)', () => {
    expect(resolvePatternRenderer('html')).toBe('html');
  });

  it('treats webgl2 preference as no-op → webgpu (no auto shader fallback)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolvePatternRenderer('webgl2')).toBe('webgpu');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not auto-downgrade when navigator.gpu is missing', () => {
    const desc = Object.getOwnPropertyDescriptor(navigator, 'gpu');
    Object.defineProperty(navigator, 'gpu', { configurable: true, value: undefined });
    try {
      expect(resolvePatternRenderer(null)).toBe('webgpu');
    } finally {
      if (desc) Object.defineProperty(navigator, 'gpu', desc);
      else {
        try {
          delete (navigator as { gpu?: unknown }).gpu;
        } catch {
          /* ignore */
        }
      }
    }
  });

  it('applyWebGPUFallback does not switch to webgl2/html', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(applyWebGPUFallback('test')).toBe('webgpu');
    expect(hasWebGPUAutoFallbackApplied()).toBe(true);
    expect(applyWebGPUFallback('again')).toBe('webgpu');
    warn.mockRestore();
  });

  it('async resolver never returns webgl2', async () => {
    expect(await resolvePatternRendererAsync(null)).toBe('webgpu');
    expect(await resolvePatternRendererAsync('webgl2')).toBe('webgpu');
    expect(await resolvePatternRendererAsync('html')).toBe('html');
  });

  it('setRendererOverride maps webgl2 → webgpu', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setRendererOverride('webgl2');
    expect(window.DEBUG_RENDERER).toBe('webgpu');
    expect(readRendererPreference()).toBe('webgpu');
    warn.mockRestore();
  });

  it('honors ?renderer=html from URL', () => {
    setSearch('?renderer=html');
    expect(readRendererPreference()).toBe('html');
    expect(resolvePatternRenderer()).toBe('html');
  });

  it('?renderer=webgl2 resolves to webgpu', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setSearch('?renderer=webgl2');
    expect(resolvePatternRenderer()).toBe('webgpu');
    warn.mockRestore();
  });
});
