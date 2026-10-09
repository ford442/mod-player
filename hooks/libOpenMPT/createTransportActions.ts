import type { ModuleInfo } from '../../types';
import { rowsPerSecondFromBpm } from '../../utils/playheadPrediction';
import { createNativeClockAnchor } from '../../utils/nativeClockAnchor';
import { getStopMusicWorkletActions } from '../../utils/workletAudioLifecycle';
import {
  parseOscBufferMessage,
  postGetOscBuffer,
  postPause,
  postPlay,
  postSeek,
} from '../../audio-worklet/protocol';
import { createPauseClock, rebaseSampleForResume, silenceChannelStates } from '../../utils/transportClock';
import { viewsFromAudioSab } from '../../utils/audioReactive';
import {
  createPlayheadLagTracker,
  createPositionReportTracker,
} from '../../utils/playheadLagMonitor';
import type { LibOpenMPTRefs, LibOpenMPTSetters } from './types';

export interface TransportActionsDeps {
  refs: LibOpenMPTRefs;
  setters: Pick<
    LibOpenMPTSetters,
    | 'setIsPlaying'
    | 'setIsPaused'
    | 'setStatus'
    | 'setIsModuleLoaded'
    | 'setModuleInfo'
    | 'setInstrumentNames'
    | 'setSampleNames'
    | 'setModuleFormat'
    | 'setModuleComments'
    | 'setSequencerCurrentRow'
    | 'setSequencerGlobalRow'
    | 'setPlaybackRowFraction'
  >;
  activeEngine: 'worklet' | 'native-worklet';
}

export function createStopMusic(deps: TransportActionsDeps) {
  const { refs, setters } = deps;
  const {
    isPlayingRef,
    isPausedRef,
    pauseClockRef,
    uiLoopActiveRef,
    animationFrameHandle,
    nativeEngineRef,
    audioWorkletNodeRef,
    nativeClockAnchorRef,
    scriptProcessorRef,
    spLeftBufPtr,
    spRightBufPtr,
    spFallbackTriggered,
    libopenmptRef,
    audioClockStartRef,
    workletTimeAtStartRef,
    driftAccumulatorRef,
    lastCorrectedTimeRef,
    pendingSeekRef,
    seekAcknowledgedRef,
    audioContextRef,
    lastWorkletUpdateRef,
    workletTimeRef,
    workletOrderRef,
    workletRowRef,
    workletSpeedRef,
    workletRowsPerSecRef,
    workletPositionSampleRef,
    workletBpmRef,
    currentModulePtr,
  } = refs;
  const {
    setIsPlaying,
    setIsPaused,
    setStatus,
    setIsModuleLoaded,
    setInstrumentNames,
    setSampleNames,
    setModuleFormat,
    setModuleComments,
  } = setters;

  return (destroy: boolean = false) => {
    isPlayingRef.current = false;
    setIsPlaying(false);
    // Stop is the one way out of a pause that discards the position (the refs reset below).
    isPausedRef.current = false;
    setIsPaused(false);
    pauseClockRef.current = createPauseClock();
    uiLoopActiveRef.current = false;
    if (animationFrameHandle.current) cancelAnimationFrame(animationFrameHandle.current);

    if (nativeEngineRef.current) {
      nativeEngineRef.current.pause();
    }

    const workletStop = getStopMusicWorkletActions(destroy, audioWorkletNodeRef.current != null);

    if (audioWorkletNodeRef.current) {
      const oldNode = audioWorkletNodeRef.current;
      if (workletStop.pauseProcessor) {
        try { oldNode.port.postMessage(postPause()); } catch { /* ignore */ }
      }
      if (workletStop.clearMessageHandler) {
        try { oldNode.port.onmessage = null; } catch { /* ignore */ }
      }
      if (workletStop.disconnectNode) {
        try { oldNode.disconnect(); } catch { /* ignore */ }
      }
      if (workletStop.clearNodeRef) {
        audioWorkletNodeRef.current = null;
      }
    }

    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }
    if (spLeftBufPtr.current && libopenmptRef.current) {
      libopenmptRef.current._free(spLeftBufPtr.current);
      spLeftBufPtr.current = 0;
    }
    if (spRightBufPtr.current && libopenmptRef.current) {
      libopenmptRef.current._free(spRightBufPtr.current);
      spRightBufPtr.current = 0;
    }
    spFallbackTriggered.current = false;

    audioClockStartRef.current = 0;
    workletTimeAtStartRef.current = 0;
    nativeClockAnchorRef.current = null;
    driftAccumulatorRef.current = 0;
    lastCorrectedTimeRef.current = 0;
    pendingSeekRef.current = null;
    seekAcknowledgedRef.current = true;

    const audioCtx = audioContextRef.current;
    lastWorkletUpdateRef.current = audioCtx ? audioCtx.currentTime : performance.now() / 1000;

    workletTimeRef.current = 0;
    workletOrderRef.current = 0;
    workletRowRef.current = 0;
    workletSpeedRef.current = 6;
    workletRowsPerSecRef.current = rowsPerSecondFromBpm(125);
    workletPositionSampleRef.current = null;
    workletBpmRef.current = 125;
    if (destroy) {
      setInstrumentNames([]);
      setSampleNames([]);
      setModuleFormat('');
      setModuleComments('');
    }

    if (destroy && currentModulePtr.current !== 0 && libopenmptRef.current) {
      libopenmptRef.current._openmpt_module_destroy(currentModulePtr.current);
      currentModulePtr.current = 0;
      setIsModuleLoaded(false);
    }

    setStatus('Stopped.');
  };
}

