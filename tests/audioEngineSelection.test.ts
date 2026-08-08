import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  parseEngineQueryParam,
  resolveAudioEnginePreference,
  shouldPromoteNativeEngine,
  writeStoredAudioEngineOverride,
  readStoredAudioEngineOverride,
  overrideFromActiveEngine,
  AUDIO_ENGINE_STORAGE_KEY,
} from '../utils/audioEngineSelection';
import { markNativeParityPassed, clearNativeParityPassed } from '../utils/nativeParityGate';

function installMemoryLocalStorage(): void {
  const store = new Map<string, string>();
  const memory = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    get length() { return store.size; },
    key: (i: number) => [...store.keys()][i] ?? null,
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: memory,
    configurable: true,
    writable: true,
  });
}

describe('audioEngineSelection', () => {
  beforeEach(() => {
    installMemoryLocalStorage();
    localStorage.removeItem(AUDIO_ENGINE_STORAGE_KEY);
    clearNativeParityPassed();
    // Tests run without VITE_PUBLIC_MODE unless a case sets it.
    vi.stubEnv('VITE_PUBLIC_MODE', '');
  });

  afterEach(() => {
    localStorage.removeItem(AUDIO_ENGINE_STORAGE_KEY);
    vi.unstubAllEnvs();
  });

  it('parses ?engine=js|native|auto', () => {
    expect(parseEngineQueryParam('?engine=js')).toBe('js');
    expect(parseEngineQueryParam('engine=native')).toBe('native');
    expect(parseEngineQueryParam(new URLSearchParams('engine=worklet'))).toBe('js');
    expect(parseEngineQueryParam('?engine=bogus')).toBeNull();
  });

  it('URL overrides localStorage', () => {
    writeStoredAudioEngineOverride('native');
    expect(resolveAudioEnginePreference('?engine=js')).toEqual({ mode: 'force-js' });
    expect(resolveAudioEnginePreference('?foo=1')).toEqual({ mode: 'prefer-native' });
  });

  it('defaults to auto (JS active until parity gate)', () => {
    expect(resolveAudioEnginePreference('')).toEqual({ mode: 'auto' });
    expect(readStoredAudioEngineOverride()).toBe('auto');
  });

  it('treats ?engine=auto as auto mode (parity-gated promotion)', () => {
    expect(resolveAudioEnginePreference('?engine=auto')).toEqual({ mode: 'auto' });
    writeStoredAudioEngineOverride('auto');
    expect(resolveAudioEnginePreference('')).toEqual({ mode: 'auto' });
  });

  it('force-js never promotes native even when glue present', () => {
    expect(shouldPromoteNativeEngine({ mode: 'force-js' }, true)).toBe(false);
  });

  it('only prefer-native promotes when glue present', () => {
    expect(shouldPromoteNativeEngine({ mode: 'auto' }, true)).toBe(false);
    expect(shouldPromoteNativeEngine({ mode: 'prefer-native' }, true)).toBe(true);
    expect(shouldPromoteNativeEngine({ mode: 'prefer-native' }, false)).toBe(false);
  });

  it('auto promotes only when parity gate is open', () => {
    expect(shouldPromoteNativeEngine({ mode: 'auto' }, true)).toBe(false);
    markNativeParityPassed();
    expect(shouldPromoteNativeEngine({ mode: 'auto' }, true)).toBe(true);
  });

  it('maps active engine to durable override', () => {
    expect(overrideFromActiveEngine('worklet')).toBe('js');
    expect(overrideFromActiveEngine('native-worklet')).toBe('native');
  });

  it('public mode ignores sticky localStorage native (unless URL opts in)', () => {
    vi.stubEnv('VITE_PUBLIC_MODE', '1');
    writeStoredAudioEngineOverride('native');
    expect(resolveAudioEnginePreference('')).toEqual({ mode: 'force-js' });
    expect(resolveAudioEnginePreference('?engine=native')).toEqual({ mode: 'prefer-native' });
    expect(resolveAudioEnginePreference('?engine=js')).toEqual({ mode: 'force-js' });
  });

  it('writeStoredAudioEngineOverride(js) clears sticky native', () => {
    writeStoredAudioEngineOverride('native');
    expect(localStorage.getItem(AUDIO_ENGINE_STORAGE_KEY)).toBe('native');
    writeStoredAudioEngineOverride('js');
    expect(localStorage.getItem(AUDIO_ENGINE_STORAGE_KEY)).toBe('js');
  });
});
