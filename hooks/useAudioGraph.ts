// Audio graph setup extracted from useLibOpenMPT.ts.
// Thin orchestrator: engine paths live under hooks/audioGraph/.

import { logWorkletDiagnostics } from '../audio-worklet/diagnostics';
import { createPlayerAudioContext, setPlaybackActiveQuery } from '../utils/audioContextFactory';
import { getAudioSuspendState, setAudioSuspended, subscribeAudioSuspend } from '../utils/audioSuspendState';
import { postLoad, postPause, postPlay } from '../audio-worklet/protocol';
import {
  canReuseWorkletNode,
  shouldDisconnectWorkletOnPlay,
  shouldForceWorkletModuleLoad,
} from '../utils/workletAudioLifecycle';
import {
  ensureCommonMasterNodes,
  moduleBytesFromFileData,
  wireMasterOutput,
} from './audioGraph/masterGraph';
import { startJsWorkletPlayback } from './audioGraph/startJsWorkletPlayback';
import { startNativePlayback } from './audioGraph/startNativePlayback';
import type {
  AudioGraphCallbacks,
  AudioGraphConfig,
  AudioGraphRefs,
} from './audioGraph/types';
import { createLogger } from '../utils/log';

const log = createLogger('PLAY');

export type {
  AudioGraphCallbacks,
  AudioGraphConfig,
  AudioGraphRefs,
} from './audioGraph/types';

// Contexts we've wired suspend-recovery for, keyed to their disposer — a page
// session has one shared AudioContext (utils/audioContextFactory.ts), but
// startAudioPlayback runs on every play(), so guard against re-registering
// listeners each time. unwireAudioSuspendRecovery() below tears these down
// when a context is closed (cleanupLibOpenMPT), so a later gesture or
// statechange on the dead context can't reach a stale ctx/refs/callbacks
// closure.
const suspendRecoveryDisposers = new Map<AudioContext, () => void>();

/**
 * Notice the shared AudioContext leaving `running` unexpectedly (#12 in
 * CLAUDE.md — iOS/Safari `interrupted`, OS suspends) and recover on the next
 * user gesture: resume() the context and re-anchor the playhead clock the
 * same way a fresh play() does, instead of leaving the UI saying "Playing"
 * over silence until the user happens to hit play again.
 *
 * Returns a disposer (also stored, and used by unwireAudioSuspendRecovery).
 */
export function wireAudioSuspendRecovery(
  ctx: AudioContext,
  refs: AudioGraphRefs,
  callbacks: AudioGraphCallbacks,
): () => void {
  const existing = suspendRecoveryDisposers.get(ctx);
  if (existing) return existing;

  setPlaybackActiveQuery(() => refs.isPlayingRef.current);

  const resumeAndReanchor = (): void => {
    if (!refs.isPlayingRef.current) return;
    // Also check ctx.state directly, not just the suspended flag: if
    // `statechange` never fired at all (exactly the case the visibilitychange
    // backstop below exists for), the flag would never flip true and this
    // would otherwise never attempt a resume.
    if (!getAudioSuspendState().suspended && ctx.state === 'running') return;
    void ctx.resume().then(() => {
      if (ctx.state !== 'running') return; // still not back — next gesture retries
      refs.audioClockStartRef.current = ctx.currentTime;
      refs.workletTimeAtStartRef.current = refs.workletTimeRef.current || 0;
      refs.driftAccumulatorRef.current = 0;
      setAudioSuspended(false);
      if (refs.isPlayingRef.current) callbacks.setStatus('Playing...');
    }).catch(() => { /* still suspended (needs a "real" gesture); next one retries */ });
  };

  // Any of these already fire on the interactions a user would use to notice
  // and react to stalled audio (tap the canvas, hit a key, click a control).
  const gestureEvents: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart'];
  const gestureOpts: AddEventListenerOptions = { capture: true, passive: true };
  for (const evt of gestureEvents) {
    window.addEventListener(evt, resumeAndReanchor, gestureOpts);
  }

  const unsubscribeSuspend = subscribeAudioSuspend((state) => {
    if (state.suspended && refs.isPlayingRef.current) {
      callbacks.setStatus('Audio paused by the system — tap anywhere to resume');
    }
  });

  // Backstop for iOS Safari cases where `statechange` doesn't fire promptly:
  // re-check as soon as the tab is foregrounded again.
  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') resumeAndReanchor();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  const dispose = (): void => {
    for (const evt of gestureEvents) {
      window.removeEventListener(evt, resumeAndReanchor, gestureOpts);
    }
    document.removeEventListener('visibilitychange', onVisibilityChange);
    unsubscribeSuspend();
    suspendRecoveryDisposers.delete(ctx);
  };
  suspendRecoveryDisposers.set(ctx, dispose);
  return dispose;
}

/**
 * Tear down wireAudioSuspendRecovery's global listeners and subscription for
 * `ctx`. Call this before closing the shared AudioContext (see
 * hooks/libOpenMPT/runInit.ts's cleanupLibOpenMPT) so a context that outlives
 * its listeners — e.g. a remount without a full page reload — can't fire a
 * stale gesture/visibility/suspend callback against a closed context.
 */
export function unwireAudioSuspendRecovery(ctx: AudioContext | null): void {
  if (!ctx) return;
  suspendRecoveryDisposers.get(ctx)?.();
}

