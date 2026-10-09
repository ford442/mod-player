import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getWebGL2OptIn,
  logWebGL2FallbackActivation,
  parseWebGL2OptInParam,
  requestWebGL2OptIn,
  resetWebGL2OptInForTests,
} from '../src/renderers/webgl2/optIn';

function setSearch(search: string): void {
  const loc = (window as { location?: { search?: string } }).location;
  if (loc) loc.search = search;
}

describe('parseWebGL2OptInParam', () => {
  it.each([
    ['?webgl2=1', true],
    ['webgl2=true', true],
    ['?webgl2=ON', true],
    ['?renderer=webgl2', true],
    ['?renderer=WebGL2', true],
    ['?webgl2=0', false],
    ['?webgl2=false', false],
    ['?webgl2=off', false],
    ['?webgl2=0&renderer=webgl2', false],
    ['?webgl2=junk&renderer=webgl2', true],
    ['?webgl2=junk', false],
    ['?webgl2', false],
    ['?renderer=webgpu', false],
    ['?renderer=html', false],
    ['', false],
  ])('%s → %s', (search, expected) => {
    expect(parseWebGL2OptInParam(search)).toBe(expected);
  });

  it('accepts URLSearchParams', () => {
    expect(parseWebGL2OptInParam(new URLSearchParams('webgl2=1'))).toBe(true);
  });
});

describe('WebGL2 opt-in state', () => {
  beforeEach(() => {
    resetWebGL2OptInForTests();
    setSearch('');
  });
  afterEach(() => {
    resetWebGL2OptInForTests();
    setSearch('');
  });

  it('is off by default', () => {
    expect(getWebGL2OptIn()).toBeNull();
  });

  it('the URL wins over a button click', () => {
    requestWebGL2OptIn('no-adapter');
    setSearch('?webgl2=1');
    expect(getWebGL2OptIn()).toEqual({ source: 'url', reason: 'url-optin' });
  });

  it('logs the activation warning exactly once per page load', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logWebGL2FallbackActivation('no-adapter');
    logWebGL2FallbackActivation('no-adapter'); // StrictMode double effect / PatternDisplay remount
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[Renderer] WebGL2 fallback active — WebGPU not in use (reason: no-adapter)',
    );
    warn.mockRestore();
  });
});
