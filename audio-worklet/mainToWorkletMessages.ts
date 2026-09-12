/**
 * Main → AudioWorklet message contract: types, receive guard, send helpers.
 *
 * **Zero runtime dependencies on purpose.** This module is bundled into the
 * audio-thread processor (src/worklets/openmpt-processor.ts), where zod cannot
 * go: AudioWorkletGlobalScope has no DOM, and parsing schemas on the audio
 * thread costs real-time budget. It is also the implementation `protocol.ts`
 * re-exports for the main thread, so there is exactly **one** validator for this
 * direction — no TS/JS mirror to keep in sync (the old
 * public/worklets/worklet-protocol-constants.js).
 *
 * Adding a main→worklet message = add the string to workletProtocolConstants.ts,
 * then add the interface + guard case + post helper here. Nothing else.
 */

import {
  MAIN_TO_WORKLET,
  type MainToWorkletType,
} from './workletProtocolConstants';

export { MAIN_TO_WORKLET };
export type { MainToWorkletType };

// ── Message shapes ───────────────────────────────────────────────────

export interface InitLibMessage {
  type: typeof MAIN_TO_WORKLET.initLib;
  scriptText: string;
  wasmBytes?: ArrayBuffer;
}

export interface LoadMessage {
  type: typeof MAIN_TO_WORKLET.load;
  moduleData: ArrayBuffer | Uint8Array;
}

export interface PlayMessage {
  type: typeof MAIN_TO_WORKLET.play;
}

export interface PauseMessage {
  type: typeof MAIN_TO_WORKLET.pause;
}

export interface SeekMessage {
  type: typeof MAIN_TO_WORKLET.seek;
  order: number;
  row: number;
  timestamp?: number;
}

export interface GetOscBufferMessage {
  type: typeof MAIN_TO_WORKLET.getOscBuffer;
}

export interface SetAudioLiteMessage {
  type: typeof MAIN_TO_WORKLET.setAudioLite;
  lite: boolean;
}

export interface SetProjectmPcmMessage {
  type: typeof MAIN_TO_WORKLET.setProjectmPcm;
  enabled: boolean;
}

export interface SetAudioDiagMessage {
  type: typeof MAIN_TO_WORKLET.setAudioDiag;
  enabled: boolean;
}

export interface SetChannelMuteMessage {
  type: typeof MAIN_TO_WORKLET.setChannelMute;
  channel: number;
  muted: boolean;
}

export interface SetRenderParamMessage {
  type: typeof MAIN_TO_WORKLET.setRenderParam;
  param: number;
  value: number;
}

export interface CtlSetTextMessage {
  type: typeof MAIN_TO_WORKLET.ctlSetText;
  key: string;
  value: string;
}

/** Legacy no-type load shim still emitted by some older call sites. */
export interface LegacyLoadMessage {
  type?: undefined;
  moduleData: ArrayBuffer | Uint8Array;
}

export type MainToWorkletMessage =
  | InitLibMessage
  | LoadMessage
  | PlayMessage
  | PauseMessage
  | SeekMessage
  | GetOscBufferMessage
  | SetAudioLiteMessage
  | SetProjectmPcmMessage
  | SetAudioDiagMessage
  | SetChannelMuteMessage
  | SetRenderParamMessage
  | CtlSetTextMessage;

// ── Receive guard (worklet side, and main-thread tests) ──────────────

export interface WorkletProtocolParseResult<T> {
  ok: true;
  message: T;
}

export interface WorkletProtocolParseError {
  ok: false;
  error: string;
}

export type ParseMainToWorkletResult =
  | WorkletProtocolParseResult<MainToWorkletMessage | LegacyLoadMessage>
  | WorkletProtocolParseError;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isModulePayload(value: unknown): value is ArrayBuffer | Uint8Array {
  return value instanceof ArrayBuffer || value instanceof Uint8Array;
}

function ok(message: MainToWorkletMessage | LegacyLoadMessage): ParseMainToWorkletResult {
  return { ok: true, message };
}

function fail(error: string): ParseMainToWorkletResult {
  return { ok: false, error };
}

/**
 * Validate a main→worklet postMessage payload at the receive boundary.
 * Runs on the audio thread — keep it allocation-light and branch-only.
 */
export function parseMainToWorkletMessage(data: unknown): ParseMainToWorkletResult {
  if (!isRecord(data)) {
    return fail('message is not an object');
  }

  const type = data['type'];

  switch (type) {
    case MAIN_TO_WORKLET.initLib: {
      if (typeof data['scriptText'] !== 'string' || data['scriptText'].length === 0) {
        return fail('initLib requires scriptText');
      }
      const wasmBytes = data['wasmBytes'];
      if (wasmBytes != null && !(wasmBytes instanceof ArrayBuffer)) {
        return fail('wasmBytes must be ArrayBuffer');
      }
      return ok(data as unknown as InitLibMessage);
    }

    case MAIN_TO_WORKLET.load: {
      if (!isModulePayload(data['moduleData'])) {
        return fail('load requires moduleData');
      }
      return ok(data as unknown as LoadMessage);
    }

    case MAIN_TO_WORKLET.play:
    case MAIN_TO_WORKLET.pause:
    case MAIN_TO_WORKLET.getOscBuffer:
      return ok(data as unknown as PlayMessage | PauseMessage | GetOscBufferMessage);

    case MAIN_TO_WORKLET.seek: {
      if (!isNonNegInt(data['order']) || !isNonNegInt(data['row'])) {
        return fail('seek requires order/row');
      }
      if (data['timestamp'] != null && !isFiniteNumber(data['timestamp'])) {
        return fail('seek timestamp must be a finite number');
      }
      return ok(data as unknown as SeekMessage);
    }

    case MAIN_TO_WORKLET.setAudioLite: {
      if (typeof data['lite'] !== 'boolean') {
        return fail('setAudioLite requires lite boolean');
      }
      return ok(data as unknown as SetAudioLiteMessage);
    }

    case MAIN_TO_WORKLET.setProjectmPcm:
    case MAIN_TO_WORKLET.setAudioDiag: {
      if (typeof data['enabled'] !== 'boolean') {
        return fail(String(type) + ' requires enabled boolean');
      }
      return ok(data as unknown as SetProjectmPcmMessage | SetAudioDiagMessage);
    }

    case MAIN_TO_WORKLET.setChannelMute: {
      if (!isNonNegInt(data['channel']) || typeof data['muted'] !== 'boolean') {
        return fail('setChannelMute requires channel/muted');
      }
      return ok(data as unknown as SetChannelMuteMessage);
    }

    case MAIN_TO_WORKLET.setRenderParam: {
      if (!isFiniteNumber(data['param']) || !isFiniteNumber(data['value'])) {
        return fail('setRenderParam requires param/value');
      }
      return ok(data as unknown as SetRenderParamMessage);
    }

    case MAIN_TO_WORKLET.ctlSetText: {
      if (typeof data['key'] !== 'string' || typeof data['value'] !== 'string') {
        return fail('ctlSetText requires key/value strings');
      }
      return ok(data as unknown as CtlSetTextMessage);
    }

    default:
      break;
  }

  // Legacy no-type load shim
  if (type == null && isModulePayload(data['moduleData'])) {
    return ok(data as unknown as LegacyLoadMessage);
  }

  return fail('unknown main→worklet message type: ' + String(type));
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
