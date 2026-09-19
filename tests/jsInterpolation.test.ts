import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  JS_INTERPOLATION_STORAGE_KEY,
  parseInterpolationLength,
  resolveJsInterpolationLength,
} from '../utils/jsInterpolation';

function stubBrowser(search: string, stored: string | null): void {
  vi.stubGlobal('window', { location: { search } });
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k === JS_INTERPOLATION_STORAGE_KEY ? stored : null),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseInterpolationLength', () => {
  it('accepts only the libopenmpt-meaningful lengths', () => {
    expect(parseInterpolationLength('1')).toBe(1);
    expect(parseInterpolationLength('2')).toBe(2);
    expect(parseInterpolationLength('4')).toBe(4);
    expect(parseInterpolationLength(' 8 ')).toBe(8);
    for (const bad of ['0', '3', '5', '16', 'sinc', '', null, undefined]) {
      expect(parseInterpolationLength(bad as string | null | undefined)).toBeNull();
    }
  });
});

describe('resolveJsInterpolationLength', () => {
  it('defaults to Sinc+LP (8): real wasm makes it affordable', () => {
    stubBrowser('', null);
    expect(resolveJsInterpolationLength()).toBe(8);
  });

  it('?interp=4 opts down to cubic and beats localStorage', () => {
    stubBrowser('?interp=4', '2');
    expect(resolveJsInterpolationLength()).toBe(4);
  });

  it('falls back to localStorage, then ignores junk instead of guessing a nearby filter', () => {
    stubBrowser('', '4');
    expect(resolveJsInterpolationLength()).toBe(4);
    stubBrowser('?interp=7', 'banana');
    expect(resolveJsInterpolationLength()).toBe(8);
  });

  it('survives blocked storage / no window', () => {
    vi.stubGlobal('window', undefined);
    expect(resolveJsInterpolationLength()).toBe(8);
  });
});
