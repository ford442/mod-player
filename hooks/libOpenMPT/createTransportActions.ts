import type { ModuleInfo } from '../../types';
import { rowsPerSecondFromBpm } from '../../utils/playheadPrediction';
import { getStopMusicWorkletActions } from '../../utils/workletAudioLifecycle';
import {
  parseOscBufferMessage,
  postGetOscBuffer,
  postPause,
  postSeek,
} from '../../audio-worklet/protocol';
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
    'setIsPlaying' | 'setStatus' | 'setIsModuleLoaded' | 'setModuleInfo' | 'setInstrumentNames' | 'setModuleComments' | 'setSequencerCurrentRow' | 'setSequencerGlobalRow' | 'setPlaybackRowFraction'
  >;
  activeEngine: 'worklet' | 'native-worklet';
}

export function createStopMusic(deps: TransportActionsDeps) {
  const { refs, setters } = deps;
  const {
    isPlayingRef,
    uiLoopActiveRef,
    animationFrameHandle,
    nativeEngineRef,
    audioWorkletNodeRef,
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
  const { setIsPlaying, setStatus, setIsModuleLoaded, setInstrumentNames, setModuleComments } = setters;

  return (destroy: boolean = false) => {
    isPlayingRef.current = false;
    setIsPlaying(false);
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
