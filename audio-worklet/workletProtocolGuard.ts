/**
 * Allocation-free validators for the worklet protocol, generated from the field table in
 * workletProtocolConstants.ts (#492). The AudioWorklet uses `validateMainToWorklet` on every incoming
 * message (zod's parse cost and bundle weight don't belong on the audio thread); the main thread's
 * zod schemas come from the same table (protocol.ts), and tests/workletProtocolParity.test.ts checks
 * the two agree on every message type.
 *
 * The success path allocates nothing: each message's field list is compiled once at module load, the
 * check is an indexed loop, and a valid message is returned as-is (no copy, no result object). Only a
 * rejection builds an error string, readable through `protocolError()`.
 *
 * DOM-free and bundled into public/worklets/openmpt-worklet.js.
 */
import {
  LEGACY_LOAD_SPEC,
  MAIN_TO_WORKLET_SPEC,
  WORKLET_TO_MAIN_SPEC,
  type FieldSpec,
  type LegacyLoadMessage,
  type MainToWorkletMessage,
  type MessageSpec,
  type WorkletToMainMessage,
} from './workletProtocolConstants';

interface CompiledField {
  readonly name: string;
  readonly spec: FieldSpec;
}

type CompiledTable = { readonly [type: string]: readonly CompiledField[] };

function compileFields(spec: MessageSpec): readonly CompiledField[] {
  return Object.keys(spec.fields).map((name) => ({ name, spec: spec.fields[name]! }));
}

function compileTable(table: { readonly [type: string]: MessageSpec }): CompiledTable {
  const out: Record<string, readonly CompiledField[]> = {};
  for (const type of Object.keys(table)) out[type] = compileFields(table[type]!);
  return out;
}

const MAIN_TO_WORKLET_FIELDS = compileTable(MAIN_TO_WORKLET_SPEC);
const WORKLET_TO_MAIN_FIELDS = compileTable(WORKLET_TO_MAIN_SPEC);
const LEGACY_LOAD_FIELDS = compileFields(LEGACY_LOAD_SPEC);

const hasOwn = Object.prototype.hasOwnProperty;

let lastError = '';

/** Why the last validation returned null. */
export function protocolError(): string {
  return lastError;
}

function isFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Does `value` satisfy `spec` (absence is handled by the caller)? */
export function fieldValueMatches(spec: FieldSpec, value: unknown): boolean {
  switch (spec.kind) {
    case 'nonNegInt':
      return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
    case 'finite':
      return isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'string':
      return typeof value === 'string';
    case 'nonEmptyString':
      return typeof value === 'string' && value.length > 0;
    case 'arrayBuffer':
      return value instanceof ArrayBuffer;
    case 'modulePayload':
      return value instanceof ArrayBuffer || value instanceof Uint8Array;
    case 'float32Array':
      return value instanceof Float32Array;
    case 'sharedArrayBuffer':
      return typeof SharedArrayBuffer !== 'undefined'
        && value instanceof SharedArrayBuffer
        && (spec.minBytes === undefined || value.byteLength >= spec.minBytes);
    case 'finiteArray': {
      if (!Array.isArray(value)) return false;
      if (spec.maxLength !== undefined && value.length > spec.maxLength) return false;
      for (let i = 0; i < value.length; i++) {
        if (!isFinite(value[i])) return false;
      }
      return true;
    }
    case 'pcmChannels':
      return value === 1 || value === 2;
    default: {
      const exhaustive: never = spec.kind;
      return exhaustive;
    }
  }
}

function checkFields(fields: readonly CompiledField[], data: Record<string, unknown>): boolean {
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]!;
    const value = data[field.name];
    if (value === undefined) {
      if (field.spec.optional) continue;
      lastError = `missing field "${field.name}"`;
      return false;
    }
    if (!fieldValueMatches(field.spec, value)) {
      lastError = `field "${field.name}" is not a valid ${field.spec.kind}`;
      return false;
    }
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validate(table: CompiledTable, data: unknown, direction: string): boolean {
  if (!isRecord(data)) {
    lastError = 'message is not an object';
    return false;
  }
  const type = data.type;
  if (typeof type !== 'string' || !hasOwn.call(table, type)) {
    lastError = `unknown ${direction} message type: ${String(type)}`;
    return false;
  }
  return checkFields(table[type]!, data);
}

/** Validate a main → worklet message (the worklet's receive boundary). Accepts the legacy load shim. */
export function validateMainToWorklet(data: unknown): MainToWorkletMessage | LegacyLoadMessage | null {
  if (isRecord(data) && data.type === undefined) {
    return checkFields(LEGACY_LOAD_FIELDS, data) ? (data as LegacyLoadMessage) : null;
  }
  return validate(MAIN_TO_WORKLET_FIELDS, data, 'main→worklet') ? (data as MainToWorkletMessage) : null;
}

/** Validate a worklet → main message with the same rules zod applies on the main thread. */
export function validateWorkletToMain(data: unknown): WorkletToMainMessage | null {
  return validate(WORKLET_TO_MAIN_FIELDS, data, 'worklet→main') ? (data as WorkletToMainMessage) : null;
}
