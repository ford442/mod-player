import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  parseEngineQueryParam,
  resolveAudioEnginePreference,
  shouldPromoteNativeEngine,
  writeStoredAudioEngineOverride,
  readStoredAudioEngineOverride,
  overrideFromActiveEngine,
  AUDIO_ENGINE_STORAGE_KEY,
} from '../utils/audioEngineSelection';

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
  });

  afterEach(() => {
    localStorage.removeItem(AUDIO_ENGINE_STORAGE_KEY);
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

  it('defaults to auto when unset', () => {
    expect(resolveAudioEnginePreference('')).toEqual({ mode: 'auto' });
    expect(readStoredAudioEngineOverride()).toBe('auto');
  });

  it('force-js never promotes native even when glue present', () => {
    expect(shouldPromoteNativeEngine({ mode: 'force-js' }, true)).toBe(false);
  });

  it('auto and prefer-native promote when glue present', () => {
    expect(shouldPromoteNativeEngine({ mode: 'auto' }, true)).toBe(true);
    expect(shouldPromoteNativeEngine({ mode: 'prefer-native' }, true)).toBe(true);
    expect(shouldPromoteNativeEngine({ mode: 'prefer-native' }, false)).toBe(false);
  });

  it('maps active engine to durable override', () => {
    expect(overrideFromActiveEngine('worklet')).toBe('js');
    expect(overrideFromActiveEngine('native-worklet')).toBe('native');
  });
});
