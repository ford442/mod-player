/**
 * Pure audio worklet lifecycle decisions shared by hooks and regression tests.
 * Guards #329 (singleton / hot reload) and #330 (AudioContext keep-alive).
 */

export type WorkletEngine = 'worklet' | 'native-worklet';

export interface ReuseWorkletNodeInput {
  activeEngine: WorkletEngine;
  workletLoaded: boolean;
  hasWorkletNode: boolean;
}

/** True when play() may hot-reload module data into the existing JS worklet node. */
export function canReuseWorkletNode(input: ReuseWorkletNodeInput): boolean {
  return (
    input.activeEngine === 'worklet' &&
    input.workletLoaded &&
    input.hasWorkletNode
  );
}

/** Main thread must not re-send initLib when the shared-scope lib is already live. */
export function shouldPostInitLib(canReuse: boolean, libJsText: string | null | undefined): boolean {
  return !canReuse && Boolean(libJsText);
}

/** Disconnect stale node when play() cannot hot-reload into it. */
export function shouldDisconnectWorkletOnPlay(hasExistingNode: boolean, canReuse: boolean): boolean {
  return hasExistingNode && !canReuse;
}

export interface StopMusicWorkletActions {
  pauseProcessor: boolean;
  clearMessageHandler: boolean;
  disconnectNode: boolean;
  clearNodeRef: boolean;
  /** Must remain false for normal stop/reload (#330). */
  suspendAudioContext: boolean;
}

export function getStopMusicWorkletActions(
  destroy: boolean,
  hasWorkletNode: boolean,
): StopMusicWorkletActions {
  return {
    pauseProcessor: hasWorkletNode,
    clearMessageHandler: hasWorkletNode,
    disconnectNode: destroy && hasWorkletNode,
    clearNodeRef: destroy,
    suspendAudioContext: false,
  };
}
