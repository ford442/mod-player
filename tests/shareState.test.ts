import { describe, expect, it } from 'vitest';
import {
  buildShareSearchParams,
  computeSeekStep,
  parseShareParams,
  paletteModeFromShare,
} from '../utils/shareState';
import { isAllowedModuleHost, sanitizeRemoteUrl } from '../utils/remoteModuleSecurity';

describe('shareState', () => {
  it('parses a full performance share URL', () => {
    const search =
      '?mod=https://storage.noahcohn.com/songs/tune.it' +
      '&shader=patternv0.57' +
      '&row=64&order=3&palette=instrument&lite=0';
    const { state, warnings, hasModuleIntent } = parseShareParams(search);
    expect(hasModuleIntent).toBe(true);
    expect(warnings).toHaveLength(0);
    expect(state.mod).toBe('https://storage.noahcohn.com/songs/tune.it');
    expect(state.shader).toBe('patternv0.57.wgsl');
    expect(state.order).toBe(3);
    expect(state.row).toBe(64);
    expect(state.palette).toBe('instrument');
    expect(state.lite).toBe(0);
    expect(paletteModeFromShare(state.palette)).toBe(1);
  });

  it('warns on unknown shader without throwing', () => {
    const { warnings, state } = parseShareParams('?shader=patternv9.99.wgsl');
    expect(warnings.some((w) => w.includes('Unknown shader'))).toBe(true);
    expect(state.shader).toBeUndefined();
  });

  it('round-trips serialize params', () => {
    const params = buildShareSearchParams({
      mod: 'https://storage.noahcohn.com/songs/tune.it',
      shader: 'patternv0.57.wgsl',
      order: 3,
      row: 64,
      palette: 'instrument',
      lite: 0,
    });
    const { state, warnings } = parseShareParams(`?${params.toString()}`);
    expect(warnings).toHaveLength(0);
    expect(state.shader).toBe('patternv0.57.wgsl');
    expect(state.order).toBe(3);
    expect(state.row).toBe(64);
  });

  it('serializes short codes', () => {
    const params = buildShareSearchParams({ code: 'abc123' });
    expect(params.get('code')).toBe('abc123');
    expect(params.get('mod')).toBeNull();
  });

  it('computes global seek step from order and row', () => {
    expect(computeSeekStep(3, 16, 64)).toBe(3 * 64 + 16);
  });
});

describe('remoteModuleSecurity', () => {
  it('rejects javascript URLs', () => {
    expect(sanitizeRemoteUrl('javascript:alert(1)')).toBeNull();
  });

  it('allows storage.noahcohn.com modules', () => {
    const url = 'https://storage.noahcohn.com/songs/demo.it';
    expect(isAllowedModuleHost(url)).toBe(true);
  });

  it('blocks unknown remote hosts', () => {
    expect(isAllowedModuleHost('https://evil.example.com/tune.mod')).toBe(false);
  });
});
