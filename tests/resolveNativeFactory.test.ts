import { describe, expect, it, afterEach } from 'vitest';
import {
  getNativeWebAssembly,
  resolveCreateOpenMPTModule,
  withNativeWebAssembly,
} from '../audio-worklet/resolveNativeFactory';

const factory = async () => ({}) as never;

describe('resolveCreateOpenMPTModule', () => {
  it('prefers ESM default export', () => {
    expect(resolveCreateOpenMPTModule({ default: factory }, {})).toBe(factory);
  });

  it('accepts named createOpenMPTModule export', () => {
    expect(resolveCreateOpenMPTModule({ createOpenMPTModule: factory }, {})).toBe(factory);
  });

  it('falls back to UMD globalThis.AudioWorkletModule (emcc without EXPORT_ES6)', () => {
    expect(
      resolveCreateOpenMPTModule({}, { AudioWorkletModule: factory }),
    ).toBe(factory);
  });

  it('falls back to globalThis.createOpenMPTModule', () => {
    expect(
      resolveCreateOpenMPTModule(null, { createOpenMPTModule: factory }),
    ).toBe(factory);
  });

  it('returns null when no factory is present', () => {
    expect(resolveCreateOpenMPTModule({}, {})).toBeNull();
  });
});

describe('getNativeWebAssembly / withNativeWebAssembly', () => {
  const g = globalThis as typeof globalThis & { __NATIVE_WEBASSEMBLY__?: typeof WebAssembly };

  afterEach(() => {
    delete g.__NATIVE_WEBASSEMBLY__;
  });

  it('prefers the pre-wasm2js snapshot', () => {
    g.__NATIVE_WEBASSEMBLY__ = WebAssembly;
    expect(getNativeWebAssembly()).toBe(WebAssembly);
  });

  it('installs the snapshot and leaves it in place for wasm workers', async () => {
    const real = WebAssembly;
    g.__NATIVE_WEBASSEMBLY__ = real;
    const stub = { isWasm2js: true, Memory: function Memory() { return {}; } };
    (globalThis as { WebAssembly: unknown }).WebAssembly = stub as unknown as typeof WebAssembly;
    try {
      const seen = await withNativeWebAssembly(async () => globalThis.WebAssembly);
      expect(seen).toBe(real);
      expect(globalThis.WebAssembly).toBe(real);
    } finally {
      (globalThis as { WebAssembly: typeof WebAssembly }).WebAssembly = real;
    }
  });
});