/**
 * Pause: silence the engine but keep everything needed to continue — the engine's own cursor, the
 * clock refs and the last position sample. `stopMusic` is the opposite: it resets all of those.
 *
 * Engine side is the first half of what stop already did (`postPause()` for the JS worklet, the
 * existing `pause()` export for the native engine — neither touches the AudioContext, CLAUDE.md pitfall
 * 10). The ScriptProcessor fallback has no processor flag; its callback reads `isPausedRef`.
 *
 * The UI loop keeps running so the playhead can finish following the audio already in flight, then
 * hold (see utils/transportClock.ts).
 */
export function createPauseMusic(deps: TransportActionsDeps) {
  const { refs, setters } = deps;
  const {
    isPlayingRef,
    isPausedRef,
    pauseClockRef,
    audioContextRef,
    playbackEngineRef,
    nativeEngineRef,
    audioWorkletNodeRef,
    channelStatesRef,
  } = refs;
  const { setIsPlaying, setIsPaused, setStatus } = setters;

  return () => {
    // Pause only means something while playing: a stopped or already-paused transport stays put.
    if (!isPlayingRef.current) return;

    const audioCtx = audioContextRef.current;
    pauseClockRef.current = { pausedAt: audioCtx ? audioCtx.currentTime : 0, resumedAt: null };
    isPlayingRef.current = false;
    isPausedRef.current = true;
    setIsPlaying(false);
    setIsPaused(true);

    // Drive the engine that actually started this playback. The selection state (activeEngine) is not
    // reliable here: after a failed native start falls back to the JS worklet it can still say native.
    const engine = playbackEngineRef.current;
    if (engine === 'native-worklet' && nativeEngineRef.current) {
      nativeEngineRef.current.pause();
    } else if (engine === 'worklet' && audioWorkletNodeRef.current) {
      try { audioWorkletNodeRef.current.port.postMessage(postPause()); } catch { /* node torn down */ }
    }
    // 'scriptprocessor' has no processor flag: its callback reads isPausedRef.

    silenceChannelStates(channelStatesRef.current);

    setStatus('Paused.');
  };
}

