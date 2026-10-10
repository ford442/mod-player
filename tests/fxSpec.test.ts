/** FX rack state contract (#453): specs, schema repair/clamping, presets. */
import { describe, expect, it } from 'vitest';
import { CHARACTER_PARAM_DESCRIPTORS } from '../audio-worklet/fxCharacterParams';
import {
  FX_PARAM_SPECS,
  clampToSpec,
  defaultParams,
  denormalize,
  normalize,
  type NumberParamSpec,
} from '../audio/fx/spec/paramSpecs';
import { FX_FACTORY_PRESETS, getFactoryPreset } from '../audio/fx/spec/presets';
import {
  cloneFxRackState,
  defaultFxRackState,
  fxStatesEqual,
  parseFxRackState,
} from '../audio/fx/spec/schema';
import { DEFAULT_FX_ORDER, FX_MODULE_IDS, anyModuleActive, isModuleActive } from '../audio/fx/types';

const numberSpecs = FX_MODULE_IDS.flatMap((id) =>
  FX_PARAM_SPECS[id].filter((s): s is NumberParamSpec => s.kind === 'number').map((s) => [id, s] as const),
);

describe('param specs', () => {
  it('defaults sit inside their ranges, and log scales have positive ranges', () => {
    for (const [, spec] of numberSpecs) {
      expect(spec.default).toBeGreaterThanOrEqual(spec.min);
      expect(spec.default).toBeLessThanOrEqual(spec.max);
      if (spec.scale === 'log') expect(spec.min).toBeGreaterThan(0);
    }
  });

  it('character ranges come straight from the worklet descriptors', () => {
    for (const spec of FX_PARAM_SPECS.character) {
      if (spec.kind !== 'number') continue;
      const d = CHARACTER_PARAM_DESCRIPTORS.find((x) => x.name === spec.key)!;
      expect([spec.min, spec.max, spec.default]).toEqual([d.minValue, d.maxValue, d.defaultValue]);
    }
  });

  it('normalize / denormalize round-trip on linear and log scales', () => {
    for (const [, spec] of numberSpecs) {
      for (const n of [0, 0.25, 0.5, 1]) {
        expect(normalize(spec, denormalize(spec, n))).toBeCloseTo(n, 9);
      }
      expect(denormalize(spec, 0)).toBeCloseTo(spec.min, 9);
      expect(denormalize(spec, 1)).toBeCloseTo(spec.max, 9);
      expect(denormalize(spec, 2)).toBeCloseTo(spec.max, 9);
      expect(denormalize(spec, Number.NaN)).toBeCloseTo(spec.min, 9);
    }
    const freq = FX_PARAM_SPECS.eq.find((s) => s.key === 'midFreq') as NumberParamSpec;
    expect(denormalize(freq, 0.5)).toBeCloseTo(Math.sqrt(200 * 5000), 6); // geometric midpoint
  });

  it('clamps and rejects non-finite values', () => {
    const [, spec] = numberSpecs[0]!;
    expect(clampToSpec(spec, spec.max + 100)).toBe(spec.max);
    expect(clampToSpec(spec, Number.POSITIVE_INFINITY)).toBe(spec.default);
  });
});

describe('FxRackState schema', () => {
  it('fills a complete default state from nothing', () => {
    const state = parseFxRackState(undefined);
    expect(state.version).toBe(1);
    expect(state.enabled).toBe(true);
    expect(state.order).toEqual([...DEFAULT_FX_ORDER]);
    for (const id of FX_MODULE_IDS) {
      expect(state.modules[id]).toEqual({ enabled: false, params: defaultParams(id) });
    }
    expect(anyModuleActive(state)).toBe(false);
  });

  it('repairs, clamps and defaults bad input without throwing', () => {
    const state = parseFxRackState({
      version: 99,
      enabled: 'yes',
      order: ['room', 'room', 'bogus', 'eq'],
      modules: {
        eq: { enabled: true, params: { lowGain: 40, midQ: 'loud', highFreq: null } },
        character: { enabled: true, params: { ledModel: 'a3000', crushBits: 1 } },
        comp: 'nope',
      },
    });
    expect(state.version).toBe(1);
    expect(state.enabled).toBe(true);
    expect(state.order).toEqual(['room', 'eq', 'character', 'comp']);
    expect(state.modules.eq.params.lowGain).toBe(12);
    expect(state.modules.eq.params.midQ).toBe(0.8);
    expect(state.modules.eq.params.highFreq).toBe(6000);
    expect(state.modules.character.params.ledModel).toBe('a500');
    expect(state.modules.character.params.crushBits).toBe(2);
    expect(state.modules.comp).toEqual({ enabled: false, params: defaultParams('comp') });
    expect(isModuleActive(state, 'eq')).toBe(true);
    expect(isModuleActive({ ...state, enabled: false }, 'eq')).toBe(false);
  });

  it('clones through the serialized form and compares structurally', () => {
    const a = defaultFxRackState();
    a.modules.eq.enabled = true;
    const b = cloneFxRackState(a);
    expect(b).not.toBe(a);
    expect(fxStatesEqual(a, b)).toBe(true);
    b.modules.eq.params.lowGain = 3;
    expect(fxStatesEqual(a, b)).toBe(false);
  });
});

describe('factory presets', () => {
  it('are valid states with unique ids, and `flat` bypasses everything', () => {
    expect(new Set(FX_FACTORY_PRESETS.map((p) => p.id)).size).toBe(FX_FACTORY_PRESETS.length);
    for (const preset of FX_FACTORY_PRESETS) {
      expect(parseFxRackState(preset.state)).toEqual(preset.state);
    }
    expect(anyModuleActive(getFactoryPreset('flat')!.state)).toBe(false);
    expect(isModuleActive(getFactoryPreset('amiga-a500')!.state, 'character')).toBe(true);
  });
});
