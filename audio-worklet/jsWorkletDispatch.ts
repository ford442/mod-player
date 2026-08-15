/**
 * Testable dispatch for validated worklet→main postMessage payloads.
 *
 * useAudioGraph.ts validates via parseWorkletToMainMessageOrWarn, then calls
 * dispatchWorkletToMainMessage and applies the returned side-effect hints.
 */

import type { WorkletAudioDiagMessage, WorkletToMainMessage } from './protocol';
import { WORKLET_TO_MAIN } from './workletProtocolConstants';
import {
  applyNormalizedPosition,
  jsWorkletPositionToInput,
  type ApplyPositionResult,
} from '../utils/workletPositionAdapter';
import type { WorkletPositionRefs } from '../utils/playheadPrediction';
import { shouldAcceptWorkletLoadedAck } from '../utils/workletAudioLifecycle';
import type { ChannelShadowState } from '../types';

export interface JsWorkletDispatchRefs {
  pendingSeekRef: { current: { order: number; row: number; timestamp: number } | null };
  seekAcknowledgedRef: { current: boolean };
  workletModuleTokenRef: { current: number };
  lastWorkletModuleTokenSentRef: { current: number };
  spFallbackTriggered: { current: boolean };
  channelStatesRef: { current: ChannelShadowState[] };
}

export type JsWorkletDispatchResult =
  | { kind: 'position'; applied: ApplyPositionResult; channelVU?: number[] }
  | { kind: 'loaded-accepted' }
  | { kind: 'loaded-stale' }
  | { kind: 'ended' }
  | { kind: 'error'; message: string; shouldAttemptSpFallback: boolean }
  | { kind: 'seek-ack' }
  | { kind: 'diagnostic'; subtype: 'needData' | 'starvation'; raw: unknown }
  | { kind: 'projectm-pcm'; buffer: Float32Array; channels: 1 | 2 }
  | { kind: 'audio-diag'; diag: WorkletAudioDiagMessage }
  | { kind: 'ignored' };

export interface DispatchWorkletToMainOptions {
  refs: JsWorkletDispatchRefs & WorkletPositionRefs;
  message: WorkletToMainMessage;
  audioContextCurrentTime: number;
}

/** Pure dispatch: map a validated worklet→main message to a handled result. */
export function dispatchWorkletToMainMessage(
  options: DispatchWorkletToMainOptions,
): JsWorkletDispatchResult {
  const { refs, message, audioContextCurrentTime } = options;

  switch (message.type) {
    case WORKLET_TO_MAIN.position: {
      const posInput: Parameters<typeof jsWorkletPositionToInput>[0] = {
        order: message.order,
        row: message.row,
        positionSeconds: message.positionSeconds,
      };
      if (message.bpm != null) posInput.bpm = message.bpm;
      if (message.speed != null) posInput.speed = message.speed;
      if (message.rowFraction != null) posInput.rowFraction = message.rowFraction;
      if (message.audioTime != null) posInput.audioTime = message.audioTime;
      if (message.workletTime != null) posInput.workletTime = message.workletTime;
      if (message.samplesWritten != null) posInput.samplesWritten = message.samplesWritten;
      if (message.sampleRate != null) posInput.sampleRate = message.sampleRate;
      if (message.channelVU != null) posInput.channelVU = message.channelVU;

      const input = jsWorkletPositionToInput(posInput, audioContextCurrentTime);
      const applyOpts: {
        channelStates: ChannelShadowState[];
        channelVU?: number[];
      } = { channelStates: refs.channelStatesRef.current };
      if (message.channelVU != null) {
        applyOpts.channelVU = message.channelVU;
      }
      const applied = applyNormalizedPosition(refs, input, applyOpts);

      if (
        refs.pendingSeekRef.current &&
        applied.order === refs.pendingSeekRef.current.order &&
        applied.rowInt === refs.pendingSeekRef.current.row
      ) {
        refs.seekAcknowledgedRef.current = true;
        refs.pendingSeekRef.current = null;
      }

      return {
        kind: 'position',
        applied,
        ...(message.channelVU ? { channelVU: message.channelVU } : {}),
      };
    }

    case WORKLET_TO_MAIN.loaded: {
      if (
        !shouldAcceptWorkletLoadedAck(
          refs.workletModuleTokenRef.current,
          refs.lastWorkletModuleTokenSentRef.current,
        )
      ) {
        return { kind: 'loaded-stale' };
      }
      return { kind: 'loaded-accepted' };
    }

    case WORKLET_TO_MAIN.ended:
      return { kind: 'ended' };

    case WORKLET_TO_MAIN.error: {
      const shouldAttemptSpFallback =
        !refs.spFallbackTriggered.current &&
        (message.message.includes('Lib init failed') ||
          message.message.includes('WASM library init timeout'));
      return {
        kind: 'error',
        message: message.message,
        shouldAttemptSpFallback,
      };
    }

    case WORKLET_TO_MAIN.seekAck:
      refs.seekAcknowledgedRef.current = true;
      refs.pendingSeekRef.current = null;
      return { kind: 'seek-ack' };

    case WORKLET_TO_MAIN.needData:
      return { kind: 'diagnostic', subtype: 'needData', raw: message };

    case WORKLET_TO_MAIN.starvation:
      return { kind: 'diagnostic', subtype: 'starvation', raw: message };

    case WORKLET_TO_MAIN.projectmPcm:
      return {
        kind: 'projectm-pcm',
        buffer: message.buffer,
        channels: message.channels,
      };

    case WORKLET_TO_MAIN.audioDiag:
      return { kind: 'audio-diag', diag: message };

    case WORKLET_TO_MAIN.oscBuffer:
      // Handled by dedicated one-shot listener in useLibOpenMPT.requestOscBuffer.
      return { kind: 'ignored' };

    default: {
      const _exhaustive: never = message;
      return _exhaustive;
    }
  }
}
