/** Rotary knob math (#453). */
import { describe, expect, it } from 'vitest';
import { FX_PARAM_SPECS, normalize, type NumberParamSpec } from '../audio/fx/spec/paramSpecs';
import {
  KNOB_DRAG_PX,
  arcPath,
  dragToNormalized,
  formatParamValue,
  keyToValue,
  normalizedToAngle,
} from '../utils/knobMath';

const spec = (module: keyof typeof FX_PARAM_SPECS, key: string) =>
  FX_PARAM_SPECS[module].find((s) => s.key === key) as NumberParamSpec;

describe('knobMath (#453)', () => {
  it('maps 0…1 onto a 270° sweep from −135°', () => {
    expect(normalizedToAngle(0)).toBe(-135);
    expect(normalizedToAngle(0.5)).toBe(0);
    expect(normalizedToAngle(1)).toBe(135);
    expect(normalizedToAngle(7)).toBe(135);
  });

  it('drags: up raises, a full drag spans the range, Shift is 10× finer', () => {
    expect(dragToNormalized(0.5, -KNOB_DRAG_PX / 2, false)).toBeCloseTo(1, 12);
    expect(dragToNormalized(0.5, KNOB_DRAG_PX, false)).toBe(0);
    expect(dragToNormalized(0.5, -KNOB_DRAG_PX / 2, true)).toBeCloseTo(0.55, 12);
  });

  it('keys step 1 % / 10 % of the range (log specs geometrically), Home/End/Delete jump', () => {
    const freq = spec('eq', 'midFreq');
    const up = keyToValue(freq, 1000, 'ArrowUp', false)!;
    expect(normalize(freq, up) - normalize(freq, 1000)).toBeCloseTo(0.01, 9);
    const page = keyToValue(freq, 1000, 'PageDown', false)!;
    expect(normalize(freq, 1000) - normalize(freq, page)).toBeCloseTo(0.1, 9);
    const fine = keyToValue(freq, 1000, 'ArrowRight', true)!;
    expect(normalize(freq, fine) - normalize(freq, 1000)).toBeCloseTo(0.001, 9);
    expect(keyToValue(freq, 1000, 'Home', false)).toBe(200);
    expect(keyToValue(freq, 1000, 'End', false)).toBe(5000);
    expect(keyToValue(freq, 1234, 'Delete', false)).toBe(1000);
    expect(keyToValue(freq, 1000, 'a', false)).toBeNull();
    expect(keyToValue(freq, 5000, 'ArrowUp', false)).toBeCloseTo(5000, 9); // clamped
  });

  it('formats with units', () => {
    expect(formatParamValue(spec('eq', 'lowGain'), -3)).toBe('−3.0 dB');
    expect(formatParamValue(spec('eq', 'midFreq'), 1250)).toBe('1.25 kHz');
    expect(formatParamValue(spec('eq', 'lowFreq'), 120)).toBe('120 Hz');
    expect(formatParamValue(spec('comp', 'attack'), 0.01)).toBe('10 ms');
    expect(formatParamValue(spec('comp', 'ratio'), 3)).toBe('3.0:1');
    expect(formatParamValue(spec('room', 'mix'), 0.2)).toBe('20 %');
    expect(formatParamValue(spec('character', 'crushBits'), 8)).toBe('8 bits');
  });

  it('draws arcs that start and end on the circle', () => {
    expect(arcPath(10, 10, 10, 0, 90)).toBe('M 10.000 0.000 A 10 10 0 0 1 20.000 10.000');
    expect(arcPath(10, 10, 10, -135, 135)).toContain(' 0 1 1 '); // > 180°: large arc
  });
});
