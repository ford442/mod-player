/**
 * Typed, validated postMessage contract for the JS AudioWorklet boundary.
 *
 * Both directions share message-type constants from workletProtocolConstants.ts.
 * Runtime validation rejects malformed or version-skewed messages at the
 * receive boundary instead of destructuring e.data blindly.
 */

import { z } from 'zod';
import { AUDIO_SAB_BYTES } from '../utils/audioReactive';
import {
  MAIN_TO_WORKLET,
  WORKLET_TO_MAIN,
  type MainToWorkletType,
  type WorkletToMainType,
} from './workletProtocolConstants';

export { MAIN_TO_WORKLET, WORKLET_TO_MAIN };
export type { MainToWorkletType, WorkletToMainType };

// ── Shared helpers ───────────────────────────────────────────────────

const finiteNumber = z.number().finite();
const nonNegInt = z.number().int().nonnegative();

function isSharedArrayBuffer(value: unknown): value is SharedArrayBuffer {
  return typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer;
}

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return value instanceof ArrayBuffer;
}

function isModulePayload(value: unknown): value is ArrayBuffer | Uint8Array {
  return isArrayBuffer(value) || value instanceof Uint8Array;
}

const moduleDataSchema = z.custom<ArrayBuffer | Uint8Array>(isModulePayload, {
  message: 'moduleData must be ArrayBuffer or Uint8Array',
});

const channelVUSchema = z.array(finiteNumber).max(32);

// ── Worklet → main (incoming on node.port.onmessage) ─────────────────

const positionMessageSchema = z.object({
  type: z.literal(WORKLET_TO_MAIN.position),
  order: nonNegInt,
  row: nonNegInt,
  rowFraction: finiteNumber.optional(),
  positionSeconds: finiteNumber,
  bpm: finiteNumber,
  speed: finiteNumber.optional(),
  audioTime: finiteNumber.optional(),
  workletTime: finiteNumber.optional(),
  samplesWritten: nonNegInt.optional(),
  sampleRate: finiteNumber.optional(),
  channelVU: channelVUSchema.optional(),
});

const loadedMessageSchema = z.object({
  type: z.literal(WORKLET_TO_MAIN.loaded),
});

const endedMessageSchema = z.object({
  type: z.literal(WORKLET_TO_MAIN.ended),
});

const seekAckMessageSchema = z.object({
  type: z.literal(WORKLET_TO_MAIN.seekAck),
});

const errorMessageSchema = z.object({
  type: z.literal(WORKLET_TO_MAIN.error),
  message: z.string(),
});

const oscBufferMessageSchema = z.object({
  type: z.literal(WORKLET_TO_MAIN.oscBuffer),
  buffer: z.custom<SharedArrayBuffer>(isSharedArrayBuffer, {
    message: 'buffer must be SharedArrayBuffer',
  }).refine((buf) => buf.byteLength >= AUDIO_SAB_BYTES, {
    message: `buffer must be at least ${AUDIO_SAB_BYTES} bytes`,
  }),
});

const needDataMessageSchema = z.object({
  type: z.literal(WORKLET_TO_MAIN.needData),
}).passthrough();

const starvationMessageSchema = z.object({
  type: z.literal(WORKLET_TO_MAIN.starvation),
}).passthrough();

const projectmPcmMessageSchema = z.object({
  type: z.literal(WORKLET_TO_MAIN.projectmPcm),
  buffer: z.instanceof(Float32Array),
  channels: z.union([z.literal(1), z.literal(2)]),
  sampleRate: finiteNumber.optional(),
  samplesPerChannel: nonNegInt.optional(),
});

const audioDiagMessageSchema = z.object({
  type: z.literal(WORKLET_TO_MAIN.audioDiag),
  budgetMs: finiteNumber,
  quanta: nonNegInt,
  avgProcessMs: finiteNumber,
  maxProcessMs: finiteNumber,
  overruns: nonNegInt,
  wraps: nonNegInt,
  wrapMaxProcessMs: finiteNumber,
  wrapOverruns: nonNegInt,
  order: nonNegInt,
  row: nonNegInt,
  audioTime: finiteNumber.optional(),
});