export async function startAudioPlayback(
  refs: AudioGraphRefs,
  callbacks: AudioGraphCallbacks,
  config: AudioGraphConfig
): Promise<void> {
  if (!refs.libopenmptRef.current) {
    console.error("[PLAY] libopenmpt not initialized");
    callbacks.setStatus("Error: Audio library not ready");
    return;
  }
  if (!refs.fileDataRef.current) {
    console.error("[PLAY] No module data available (fileDataRef is null)");
    callbacks.setStatus("Error: No module loaded");
    return;
  }

  const moduleToken = refs.workletModuleTokenRef.current;
  const moduleNeedsWorkletLoad = shouldForceWorkletModuleLoad(
    moduleToken,
    refs.lastWorkletModuleTokenSentRef.current,
    config.forceModuleLoad,
  );

  if (refs.isPlayingRef.current && refs.audioWorkletNodeRef.current) {
    // Hot module reload (#329): stopMusic clears isPlayingRef, but a concurrent
    // `loaded` ack can flip it back before loadModule's play() runs — never skip
    // posting `load` when the module token advanced.
    if (moduleNeedsWorkletLoad) {
      const moduleBuf = moduleBytesFromFileData(refs.fileDataRef.current);
      if (moduleBuf) {
        log.log('Hot reload while playing — posting load to worklet:', moduleBuf.byteLength, 'bytes');
        refs.lastWorkletModuleTokenSentRef.current = moduleToken;
        refs.audioWorkletNodeRef.current.port.postMessage(postLoad(moduleBuf));
        callbacks.setStatus('Loading audio engine...');
      }
      return;
    }

    // Recover from "UI playing / worklet paused" races: stopMusic pauses the
    // processor but a stale React render used to clear isPlayingRef. Always
    // nudge the worklet + resume the context instead of hard-ignoring.
    log.log('Already marked playing — ensuring worklet render + context resume');
    try {
      refs.audioWorkletNodeRef.current.port.postMessage(postPlay());
    } catch { /* ignore */ }
    const existingCtx = refs.audioContextRef.current;
    if (existingCtx?.state === 'suspended') {
      try { await existingCtx.resume(); } catch { /* ignore */ }
    }
    if (refs.gainNodeRef.current) {
      refs.gainNodeRef.current.gain.value = config.volume;
    }
    if (refs.stereoPannerRef.current) {
      refs.stereoPannerRef.current.pan.value = config.panValue;
    }
    if (existingCtx) {
      wireMasterOutput(existingCtx, refs, config.volume, config.panValue);
    }
    if (!refs.animationFrameHandle.current && refs.updateUIRef.current) {
      refs.animationFrameHandle.current = requestAnimationFrame(refs.updateUIRef.current);
    }
    return;
  }

  log.log('Starting playback...', {
    engine: config.activeEngine,
    isWorkletSupported: config.isWorkletSupported,
    hasFileData: !!refs.fileDataRef.current,
    fileDataLength: refs.fileDataRef.current?.length,
  });

  try {
    if (!refs.audioContextRef.current) {
      // Single construction site for the page session — see
      // utils/audioContextFactory.ts. Locked to 48 kHz; `latencyHint` comes
      // from the stage-mode / ?latency= profile resolved at create time.
      log.log('Acquiring shared player AudioContext...');
      refs.audioContextRef.current = createPlayerAudioContext();
      refs.workletLoadedRef.current = false;
    }

    const ctx = refs.audioContextRef.current;
    log.log('AudioContext state:', ctx.state);
    wireAudioSuspendRecovery(ctx, refs, callbacks);

    // AUDIO-001 FIX COMPLETE: Log diagnostics
    if (import.meta.env.DEV) logWorkletDiagnostics(config.WORKLET_URL, ctx);

    if (ctx.state === 'suspended') {
      log.log('Resuming suspended AudioContext...');
      await ctx.resume();
      log.log('AudioContext resumed, new state:', ctx.state);
    }

    // TIMING FIX: Initialize audio clock reference
    refs.audioClockStartRef.current = ctx.currentTime;
    refs.workletTimeAtStartRef.current = refs.workletTimeRef.current || 0;
    refs.driftAccumulatorRef.current = 0;

    ensureCommonMasterNodes(ctx, refs, config.volume, config.panValue);

    // Disconnect previous source unless we can hot-reload module data into the
    // existing JS worklet node (avoids re-init of shared-scope libopenmpt WASM).
    const reuseWorkletNode = canReuseWorkletNode({
      activeEngine: config.activeEngine,
      workletLoaded: refs.workletLoadedRef.current,
      hasWorkletNode: refs.audioWorkletNodeRef.current != null,
    });

    const staleWorkletNode = refs.audioWorkletNodeRef.current;
    if (shouldDisconnectWorkletOnPlay(staleWorkletNode != null, reuseWorkletNode) && staleWorkletNode) {
      log.log('Disconnecting previous AudioWorkletNode...');
      try { staleWorkletNode.port.postMessage(postPause()); } catch { /* ignore */ }
      try { staleWorkletNode.port.onmessage = null; } catch { /* ignore */ }
      try { staleWorkletNode.disconnect(); } catch { /* ignore */ }
      refs.audioWorkletNodeRef.current = null;
    }

    let currentEngineToTry = config.activeEngine;

    if (currentEngineToTry === 'native-worklet' && config.isNativeWorkletAvailable) {
      const nativeResult = await startNativePlayback(refs, callbacks, config, ctx);
      if (nativeResult === 'started') {
        return;
      }
      currentEngineToTry = 'worklet';
    }

    if (currentEngineToTry === 'worklet' && config.isWorkletSupported) {
      await startJsWorkletPlayback(refs, callbacks, config, ctx, reuseWorkletNode);
    } else {
      callbacks.setStatus("Error: AudioWorklet not supported/available.");
      return;
    }

  } catch (e) {
    console.error("[PLAY] Play error:", e);
    callbacks.setStatus("Error starting playback");
  }
}
