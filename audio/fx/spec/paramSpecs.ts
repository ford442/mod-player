/**
 * Parameter specs for the FX rack (#453): ranges, defaults, scales and units.
 * One table drives the schema's clamping, the knobs, and MIDI CC scaling
 * (normalized 0…1 ↔ physical value).
 */
import {
  CHARACTER_PARAM_DESCRIPTORS,
  type CharacterParamName,
} from '../../../audio-worklet/fxCharacterParams';
import type { FxModuleId, FxParamsById } from '../types';

export type ParamScale = 'lin' | 'log';

export interface NumberParamSpec {
  kind: 'number';
  key: string;
  label: string;
  unit: '' | 'dB' | 'Hz' | 'ms' | 's' | 'bits' | ':1' | '%';
  min: number;
  max: number;
  default: number;
  scale: ParamScale;
  /** Keyboard step on a knob, in physical units. */
  step: number;
}

export interface BoolParamSpec {
  kind: 'bool';
  key: string;
  label: string;
  default: boolean;
}

export interface EnumParamSpec<T extends string = string> {
  kind: 'enum';
  key: string;
  label: string;
  options: readonly { value: T; label: string }[];
  default: T;
}

export type ParamSpec = NumberParamSpec | BoolParamSpec | EnumParamSpec;

function num(
  key: string,
  label: string,
  unit: NumberParamSpec['unit'],
  min: number,
  max: number,
  def: number,
  scale: ParamScale,
  step: number,
): NumberParamSpec {
  return { kind: 'number', key, label, unit, min, max, default: def, scale, step };
}

function characterRange(name: CharacterParamName): { min: number; max: number; def: number } {
  const d = CHARACTER_PARAM_DESCRIPTORS.find((x) => x.name === name)!;
  return { min: d.minValue, max: d.maxValue, def: d.defaultValue };
}

const drive = characterRange('drive');
const bias = characterRange('bias');
const crushRate = characterRange('crushRate');
const crushBits = characterRange('crushBits');
const charOut = characterRange('outputGain');

/** Specs per module, in UI order. Character ranges come from the worklet's descriptors. */
export const FX_PARAM_SPECS: { [K in FxModuleId]: readonly ParamSpec[] } = {
  character: [
    { kind: 'bool', key: 'tapeOn', label: 'Tape', default: false },
    num('drive', 'Drive', '', drive.min, drive.max, drive.def, 'lin', 0.01),
    num('bias', 'Bias', '', bias.min, bias.max, bias.def, 'lin', 0.01),
    { kind: 'bool', key: 'ledOn', label: 'LED filter', default: false },
    {
      kind: 'enum',
      key: 'ledModel',
      label: 'Model',
      options: [
        { value: 'a500', label: 'A500' },
        { value: 'a1200', label: 'A1200' },
      ],
      default: 'a500',
    },
    { kind: 'bool', key: 'crushOn', label: 'Crush', default: false },
    num('crushRate', 'Rate', 'Hz', crushRate.min, crushRate.max, crushRate.def, 'log', 100),
    num('crushBits', 'Bits', 'bits', crushBits.min, crushBits.max, crushBits.def, 'lin', 1),
    num('outputGain', 'Output', 'dB', charOut.min, charOut.max, charOut.def, 'lin', 0.5),
  ],
  eq: [
    num('lowGain', 'Low', 'dB', -12, 12, 0, 'lin', 0.5),
    num('lowFreq', 'Low freq', 'Hz', 40, 400, 120, 'log', 5),
    num('midGain', 'Mid', 'dB', -12, 12, 0, 'lin', 0.5),
    num('midFreq', 'Mid freq', 'Hz', 200, 5000, 1000, 'log', 10),
    num('midQ', 'Mid Q', '', 0.3, 4, 0.8, 'log', 0.05),
    num('highGain', 'High', 'dB', -12, 12, 0, 'lin', 0.5),
    num('highFreq', 'High freq', 'Hz', 2000, 12000, 6000, 'log', 50),
    num('outputGain', 'Output', 'dB', -12, 12, 0, 'lin', 0.5),
  ],
  comp: [
    num('threshold', 'Threshold', 'dB', -60, 0, -18, 'lin', 0.5),
    num('ratio', 'Ratio', ':1', 1, 20, 3, 'log', 0.1),
    num('knee', 'Knee', 'dB', 0, 30, 6, 'lin', 0.5),
    num('attack', 'Attack', 's', 0.001, 0.2, 0.01, 'log', 0.001),
    num('release', 'Release', 's', 0.02, 1, 0.25, 'log', 0.01),
    num('makeup', 'Makeup', 'dB', 0, 24, 3, 'lin', 0.5),
  ],
  room: [
    {
      kind: 'enum',
      key: 'ir',
      label: 'Size',
      options: [
        { value: 'small', label: 'Small' },
        { value: 'medium', label: 'Medium' },
        { value: 'large', label: 'Large' },
      ],
      default: 'small',
    },
    num('mix', 'Mix', '%', 0, 1, 0.2, 'lin', 0.01),
    num('predelay', 'Predelay', 'ms', 0, 100, 10, 'lin', 1),
    num('lowCut', 'Low cut', 'Hz', 20, 1000, 150, 'log', 5),
  ],
};

export function getParamSpec(module: FxModuleId, key: string): ParamSpec | undefined {
  return FX_PARAM_SPECS[module].find((s) => s.key === key);
}

export function clampToSpec(spec: NumberParamSpec, value: number): number {
  if (!Number.isFinite(value)) return spec.default;
  return value < spec.min ? spec.min : value > spec.max ? spec.max : value;
}

/** Physical value → 0…1 (log specs map geometrically). */
export function normalize(spec: NumberParamSpec, value: number): number {
  const v = clampToSpec(spec, value);
  if (spec.scale === 'log') {
    return Math.log(v / spec.min) / Math.log(spec.max / spec.min);
  }
  return (v - spec.min) / (spec.max - spec.min);
}

/** 0…1 → physical value. */
export function denormalize(spec: NumberParamSpec, normalized: number): number {
  const n = !Number.isFinite(normalized) ? 0 : normalized < 0 ? 0 : normalized > 1 ? 1 : normalized;
  if (spec.scale === 'log') {
    return spec.min * Math.pow(spec.max / spec.min, n);
  }
  return spec.min + n * (spec.max - spec.min);
}

/** Default params for a module, straight from the spec table. */
export function defaultParams<K extends FxModuleId>(module: K): FxParamsById[K] {
  const out: Record<string, unknown> = {};
  for (const spec of FX_PARAM_SPECS[module]) out[spec.key] = spec.default;
  return out as unknown as FxParamsById[K];
}
