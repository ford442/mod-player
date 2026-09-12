/**
 * Typed, validated postMessage contract for the JS AudioWorklet boundary.
 *
 * Both directions share message-type constants from workletProtocolConstants.ts.
 * Runtime validation rejects malformed or version-skewed messages at the
 * receive boundary instead of destructuring e.data blindly.
 *
 * Direction split:
 *  - **worklet → main** is validated here with zod (main thread only).
 *  - **main → worklet** lives in ./mainToWorkletMessages (zero-dependency, so
 *    the same guard can be bundled into the audio-thread processor) and is
 *    re-exported below so call sites keep importing from this module.
 */

import { z } from 'zod';
import { AUDIO_SAB_BYTES } from '../utils/audioReactive';
import {
  MAIN_TO_WORKLET,
  WORKLET_TO_MAIN,
  type MainToWorkletType,
  type WorkletToMainType,
} from './workletProtocolConstants';
import type {
  WorkletProtocolParseError,
  WorkletProtocolParseResult,
} from './mainToWorkletMessages';

export { MAIN_TO_WORKLET, WORKLET_TO_MAIN };
export type { MainToWorkletType, WorkletToMainType };

/**
 * Main → worklet contract (shared with the bundled audio-thread processor).
 * Single implementation — see ./mainToWorkletMessages.
 */
export {
  parseMainToWorkletMessage,
  postInitLib,
  postLoad,
  postPlay,
  postPause,
  postSeek,
  postGetOscBuffer,
  postSetAudioLite,
  postSetProjectmPcm,
  postSetAudioDiag,
  postSetChannelMute,
  postSetRenderParam,
  postCtlSetText,
} from './mainToWorkletMessages';
export type {
  MainToWorkletMessage,
  LegacyLoadMessage,
  ParseMainToWorkletResult,
  WorkletProtocolParseError,
  WorkletProtocolParseResult,
} from './mainToWorkletMessages';

// ── Shared helpers ───────────────────────────────────────────────────

const finiteNumber = z.number().finite();
const nonNegInt = z.number().int().nonnegative();

function isSharedArrayBuffer(value: unknown): value is SharedArrayBuffer {
  return typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer;
}

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
  /** Quantum that set maxProcessMs in this window (not necessarily the wrap). */
  slowMs: finiteNumber.optional(),
  slowOrder: nonNegInt.optional(),
  slowRow: nonNegInt.optional(),
  pcmEnabled: z.boolean().optional(),
  audioLite: z.boolean().optional(),
  /** First wrap windows' maxProcessMs (session; wrap-0 vs wrap-N). */
  wrapProcessMs: z.array(finiteNumber).optional(),
  /** Worst scheduling gap in this window (late callback), ms. */
  maxCallbackGapMs: finiteNumber.optional(),
  heapBytes: nonNegInt.optional(),
  heapMoves: nonNegInt.optional(),
  playingChannels: nonNegInt.optional(),
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

/** Runtime check for oscBuffer handler (replaces unchecked `as SharedArrayBuffer`). */
export function parseOscBufferMessage(data: unknown): WorkletOscBufferMessage | null {
  const parsed = parseWorkletToMainMessage(data);
  if (!parsed.ok || parsed.message.type !== WORKLET_TO_MAIN.oscBuffer) {
    return null;
  }
  return parsed.message;
}
