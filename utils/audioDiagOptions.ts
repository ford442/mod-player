/**
 * Opt-in switches for the two per-quantum worklet features that used to run
 * unconditionally: the Project-M PCM stream and process() timing diagnostics.
 *
 * Both are read on the main thread and pushed to the worklet right after the
 * node is created (see useAudioGraph), so the audio thread never pays for work
 * nobody consumes.
 */

import type { AudioDiagSnapshot } from '../types';
import type { WorkletAudioDiagMessage } from '../audio-worklet/protocol';

/** ?audioDiag=1 (or localStorage xasm1_audio_diag=1) enables worklet timing. */
export function isAudioDiagEnabled(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('audioDiag') === '1') return true;
    return localStorage.getItem('xasm1_audio_diag') === '1';
  } catch {
    return false;
  }
}

/**
 * The Project-M bridge only has a consumer when this page is a popup or is
 * embedded — the same condition startProjectMBridge() uses to activate.
 */
export function hasProjectMConsumer(): boolean {
  try {
    return !!window.opener || window.parent !== window;
  } catch {
    return false;
  }
}

/** Fold a worklet report into the cumulative window.__AUDIO_DIAG__ snapshot. */
export function mergeAudioDiag(
  prev: AudioDiagSnapshot | undefined,
  msg: WorkletAudioDiagMessage,
): AudioDiagSnapshot {
  return {
    budgetMs: msg.budgetMs,
    quanta: msg.quanta,
    avgProcessMs: msg.avgProcessMs,
    maxProcessMs: msg.maxProcessMs,
    overruns: msg.overruns,
    totalQuanta: (prev?.totalQuanta ?? 0) + msg.quanta,
    totalOverruns: (prev?.totalOverruns ?? 0) + msg.overruns,
    // Wrap stats are worst-case-since-enabled, not per-window: a hitch every
    // few patterns would otherwise be invisible in a 16 ms sample.
    wrapMaxProcessMs: Math.max(prev?.wrapMaxProcessMs ?? 0, msg.wrapMaxProcessMs),
    wraps: (prev?.wraps ?? 0) + msg.wraps,
    wrapOverruns: (prev?.wrapOverruns ?? 0) + msg.wrapOverruns,
    order: msg.order,
    row: msg.row,
    updatedAt: performance.now(),
  };
}