/**
 * Resume from a pause: continue from the same order/row. The engine kept its cursor, so this only
 * has to un-silence it and re-anchor the main-thread clock — the last position sample is stale by the
 * whole pause (see `rebaseSampleForResume`), and the drift detector is re-based so it doesn't read
 * the pause as drift.
 */
export function createResumeMusic(deps: TransportActionsDeps) {
  const { refs, setters } = deps;
  const {
    isPlayingRef,
    isPausedRef,
    pauseClockRef,
    audioContextRef,
    playbackEngineRef,
    nativeEngineRef,
    audioWorkletNodeRef,
    nativeClockAnchorRef,
    workletPositionSampleRef,
    workletRowsPerSecRef,
    workletTimeRef,
    workletRowRef,
    audioClockStartRef,
    workletTimeAtStartRef,
    driftAccumulatorRef,
    lastWorkletUpdateRef,
    uiLoopActiveRef,
    animationFrameHandle,
    updateUIRef,
  } = refs;
  const { setIsPlaying, setIsPaused, setStatus } = setters;

  return () => {
    if (!isPausedRef.current) return;

    const audioCtx = audioContextRef.current;
    const resumeAt = audioCtx ? audioCtx.currentTime : 0;
    const { pausedAt } = pauseClockRef.current;

    const sample = workletPositionSampleRef.current;
    if (sample && pausedAt != null) {
      const rowsPerSecond = workletRowsPerSecRef.current || rowsPerSecondFromBpm(sample.bpm);
      const rebased = rebaseSampleForResume(sample, rowsPerSecond, pausedAt, resumeAt);
      workletPositionSampleRef.current = rebased;
      workletTimeRef.current = rebased.positionSeconds;
      workletRowRef.current = rebased.rowInt;
    }
    pauseClockRef.current = { pausedAt: null, resumedAt: resumeAt };
    audioClockStartRef.current = resumeAt;
    workletTimeAtStartRef.current = workletTimeRef.current;
    driftAccumulatorRef.current = 0;
    lastWorkletUpdateRef.current = resumeAt;

    isPausedRef.current = false;
    isPlayingRef.current = true;
    setIsPaused(false);
    setIsPlaying(true);

    const engine = playbackEngineRef.current;
    if (engine === 'native-worklet' && nativeEngineRef.current) {
      // The native frame clock (audioFramesRendered) stops while paused, so the anchor that maps it
      // onto the audio clock is stale by the pause. Drop it: positions fall back to arrival-time
      // mapping until the next play/seek re-anchors.
      nativeClockAnchorRef.current = null;
      nativeEngineRef.current.play();
    } else if (engine === 'worklet' && audioWorkletNodeRef.current) {
      try { audioWorkletNodeRef.current.port.postMessage(postPlay()); } catch { /* node torn down */ }
    }

    if (audioCtx && audioCtx.state === 'suspended') {
      void audioCtx.resume().catch(() => { /* needs a user gesture; the suspend-recovery listener retries */ });
    }

    uiLoopActiveRef.current = true;
    if (animationFrameHandle.current) cancelAnimationFrame(animationFrameHandle.current);
    animationFrameHandle.current = requestAnimationFrame(() => { updateUIRef.current?.(); });

    setStatus('Playing...');
  };
}

