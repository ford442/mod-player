import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activateWebGL2FromFailureCard,
  applyWebGPUFallback,
  hasWebGPUAutoFallbackApplied,
  readRendererPreference,
  resetWebGPUFallbackStateForTests,
  resolvePatternRenderer,
  resolvePatternRendererAsync,
  setRendererOverride,
  WEBGPU_VIZ_REQUIRED,
} from '../src/renderers/rendererSelection';
import { getWebGL2OptIn, resetWebGL2OptInForTests } from '../src/renderers/webgl2/optIn';

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
    resetWebGL2OptInForTests();
    installMemoryLocalStorage();
    delete (window as { DEBUG_RENDERER?: string }).DEBUG_RENDERER;
    setSearch('');
  });

  afterEach(() => {
    resetWebGPUFallbackStateForTests();
    resetWebGL2OptInForTests();
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

  describe('WebGL2 opt-in (#462 — never automatic, never persisted)', () => {
    it('?webgl2=1 selects webgl2 and reports a url-optin reason', () => {
      setSearch('?webgl2=1');
      expect(resolvePatternRenderer()).toBe('webgl2');
      expect(getWebGL2OptIn()).toEqual({ source: 'url', reason: 'url-optin' });
    });

    it('?renderer=webgl2 is an alias of the same opt-in', () => {
      setSearch('?renderer=webgl2');
      expect(resolvePatternRenderer()).toBe('webgl2');
      expect(getWebGL2OptIn()?.source).toBe('url');
    });

    it('?webgl2=0 stays off (and beats the alias)', () => {
      setSearch('?webgl2=0&renderer=webgl2');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(getWebGL2OptIn()).toBeNull();
      expect(resolvePatternRenderer()).toBe('webgpu');
      warn.mockRestore();
    });

    it('without an opt-in nothing resolves to webgl2', () => {
      expect(getWebGL2OptIn()).toBeNull();
      expect(resolvePatternRenderer()).toBe('webgpu');
      expect(resolvePatternRenderer(null)).toBe('webgpu');
    });

    it('a stored webgl2 preference is ignored (opt-in is per page load)', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      localStorage.setItem('xasm1_pattern_renderer', 'webgl2');
      expect(resolvePatternRenderer()).toBe('webgpu');
      warn.mockRestore();
    });

    it('window.DEBUG_RENDERER = webgl2 is ignored', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      window.DEBUG_RENDERER = 'webgl2';
      expect(resolvePatternRenderer()).toBe('webgpu');
      warn.mockRestore();
    });

    it('the URL opt-in beats a stored html preference', () => {
      localStorage.setItem('xasm1_pattern_renderer', 'html');
      expect(resolvePatternRenderer()).toBe('html');
      setSearch('?webgl2=1');
      expect(resolvePatternRenderer()).toBe('webgl2');
    });

    it('the failure-card button opts in with the WebGPU status, survives re-resolves, and persists nothing', () => {
      expect(resolvePatternRenderer()).toBe('webgpu');
      activateWebGL2FromFailureCard('no-adapter');
      expect(getWebGL2OptIn()).toEqual({ source: 'button', reason: 'no-adapter' });
      // subscribeRendererPreference re-resolves on every storage/renderer-change event
      expect(resolvePatternRenderer()).toBe('webgl2');
      expect(resolvePatternRenderer()).toBe('webgl2');
      expect(localStorage.getItem('xasm1_pattern_renderer')).toBeNull();
      expect(window.DEBUG_RENDERER).toBeUndefined();
    });

    it('a second button click keeps the original reason', () => {
      activateWebGL2FromFailureCard('no-adapter');
      activateWebGL2FromFailureCard('device-failed');
      expect(getWebGL2OptIn()?.reason).toBe('no-adapter');
    });

    it('reset clears the button opt-in', () => {
      activateWebGL2FromFailureCard('unsupported');
      resetWebGL2OptInForTests();
      expect(getWebGL2OptIn()).toBeNull();
      expect(resolvePatternRenderer()).toBe('webgpu');
    });
  });
});
