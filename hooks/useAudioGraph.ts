// Audio graph setup extracted from useLibOpenMPT.ts.
// Thin orchestrator: engine paths live under hooks/audioGraph/.

import { logWorkletDiagnostics } from '../audio-worklet/diagnostics';
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

export type {
  AudioGraphCallbacks,
  AudioGraphConfig,
  AudioGraphRefs,
} from './audioGraph/types';

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
        console.log('[PLAY] Hot reload while playing — posting load to worklet:', moduleBuf.byteLength, 'bytes');
        refs.lastWorkletModuleTokenSentRef.current = moduleToken;
        refs.audioWorkletNodeRef.current.port.postMessage(postLoad(moduleBuf));
        callbacks.setStatus('Loading audio engine...');
      }
      return;
    }

    // Recover from "UI playing / worklet paused" races: stopMusic pauses the
    // processor but a stale React render used to clear isPlayingRef. Always
    // nudge the worklet + resume the context instead of hard-ignoring.
    console.log('[PLAY] Already marked playing — ensuring worklet render + context resume');
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

  console.log('[PLAY] Starting playback...', {
    engine: config.activeEngine,
    isWorkletSupported: config.isWorkletSupported,
    hasFileData: !!refs.fileDataRef.current,
    fileDataLength: refs.fileDataRef.current?.length,
  });

  try {
    if (!refs.audioContextRef.current) {
      console.log('[PLAY] Creating new AudioContext...');
      refs.audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ latencyHint: 'playback' });
      refs.workletLoadedRef.current = false;

      // AUDIO-001 FIX COMPLETE: Detailed log right after AudioContext creation
      const ctx = refs.audioContextRef.current;
      console.log('[AudioEngine] AudioContext created', {
        state: ctx.state,
        sampleRate: ctx.sampleRate,
        baseLatency: ctx.baseLatency,
        outputLatency: ctx.outputLatency ?? 0,
        timestamp: performance.now(),
      });
    }

    const ctx = refs.audioContextRef.current;
    console.log('[PLAY] AudioContext state:', ctx.state);

    // AUDIO-001 FIX COMPLETE: Log diagnostics
    logWorkletDiagnostics(config.WORKLET_URL, ctx);

    if (ctx.state === 'suspended') {
      console.log('[PLAY] Resuming suspended AudioContext...');
      await ctx.resume();
      console.log('[PLAY] AudioContext resumed, new state:', ctx.state);
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
      console.log('[PLAY] Disconnecting previous AudioWorkletNode...');
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
