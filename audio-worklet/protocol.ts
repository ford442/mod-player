/**
 * Typed, validated postMessage contract for the JS AudioWorklet boundary (main-thread side).
 *
 * The messages and their fields are declared once, in workletProtocolConstants.ts (#492). The zod
 * schemas below are generated from that table, as is the worklet's own allocation-free guard
 * (workletProtocolGuard.ts) — tests/workletProtocolParity.test.ts runs every message type through
 * both. Runtime validation rejects malformed or version-skewed messages at the receive boundary
 * instead of destructuring e.data blindly.
 */

import { z } from 'zod';
import {
  LEGACY_LOAD_SPEC,
  MAIN_TO_WORKLET,
  MAIN_TO_WORKLET_SPEC,
  WORKLET_TO_MAIN,
  WORKLET_TO_MAIN_SPEC,
  type FieldSpec,
  type LegacyLoadMessage,
  type MainToWorkletMessage,
  type MainToWorkletType,
  type MessageSpec,
  type WorkletToMainMessage,
  type WorkletToMainType,
} from './workletProtocolConstants';

export { MAIN_TO_WORKLET, WORKLET_TO_MAIN };
export type { MainToWorkletMessage, MainToWorkletType, WorkletToMainMessage, WorkletToMainType };

// ── zod, generated from the table ────────────────────────────────────

function zodForKind(spec: FieldSpec): z.ZodType {
  switch (spec.kind) {
    case 'nonNegInt':
      return z.number().int().nonnegative();
    case 'finite':
      return z.number();
    case 'boolean':
      return z.boolean();
    case 'string':
      return z.string();
    case 'nonEmptyString':
      return z.string().min(1);
    case 'arrayBuffer':
      return z.custom<ArrayBuffer>((v) => v instanceof ArrayBuffer, { message: 'expected ArrayBuffer' });
    case 'modulePayload':
      return z.custom<ArrayBuffer | Uint8Array>((v) => v instanceof ArrayBuffer || v instanceof Uint8Array, {
        message: 'moduleData must be ArrayBuffer or Uint8Array',
      });
    case 'float32Array':
      return z.custom<Float32Array>((v) => v instanceof Float32Array, { message: 'expected Float32Array' });
    case 'sharedArrayBuffer': {
      const { minBytes } = spec;
      return z.custom<SharedArrayBuffer>(
        (v) => typeof SharedArrayBuffer !== 'undefined' && v instanceof SharedArrayBuffer
          && (minBytes === undefined || v.byteLength >= minBytes),
        { message: minBytes === undefined ? 'expected SharedArrayBuffer' : `expected SharedArrayBuffer of at least ${minBytes} bytes` },
      );
    }
    case 'finiteArray': {
      const array = z.array(z.number());
      return spec.maxLength === undefined ? array : array.max(spec.maxLength);
    }
    case 'pcmChannels':
      return z.union([z.literal(1), z.literal(2)]);
    default: {
      const exhaustive: never = spec.kind;
      return exhaustive;
    }
  }
}

function zodMessage(type: string | undefined, spec: MessageSpec): z.ZodObject {
  const shape: Record<string, z.ZodType> = {
    type: type === undefined ? z.undefined().optional() : z.literal(type),
  };
  for (const [name, field] of Object.entries(spec.fields)) {
    const schema = zodForKind(field);
    shape[name] = field.optional ? schema.optional() : schema;
  }
  return spec.passthrough ? z.looseObject(shape) : z.object(shape);
}

function zodUnion(table: { readonly [type: string]: MessageSpec }) {
  const members = Object.entries(table).map(([type, spec]) => zodMessage(type, spec));
  return z.discriminatedUnion('type', members as [z.ZodObject, ...z.ZodObject[]]);
}

// ── Worklet → main (incoming on node.port.onmessage) ─────────────────

export const workletToMainMessageSchema = zodUnion(WORKLET_TO_MAIN_SPEC) as unknown as z.ZodType<WorkletToMainMessage>;

export type WorkletAudioDiagMessage = Extract<WorkletToMainMessage, { type: typeof WORKLET_TO_MAIN.audioDiag }>;
export type WorkletPositionMessage = Extract<WorkletToMainMessage, { type: typeof WORKLET_TO_MAIN.position }>;
export type WorkletOscBufferMessage = Extract<WorkletToMainMessage, { type: typeof WORKLET_TO_MAIN.oscBuffer }>;

export interface WorkletProtocolParseResult<T> {
  ok: true;
  message: T;
}

export interface WorkletProtocolParseError {
  ok: false;
  error: string;
}

export type ParseWorkletToMainResult =
  | WorkletProtocolParseResult<WorkletToMainMessage>
  | WorkletProtocolParseError;

/** Validate an incoming worklet→main postMessage payload. */
export function parseWorkletToMainMessage(data: unknown): ParseWorkletToMainResult {
  if (data == null || typeof data !== 'object') {
    return { ok: false, error: 'message is not an object' };
  }
  const result = workletToMainMessageSchema.safeParse(data);
  if (!result.success) {
    const detail = result.error.issues.map((i) => i.message).join('; ');
    return { ok: false, error: detail || 'invalid worklet→main message shape' };
  }
  return { ok: true, message: result.data };
}

