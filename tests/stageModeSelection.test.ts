import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  parseStageQueryParam,
  resolveStageModePreference,
  STAGE_MODE_STORAGE_KEY,
} from '../utils/stageModeSelection';
import { readLocalStorage, writeLocalStorage } from '../utils/localStorageIO';

function installMemoryLocalStorage(): Map<string, string> {
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
  Object.defineProperty(window, 'localStorage', {
    value: memory,
    configurable: true,
    writable: true,
  });
  if (typeof window.dispatchEvent !== 'function') {
    Object.defineProperty(window, 'dispatchEvent', {
      value: () => true,
      configurable: true,
    });
  }
  if (typeof globalThis.StorageEvent !== 'function') {
    (globalThis as unknown as { StorageEvent: new (type: string, init?: { key?: string | null }) => unknown }).StorageEvent =
      class {
        type: string;
        key: string | null;
        constructor(type: string, init?: { key?: string | null }) {
          this.type = type;
          this.key = init?.key ?? null;
        }
      };
  }
  return store;
}

describe('stageModeSelection', () => {
  beforeEach(() => {
    installMemoryLocalStorage();
    window.location.search = '';
  });

  afterEach(() => {
    window.location.search = '';
    localStorage.removeItem(STAGE_MODE_STORAGE_KEY);
  });

  it('parses ?stage=1|0|true|false|on|off', () => {
    expect(parseStageQueryParam('?stage=1')).toBe(true);
    expect(parseStageQueryParam('stage=true')).toBe(true);
    expect(parseStageQueryParam(new URLSearchParams('stage=on'))).toBe(true);
    expect(parseStageQueryParam('?stage=yes')).toBe(true);
    expect(parseStageQueryParam('?stage=0')).toBe(false);
    expect(parseStageQueryParam('?stage=false')).toBe(false);
    expect(parseStageQueryParam('?stage=off')).toBe(false);
    expect(parseStageQueryParam('?stage=no')).toBe(false);
  });

  it('returns null for missing or malformed ?stage=', () => {
    expect(parseStageQueryParam('')).toBeNull();
    expect(parseStageQueryParam('?foo=1')).toBeNull();
    expect(parseStageQueryParam('?stage=banana')).toBeNull();
    expect(parseStageQueryParam(null)).toBeNull();
    expect(parseStageQueryParam(undefined)).toBeNull();
  });

  it('URL overrides localStorage', () => {
    writeLocalStorage(STAGE_MODE_STORAGE_KEY, true);
    expect(resolveStageModePreference('?stage=0')).toBe(false);
    expect(resolveStageModePreference('?stage=1')).toBe(true);
    expect(resolveStageModePreference('?foo=1')).toBe(true);
  });

  it('falls through malformed URL to localStorage then default false', () => {
    expect(resolveStageModePreference('?stage=banana')).toBe(false);
    writeLocalStorage(STAGE_MODE_STORAGE_KEY, true);
    expect(readLocalStorage<boolean>(STAGE_MODE_STORAGE_KEY, false)).toBe(true);
    expect(resolveStageModePreference('?stage=banana')).toBe(true);
    expect(resolveStageModePreference('')).toBe(true);
  });

  it('defaults to false when URL and storage are empty', () => {
    expect(resolveStageModePreference('')).toBe(false);
    expect(readLocalStorage<boolean>(STAGE_MODE_STORAGE_KEY, false)).toBe(false);
  });
});