export const workletToMainMessageSchema = z.discriminatedUnion('type', [
  positionMessageSchema,
  loadedMessageSchema,
  endedMessageSchema,
  seekAckMessageSchema,
  errorMessageSchema,
  oscBufferMessageSchema,
  needDataMessageSchema,
  starvationMessageSchema,
  projectmPcmMessageSchema,
  audioDiagMessageSchema,
]);

export type WorkletAudioDiagMessage = z.infer<typeof audioDiagMessageSchema>;

export type WorkletToMainMessage = z.infer<typeof workletToMainMessageSchema>;
export type WorkletPositionMessage = z.infer<typeof positionMessageSchema>;
export type WorkletOscBufferMessage = z.infer<typeof oscBufferMessageSchema>;

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

const initLibMessageSchema = z.object({
  type: z.literal(MAIN_TO_WORKLET.initLib),
  scriptText: z.string().min(1),
  wasmBytes: z.custom<ArrayBuffer>(isArrayBuffer).optional(),
});

const loadMessageSchema = z.object({
  type: z.literal(MAIN_TO_WORKLET.load),
  moduleData: moduleDataSchema,
});

const playMessageSchema = z.object({
  type: z.literal(MAIN_TO_WORKLET.play),
});

const pauseMessageSchema = z.object({
  type: z.literal(MAIN_TO_WORKLET.pause),
});

const seekMessageSchema = z.object({
  type: z.literal(MAIN_TO_WORKLET.seek),
  order: nonNegInt,
  row: nonNegInt,
  timestamp: finiteNumber.optional(),
});

const getOscBufferMessageSchema = z.object({
  type: z.literal(MAIN_TO_WORKLET.getOscBuffer),
});

const setAudioLiteMessageSchema = z.object({
  type: z.literal(MAIN_TO_WORKLET.setAudioLite),
  lite: z.boolean(),
});

const setProjectmPcmMessageSchema = z.object({
  type: z.literal(MAIN_TO_WORKLET.setProjectmPcm),
  enabled: z.boolean(),
});

const setAudioDiagMessageSchema = z.object({
  type: z.literal(MAIN_TO_WORKLET.setAudioDiag),
  enabled: z.boolean(),
});

/** Legacy no-type load shim used by some callers. */
const legacyLoadMessageSchema = z.object({
  type: z.undefined().optional(),
  moduleData: moduleDataSchema,
}).refine((v) => v.moduleData != null, { message: 'moduleData required' });

export const mainToWorkletMessageSchema = z.discriminatedUnion('type', [
  initLibMessageSchema,
  loadMessageSchema,
  playMessageSchema,
  pauseMessageSchema,
  seekMessageSchema,
  getOscBufferMessageSchema,
  setAudioLiteMessageSchema,
  setProjectmPcmMessageSchema,
  setAudioDiagMessageSchema,
]);

export type MainToWorkletMessage = z.infer<typeof mainToWorkletMessageSchema>;

export type ParseMainToWorkletResult =
  | WorkletProtocolParseResult<MainToWorkletMessage>
  | WorkletProtocolParseResult<z.infer<typeof legacyLoadMessageSchema>>
  | WorkletProtocolParseError;

/** Validate main→worklet postMessage payload (worklet receive boundary). */
export function parseMainToWorkletMessage(data: unknown): ParseMainToWorkletResult {
  if (data == null || typeof data !== 'object') {
    return { ok: false, error: 'message is not an object' };
  }

  const typed = mainToWorkletMessageSchema.safeParse(data);
  if (typed.success) {
    return { ok: true, message: typed.data };
  }

  const legacy = legacyLoadMessageSchema.safeParse(data);
  if (legacy.success) {
    return { ok: true, message: legacy.data };
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

/** Runtime check for oscBuffer handler (replaces unchecked `as SharedArrayBuffer`). */
export function parseOscBufferMessage(data: unknown): WorkletOscBufferMessage | null {
  const parsed = parseWorkletToMainMessage(data);
  if (!parsed.ok || parsed.message.type !== WORKLET_TO_MAIN.oscBuffer) {
    return null;
  }
  return parsed.message;
}