export function createSeekToStep(deps: TransportActionsDeps) {
  const { refs, setters, activeEngine } = deps;
  const {
    patternMatricesRef,
    audioContextRef,
    pendingSeekRef,
    seekAcknowledgedRef,
    libopenmptRef,
    currentModulePtr,
    workletOrderRef,
    workletRowRef,
    workletTimeRef,
    workletPositionSampleRef,
    workletRowsPerSecRef,
    workletBpmRef,
    driftAccumulatorRef,
    lastWorkletUpdateRef,
    audioClockStartRef,
    workletTimeAtStartRef,
    playbackStateRef,
    lastUiOrderRef,
    lastUiRowIntRef,
    audioWorkletNodeRef,
    nativeEngineRef,
    nativeClockAnchorRef,
    nativeBridgeLatencyRef,
  } = refs;
  const {
    setModuleInfo,
    setSequencerCurrentRow,
    setSequencerGlobalRow,
    setPlaybackRowFraction,
  } = setters;

  return (step: number) => {
    const matrices = patternMatricesRef.current;
    if (matrices.length === 0) return;

    let acc = 0;
    let targetOrder = 0;
    let targetRow = 0;
    for (let o = 0; o < matrices.length; o++) {
      const m = matrices[o];
      const rows = m ? m.numRows : 64;
      if (step < acc + rows) {
        targetOrder = o;
        targetRow = step - acc;
        break;
      }
      acc += rows;
    }

    const audioCtx = audioContextRef.current;
    pendingSeekRef.current = {
      order: targetOrder,
      row: targetRow,
      timestamp: audioCtx ? audioCtx.currentTime : performance.now() / 1000,
    };
    seekAcknowledgedRef.current = false;

    const lib = libopenmptRef.current;
    const modPtr = currentModulePtr.current;
    if (lib && modPtr !== 0) {
      lib._openmpt_module_set_position_order_row(modPtr, targetOrder, targetRow);
    }

    workletOrderRef.current = targetOrder;
    workletRowRef.current = targetRow;
    workletTimeRef.current = 0;
    workletPositionSampleRef.current = null;
    workletRowsPerSecRef.current = rowsPerSecondFromBpm(workletBpmRef.current);

    setModuleInfo((prev: ModuleInfo) => ({ ...prev, order: targetOrder, row: targetRow }));
    setSequencerCurrentRow(targetRow);
    setSequencerGlobalRow(step);
    setPlaybackRowFraction(targetRow);
    playbackStateRef.current.playheadRow = targetRow;
    lastUiOrderRef.current = targetOrder;
    lastUiRowIntRef.current = targetRow;

    driftAccumulatorRef.current = 0;
    lastWorkletUpdateRef.current = audioCtx ? audioCtx.currentTime : 0;
    audioClockStartRef.current = audioCtx ? audioCtx.currentTime : 0;
    workletTimeAtStartRef.current = workletTimeRef.current;

    if (activeEngine === 'native-worklet' && audioCtx) {
      nativeClockAnchorRef.current = createNativeClockAnchor(
        audioCtx,
        nativeBridgeLatencyRef.current,
      );
    }

    if (activeEngine === 'native-worklet' && nativeEngineRef.current) {
      nativeEngineRef.current.seek(targetOrder, targetRow);
      seekAcknowledgedRef.current = true;
    } else if (activeEngine === 'worklet' && audioWorkletNodeRef.current) {
      audioWorkletNodeRef.current.port.postMessage(
        postSeek(targetOrder, targetRow, audioCtx ? audioCtx.currentTime : 0),
      );
    }
  };
}

export function createRequestOscBuffer(refs: LibOpenMPTRefs) {
  return () => {
    const node = refs.audioWorkletNodeRef.current;
    if (!node) return;
    const handler = (e: MessageEvent) => {
      const oscMsg = parseOscBufferMessage(e.data);
      if (oscMsg) {
        const views = viewsFromAudioSab(oscMsg.buffer);
        refs.oscBufferRef.current = views.osc;
        refs.audioReactiveRef.current = views.meta;
        node.port.removeEventListener('message', handler);
      }
    };
    node.port.addEventListener('message', handler);
    node.port.postMessage(postGetOscBuffer());
  };
}

export function resetTimingOnModuleLoad(refs: LibOpenMPTRefs) {
  refs.workletModuleTokenRef.current += 1;
  refs.playheadLagTrackerRef.current = createPlayheadLagTracker();
  refs.positionReportTrackerRef.current = createPositionReportTracker();
  refs.lastPositionSampleTimeRef.current = -1;
}