/** Log and return null when validation fails (receive-boundary helper). */
export function parseWorkletToMainMessageOrWarn(
  data: unknown,
  logPrefix = '[WorkletProtocol]',
): WorkletToMainMessage | null {
  const parsed = parseWorkletToMainMessage(data);
  if (!parsed.ok) {
    console.warn(`${logPrefix} Rejected worklet→main message:`, parsed.error, data);
    return null;
  }
  return parsed.message;
}

// ── Main → worklet (outgoing + worklet receive validation) ───────────

export const mainToWorkletMessageSchema = zodUnion(MAIN_TO_WORKLET_SPEC) as unknown as z.ZodType<MainToWorkletMessage>;

/** Legacy no-type load shim used by some callers. */
const legacyLoadMessageSchema = zodMessage(undefined, LEGACY_LOAD_SPEC) as unknown as z.ZodType<LegacyLoadMessage>;

export type ParseMainToWorkletResult =
  | WorkletProtocolParseResult<MainToWorkletMessage>
  | WorkletProtocolParseResult<LegacyLoadMessage>
  | WorkletProtocolParseError;

/** Validate main→worklet postMessage payload (worklet receive boundary). */
export function parseMainToWorkletMessage(data: unknown): ParseMainToWorkletResult {
  if (data == null || typeof data !== 'object') {
    return { ok: false, error: 'message is not an object' };
  }

  // The legacy shim has no `type`; anything with a type is a typed message (as in the worklet guard).
  if ((data as { type?: unknown }).type === undefined) {
    const legacy = legacyLoadMessageSchema.safeParse(data);
    if (legacy.success) return { ok: true, message: legacy.data };
  }

  const typed = mainToWorkletMessageSchema.safeParse(data);
  if (typed.success) {
    return { ok: true, message: typed.data };
  }

  const detail = typed.error.issues.map((i) => i.message).join('; ');
  return { ok: false, error: detail || 'invalid main→worklet message shape' };
}

// ── Typed outbound helpers (main thread) ─────────────────────────────

export function postInitLib(scriptText: string, wasmBytes?: ArrayBuffer): MainToWorkletMessage {
  return wasmBytes
    ? { type: MAIN_TO_WORKLET.initLib, scriptText, wasmBytes }
    : { type: MAIN_TO_WORKLET.initLib, scriptText };
}

export function postLoad(moduleData: ArrayBuffer | Uint8Array): MainToWorkletMessage {
  return { type: MAIN_TO_WORKLET.load, moduleData };
}

export function postPlay(): MainToWorkletMessage {
  return { type: MAIN_TO_WORKLET.play };
}

export function postPause(): MainToWorkletMessage {
  return { type: MAIN_TO_WORKLET.pause };
}

export function postSeek(order: number, row: number, timestamp?: number): MainToWorkletMessage {
  return timestamp != null
    ? { type: MAIN_TO_WORKLET.seek, order, row, timestamp }
    : { type: MAIN_TO_WORKLET.seek, order, row };
}

export function postGetOscBuffer(): MainToWorkletMessage {
  return { type: MAIN_TO_WORKLET.getOscBuffer };
}

export function postSetAudioLite(lite: boolean): MainToWorkletMessage {
  return { type: MAIN_TO_WORKLET.setAudioLite, lite };
}

/** Enable/disable the worklet's projectm-pcm block stream (off unless a consumer exists). */
export function postSetProjectmPcm(enabled: boolean): MainToWorkletMessage {
  return { type: MAIN_TO_WORKLET.setProjectmPcm, enabled };
}

/** Enable/disable per-quantum process() timing diagnostics (?audioDiag=1). */
export function postSetAudioDiag(enabled: boolean): MainToWorkletMessage {
  return { type: MAIN_TO_WORKLET.setAudioDiag, enabled };
}

export function postSetChannelMute(channel: number, muted: boolean): MainToWorkletMessage {
  return { type: MAIN_TO_WORKLET.setChannelMute, channel, muted };
}

export function postSetRenderParam(param: number, value: number): MainToWorkletMessage {
  return { type: MAIN_TO_WORKLET.setRenderParam, param, value };
}

export function postCtlSetText(key: string, value: string): MainToWorkletMessage {
  return { type: MAIN_TO_WORKLET.ctlSetText, key, value };
}

/** Hand a consumed projectm-pcm buffer back to the worklet's allocation pool (transfer its buffer). */
export function postReturnPcmBuffer(buffer: Float32Array<ArrayBuffer>): MainToWorkletMessage {
  return { type: MAIN_TO_WORKLET.returnPcmBuffer, buffer };
}

/** Hand the worklet the shared position/VU ring (audio-worklet/positionRing.ts). */
export function postSetPositionRing(buffer: SharedArrayBuffer): MainToWorkletMessage {
  return { type: MAIN_TO_WORKLET.setPositionRing, buffer };
}

/** Runtime check for oscBuffer handler (replaces unchecked `as SharedArrayBuffer`). */
export function parseOscBufferMessage(data: unknown): WorkletOscBufferMessage | null {
  const parsed = parseWorkletToMainMessage(data);
  if (!parsed.ok || parsed.message.type !== WORKLET_TO_MAIN.oscBuffer) {
    return null;
  }
  return parsed.message;
}
