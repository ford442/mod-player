import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  isNativeParityGateOpen,
  markNativeParityPassed,
  clearNativeParityPassed,
  shouldAutoPreferNative,
  NATIVE_PARITY_STORAGE_KEY,
} from '../utils/nativeParityGate';

function installMemoryLocalStorage(): void {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
    },
    configurable: true,
    writable: true,
  });
}

describe('nativeParityGate', () => {
  beforeEach(() => {
    installMemoryLocalStorage();
    clearNativeParityPassed();
    vi.stubEnv('VITE_NATIVE_PARITY_GATE', '');
  });

  afterEach(() => {
    clearNativeParityPassed();
    vi.unstubAllEnvs();
  });

  it('is closed by default', () => {
    expect(isNativeParityGateOpen()).toBe(false);
    expect(shouldAutoPreferNative(true)).toBe(false);
  });

  it('opens from build env', () => {
    vi.stubEnv('VITE_NATIVE_PARITY_GATE', '1');
    expect(isNativeParityGateOpen()).toBe(true);
    expect(shouldAutoPreferNative(true)).toBe(true);
    expect(shouldAutoPreferNative(false)).toBe(false);
  });

  it('opens from localStorage marker', () => {
    markNativeParityPassed();
    expect(localStorage.getItem(NATIVE_PARITY_STORAGE_KEY)).toBe('1');
    expect(isNativeParityGateOpen()).toBe(true);
  });
});
