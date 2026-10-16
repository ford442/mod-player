/** Factory presets for the FX rack (#453). Each is a full, validated FxRackState. */
import type { FxModuleId, FxParamsById, FxRackState } from '../types';
import { defaultFxRackState, parseFxRackState } from './schema';

export interface FxPreset {
  id: string;
  name: string;
  state: FxRackState;
}

type ModulePatch = { [K in FxModuleId]?: { enabled?: boolean; params?: Partial<FxParamsById[K]> } };

function preset(id: string, name: string, patch: ModulePatch): FxPreset {
  const base = defaultFxRackState();
  const modules = { ...base.modules } as Record<FxModuleId, { enabled: boolean; params: object }>;
  for (const [moduleId, p] of Object.entries(patch) as [FxModuleId, { enabled?: boolean; params?: object }][]) {
    modules[moduleId] = {
      enabled: p.enabled ?? false,
      params: { ...modules[moduleId].params, ...(p.params ?? {}) },
    };
  }
  return { id, name, state: parseFxRackState({ ...base, modules }) };
}

export const FX_FACTORY_PRESETS: readonly FxPreset[] = [
  preset('flat', 'Flat (bypass)', {}),
  preset('amiga-a500', 'Amiga 500', {
    character: { enabled: true, params: { ledOn: true, ledModel: 'a500', crushOn: true, crushRate: 28867, crushBits: 8 } },
  }),
  preset('amiga-a1200', 'Amiga 1200', {
    character: { enabled: true, params: { ledOn: true, ledModel: 'a1200' } },
  }),
  preset('tape-glue', 'Tape glue', {
    character: { enabled: true, params: { tapeOn: true, drive: 0.35, bias: 0.12 } },
    comp: { enabled: true, params: { threshold: -20, ratio: 2.5, knee: 8, attack: 0.02, release: 0.3, makeup: 3 } },
  }),
  preset('lofi-crunch', 'Lo-fi crunch', {
    character: { enabled: true, params: { crushOn: true, crushRate: 8000, crushBits: 6, tapeOn: true, drive: 0.5 } },
    eq: { enabled: true, params: { lowGain: 3, highGain: -4 } },
  }),
  preset('small-room', 'Small room', {
    room: { enabled: true, params: { ir: 'small', mix: 0.18, predelay: 8, lowCut: 200 } },
  }),
  preset('club', 'Club', {
    eq: { enabled: true, params: { lowGain: 4, lowFreq: 90, midGain: -1.5, midFreq: 600, highGain: 2.5 } },
    comp: { enabled: true, params: { threshold: -16, ratio: 3, makeup: 4 } },
    room: { enabled: true, params: { ir: 'medium', mix: 0.12 } },
  }),
];

export function getFactoryPreset(id: string): FxPreset | undefined {
  return FX_FACTORY_PRESETS.find((p) => p.id === id);
}
