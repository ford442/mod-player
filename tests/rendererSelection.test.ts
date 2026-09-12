import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyWebGPUFallback,
  hasWebGPUAutoFallbackApplied,
  readRendererPreference,
  resetWebGPUFallbackStateForTests,
  resolvePatternRenderer,
  resolvePatternRendererAsync,
  setRendererOverride,
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

function stubWebGL2(available: boolean): () => void {
  const original = (globalThis as { document?: unknown }).document;
  Object.defineProperty(globalThis, 'document', {
    value: {
      createElement: () => ({
        getContext: (id: string) => (id === 'webgl2' && available ? {} : null),
      }),
    },
    writable: true,
    configurable: true,
  });
  return () => {
    Object.defineProperty(globalThis, 'document', {
      value: original,
      writable: true,
      configurable: true,
    });
  };
}

describe('rendererSelection', () => {
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

  it('defaults to webgpu', () => {
    expect(resolvePatternRenderer(null)).toBe('webgpu');
  });

  it('allows explicit html (DOM tracker UI, not GLSL)', () => {
    expect(resolvePatternRenderer('html')).toBe('html');
  });

  it('allows explicit webgl2 as a real renderer session', () => {
    expect(resolvePatternRenderer('webgl2')).toBe('webgl2');
  });

  it('does not auto-downgrade the stated preference when navigator.gpu is missing', () => {
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

  it('applyWebGPUFallback switches to webgl2 when available', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const restore = stubWebGL2(true);
    try {
      expect(applyWebGPUFallback('test')).toBe('webgl2');
      expect(hasWebGPUAutoFallbackApplied()).toBe(true);
      expect(applyWebGPUFallback('again')).toBe('webgl2');
    } finally {
      restore();
      warn.mockRestore();
    }
  });

  it('applyWebGPUFallback switches to html when webgl2 is also unavailable', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const restore = stubWebGL2(false);
    try {
      expect(applyWebGPUFallback('test')).toBe('html');
    } finally {
      restore();
      warn.mockRestore();
    }
  });

  it('async resolver mirrors the sync resolver', async () => {
    expect(await resolvePatternRendererAsync(null)).toBe('webgpu');
    expect(await resolvePatternRendererAsync('webgl2')).toBe('webgl2');
    expect(await resolvePatternRendererAsync('html')).toBe('html');
  });

  it('setRendererOverride passes webgl2 through unchanged', () => {
    setRendererOverride('webgl2');
    expect(window.DEBUG_RENDERER).toBe('webgl2');
    expect(readRendererPreference()).toBe('webgl2');
  });

  it('honors ?renderer=html from URL', () => {
    setSearch('?renderer=html');
    expect(readRendererPreference()).toBe('html');
    expect(resolvePatternRenderer()).toBe('html');
  });

  it('honors ?renderer=webgl2 from URL', () => {
    setSearch('?renderer=webgl2');
    expect(readRendererPreference()).toBe('webgl2');
    expect(resolvePatternRenderer()).toBe('webgl2');
  });
});
