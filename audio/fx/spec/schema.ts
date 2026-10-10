/**
 * Validation + migration for FX rack state (#453). Built from FX_PARAM_SPECS so
 * the spec table stays the single source of ranges and defaults.
 *
 * `parseFxRackState` never throws: unknown / out-of-range / missing fields fall
 * back to defaults (numbers are clamped), and the module order is repaired to a
 * permutation of FX_MODULE_IDS. Persisted state, presets, MIDI-set values and
 * export snapshots all pass through it.
 */
import { z } from 'zod';
import {
  DEFAULT_FX_ORDER,
  FX_MODULE_IDS,
  type FxModuleId,
  type FxRackState,
} from '../types';
import { FX_PARAM_SPECS, clampToSpec, defaultParams, type ParamSpec } from './paramSpecs';

export const FX_STATE_VERSION = 1;

function paramSchema(spec: ParamSpec): z.ZodType<unknown> {
  switch (spec.kind) {
    case 'number':
      return z
        .number()
        .catch(spec.default)
        .transform((v) => clampToSpec(spec, v));
    case 'bool':
      return z.boolean().catch(spec.default);
    case 'enum': {
      const values = spec.options.map((o) => o.value);
      return z
        .string()
        .catch(spec.default)
        .transform((v) => (values.includes(v) ? v : spec.default));
    }
  }
}

function moduleSchema(id: FxModuleId) {
  const shape: Record<string, z.ZodType<unknown>> = {};
  for (const spec of FX_PARAM_SPECS[id]) shape[spec.key] = paramSchema(spec);
  return z
    .object({
      enabled: z.boolean().catch(false),
      params: z.object(shape).catch(() => defaultParams(id) as unknown as Record<string, unknown>),
    })
    .catch(() => ({ enabled: false, params: defaultParams(id) as unknown as Record<string, unknown> }));
}

function repairOrder(order: unknown): FxModuleId[] {
  const out: FxModuleId[] = [];
  if (Array.isArray(order)) {
    for (const id of order) {
      if ((FX_MODULE_IDS as readonly unknown[]).includes(id) && !out.includes(id as FxModuleId)) {
        out.push(id as FxModuleId);
      }
    }
  }
  for (const id of DEFAULT_FX_ORDER) if (!out.includes(id)) out.push(id);
  return out;
}

const modulesShape = Object.fromEntries(FX_MODULE_IDS.map((id) => [id, moduleSchema(id)])) as {
  [K in FxModuleId]: ReturnType<typeof moduleSchema>;
};

const FxRackStateSchema = z.object({
  version: z.literal(FX_STATE_VERSION).catch(FX_STATE_VERSION),
  enabled: z.boolean().catch(true),
  order: z.unknown().optional().transform(repairOrder),
  modules: z.object(modulesShape).catch(
    () => z.object(modulesShape).parse({}) as z.infer<z.ZodObject<typeof modulesShape>>,
  ),
});

/**
 * Upgrade older shapes to the current version. v1 is the first; this is the
 * hook later versions extend (e.g. `if (raw.version === 1) raw = v1to2(raw)`).
 */
function migrate(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return {};
  return raw;
}

/** Validate anything (persisted JSON, preset, snapshot) into a complete state. Never throws. */
export function parseFxRackState(raw: unknown): FxRackState {
  return FxRackStateSchema.parse(migrate(raw)) as unknown as FxRackState;
}

export function defaultFxRackState(): FxRackState {
  return parseFxRackState({});
}

/** Deep copy through the serialized form (what persistence / export see). */
export function cloneFxRackState(state: FxRackState): FxRackState {
  return parseFxRackState(JSON.parse(JSON.stringify(state)));
}

export function serializeFxRackState(state: FxRackState): string {
  return JSON.stringify(state);
}

/** Structural equality on the canonical (parsed) form. */
export function fxStatesEqual(a: FxRackState, b: FxRackState): boolean {
  return JSON.stringify(parseFxRackState(a)) === JSON.stringify(parseFxRackState(b));
}
