/**
 * Pure audio worklet lifecycle decisions shared by hooks and regression tests.
 * Guards #329 (singleton / hot reload), #330 (AudioContext keep-alive),
 * and #354 (position postMessage throttle + hot-reload load token).
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

// ── #354: position postMessage throttle ─────────────────────────────────────

/** Target cadence for worklet → main-thread `position` messages (Hz). */
export const WORKLET_POSITION_REPORT_HZ = 60;

/** Seconds between allowed `position` posts (matches openmpt-worklet.js). */
export const WORKLET_POSITION_REPORT_INTERVAL_SEC = 1 / WORKLET_POSITION_REPORT_HZ;

/**
 * Whether the worklet process() quantum may post a `position` message.
 * Posting every quantum (~350 Hz at 128-sample blocks) floods the main thread
 * and causes audible MOD hiccups (#354).
 */
export function shouldReportWorkletPosition(
  currentTime: number,
  lastReportTime: number,
  intervalSec: number = WORKLET_POSITION_REPORT_INTERVAL_SEC,
): boolean {
  return currentTime - lastReportTime >= intervalSec;
}

/**
 * Simulate N audio quanta and count how many position reports the throttle allows.
 * Uses a fake audio clock (no real sleep) — quantumSec defaults to 128/44100 ≈ 350 Hz.
 */
export function countThrottledPositionReports(options: {
  durationSec: number;
  quantumSec?: number;
  intervalSec?: number;
  startTime?: number;
}): number {
  const quantumSec = options.quantumSec ?? 128 / 44100;
  const intervalSec = options.intervalSec ?? WORKLET_POSITION_REPORT_INTERVAL_SEC;
  let t = options.startTime ?? 0;
  let lastReport = Number.NEGATIVE_INFINITY;
  let reports = 0;
  const end = t + options.durationSec;
  // Inclusive of the first quantum at t=start; advance while inside the window.
  while (t <= end + 1e-12) {
    if (shouldReportWorkletPosition(t, lastReport, intervalSec)) {
      reports += 1;
      lastReport = t;
    }
    t += quantumSec;
  }
  return reports;
}

// ── #354: module load token / stale loaded-ack ──────────────────────────────

/**
 * True when play() must post a fresh `load` to the worklet (token advanced or
 * explicit force after processModuleData).
 */
export function shouldForceWorkletModuleLoad(
  moduleToken: number,
  lastSentToken: number,
  forceModuleLoad?: boolean,
): boolean {
  return moduleToken !== lastSentToken || forceModuleLoad === true;
}

/**
 * Accept a worklet `loaded` ack only when it matches the last token we sent.
 * Prevents a late ack from a previous module from flipping isPlaying on a new load.
 */
export function shouldAcceptWorkletLoadedAck(
  currentModuleToken: number,
  lastSentModuleToken: number,
): boolean {
  return currentModuleToken === lastSentModuleToken;
}

export interface HotReloadPlayDecision {
  reuseNode: boolean;
  disconnectNode: boolean;
  postInitLib: boolean;
  /** Whether this play must deliver module bytes via `load`. */
  postModuleLoad: boolean;
}

/**
 * Full hot-reload play decision for the JS worklet path (#329 + #354).
 * Behavioral regression harness: second play with an existing node must reuse
 * (no disconnect) and still post `load` when the module token advanced.
 */
export function planJsWorkletHotReloadPlay(input: {
  activeEngine: WorkletEngine;
  workletLoaded: boolean;
  hasWorkletNode: boolean;
  libJsText: string | null | undefined;
  moduleToken: number;
  lastSentToken: number;
  forceModuleLoad?: boolean;
}): HotReloadPlayDecision {
  const reuseNode = canReuseWorkletNode({
    activeEngine: input.activeEngine,
    workletLoaded: input.workletLoaded,
    hasWorkletNode: input.hasWorkletNode,
  });
  return {
    reuseNode,
    disconnectNode: shouldDisconnectWorkletOnPlay(input.hasWorkletNode, reuseNode),
    postInitLib: shouldPostInitLib(reuseNode, input.libJsText),
    postModuleLoad: shouldForceWorkletModuleLoad(
      input.moduleToken,
      input.lastSentToken,
      input.forceModuleLoad,
    ),
  };
}
