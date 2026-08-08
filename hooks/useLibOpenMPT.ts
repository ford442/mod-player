import { useCallback, useEffect } from 'react';
import type { PatternMatrix } from '../types';
import { startAudioPlayback, type AudioGraphCallbacks, type AudioGraphConfig, type AudioGraphRefs } from './useAudioGraph';
import { useWorkletLoader } from './useWorkletLoader';
import { postSetAudioLite } from '../audio-worklet/protocol';
import {
  overrideFromActiveEngine,
  writeStoredAudioEngineOverride,
} from '../utils/audioEngineSelection';
import { hasShareModuleIntent } from '../utils/shareState';
import { applyMasterLevels } from '../utils/audioMasterGraph';
import { DEFAULT_MODULE_URL, WORKLET_URL } from './libOpenMPT/constants';
import { useLibOpenMPTRefs } from './libOpenMPT/useLibOpenMPTRefs';
import { useLibOpenMPTState } from './libOpenMPT/useLibOpenMPTState';
import { createUpdateUI } from './libOpenMPT/createUpdateUI';
import {
  createEnsureMainThreadModule,
  createLoadModule,
  createProcessModuleData,
} from './libOpenMPT/createModuleActions';
import {
  createRequestOscBuffer,
  createSeekToStep,
  createStopMusic,
} from './libOpenMPT/createTransportActions';
import { cleanupLibOpenMPT, runLibOpenMPTInit } from './libOpenMPT/runInit';

export function useLibOpenMPT(initialVolume: number = 0.4, liteMode: boolean = false) {
  const state = useLibOpenMPTState(initialVolume);
  const refs = useLibOpenMPTRefs();

  const {
    status, isReady, isPlaying, isModuleLoaded, moduleInfo, patternData,
    sequencerMatrix, sequencerCurrentRow, sequencerGlobalRow, totalPatternRows,
    playbackSeconds, playbackRowFraction, channelStates, beatPhase, grooveAmount,
    kickTrigger, activeChannels, isLooping, panValue, volume, activeEngine,
    isWorkletSupported, isNativeWorkletAvailable, restartPlayback, syncDebug,
    workletLoadError, instrumentNames, instrumentTable, moduleComments,
    moduleDurationSeconds, moduleFileName,
    setStatus, setIsPlaying, setIsModuleLoaded, setModuleInfo, setSequencerMatrix,
    setInstrumentNames, setInstrumentTable, setModuleComments, setModuleDurationSeconds,
    setModuleFileName, setSequencerCurrentRow, setSequencerGlobalRow, setPlaybackSeconds,
    setPlaybackRowFraction, setTotalPatternRows, setChannelStates, setBeatPhase,
    setSyncDebug, setIsReady, setIsWorkletSupported, setIsNativeWorkletAvailable,
    setActiveEngine, setWorkletLoadError, setIsLooping, setPanValue, _setVolume,
    setRestartPlayback,
  } = state;

  const { verifyWorkletFile, isAudioWorkletSupported: checkWorkletSupport } = useWorkletLoader({
    debug: true,
  });

  const setters = {
    setStatus,
    setIsPlaying,
    setIsModuleLoaded,
    setModuleInfo,
    setSequencerMatrix,
    setInstrumentNames,
    setInstrumentTable,
    setModuleComments,
    setModuleDurationSeconds,
    setModuleFileName,
    setSequencerCurrentRow,
    setSequencerGlobalRow,
    setPlaybackSeconds,
    setPlaybackRowFraction,
    setTotalPatternRows,
    setChannelStates,
    setBeatPhase,
    setSyncDebug,
    setIsReady,
    setIsWorkletSupported,
    setIsNativeWorkletAvailable,
    setActiveEngine,
    setWorkletLoadError,
  };

  const transportDeps = { refs, setters, activeEngine };

  const stopMusic = useCallback(createStopMusic(transportDeps), []);
  const seekToStepWrapper = useCallback(createSeekToStep(transportDeps), [activeEngine]);
  const requestOscBuffer = useCallback(createRequestOscBuffer(refs), []);

  const processModuleData = useCallback(
    createProcessModuleData({ refs, setters, stopMusic }),
    [stopMusic],
  );
  const ensureMainThreadModule = useCallback(createEnsureMainThreadModule(refs), []);
  refs.ensureMainThreadModuleRef.current = ensureMainThreadModule;

  const loadModule = useCallback(
    createLoadModule(refs, setStatus, processModuleData),
    [processModuleData],
  );

  const updateUI = useCallback(
    createUpdateUI({
      refs,
      setters,
      activeEngine,
      kickTrigger,
      grooveAmount,
    }),
    [activeEngine, kickTrigger, grooveAmount],
  );
  refs.updateUIRef.current = updateUI;

  const play = useCallback(async (options?: { forceModuleLoad?: boolean }) => {
    const audioRefs: AudioGraphRefs = {
      libopenmptRef: refs.libopenmptRef,
      fileDataRef: refs.fileDataRef,
      audioContextRef: refs.audioContextRef,
      workletLoadedRef: refs.workletLoadedRef,
      stereoPannerRef: refs.stereoPannerRef,
      gainNodeRef: refs.gainNodeRef,
      analyserRef: refs.analyserRef,
      audioWorkletNodeRef: refs.audioWorkletNodeRef,
      nativeEngineRef: refs.nativeEngineRef,
      wasmMemoryRef: refs.wasmMemoryRef,
      workletOrderRef: refs.workletOrderRef,
      workletRowRef: refs.workletRowRef,
      workletTimeRef: refs.workletTimeRef,
      lastWorkletUpdateRef: refs.lastWorkletUpdateRef,
      workletBpmRef: refs.workletBpmRef,
      workletSpeedRef: refs.workletSpeedRef,
      workletRowsPerSecRef: refs.workletRowsPerSecRef,
      workletPositionSampleRef: refs.workletPositionSampleRef,
      pendingSeekRef: refs.pendingSeekRef,
      seekAcknowledgedRef: refs.seekAcknowledgedRef,
      workletTimestampRef: refs.workletTimestampRef,
      spFallbackTriggered: refs.spFallbackTriggered,
      scriptProcessorRef: refs.scriptProcessorRef,
      spLeftBufPtr: refs.spLeftBufPtr,
      spRightBufPtr: refs.spRightBufPtr,
      isPlayingRef: refs.isPlayingRef,
      animationFrameHandle: refs.animationFrameHandle,
      currentModulePtr: refs.currentModulePtr,
      channelStatesRef: refs.channelStatesRef,
      patternMatricesRef: refs.patternMatricesRef,
      audioClockStartRef: refs.audioClockStartRef,
      workletTimeAtStartRef: refs.workletTimeAtStartRef,
      driftAccumulatorRef: refs.driftAccumulatorRef,
      updateUIRef: refs.updateUIRef,
      nativeSharedBuffer: refs.nativeSharedBufferRef,
      nativeClockAnchorRef: refs.nativeClockAnchorRef,
      nativeBridgeLatencyRef: refs.nativeBridgeLatencyRef,
      ensureMainThreadModuleRef: refs.ensureMainThreadModuleRef,
      workletModuleTokenRef: refs.workletModuleTokenRef,
      lastWorkletModuleTokenSentRef: refs.lastWorkletModuleTokenSentRef,
    };
    const audioCbs: AudioGraphCallbacks = {
      setStatus,
      setIsPlaying,
      setActiveEngine,
      setModuleInfo,
      setSequencerMatrix,
      stopMusic,
      seekToStepWrapper,
      updateUI,
    };
    const audioConfig: AudioGraphConfig = {
      activeEngine,
      isWorkletSupported,
      isNativeWorkletAvailable,
      panValue,
      volume,
      isLooping,
      WORKLET_URL,
      ...(options?.forceModuleLoad ? { forceModuleLoad: true } : {}),
    };
    await startAudioPlayback(audioRefs, audioCbs, audioConfig);
    requestOscBuffer();
  }, [
    activeEngine, isWorkletSupported, isNativeWorkletAvailable, panValue, volume, isLooping,
    stopMusic, seekToStepWrapper, updateUI, requestOscBuffer,
    setStatus, setIsPlaying, setActiveEngine, setModuleInfo, setSequencerMatrix,
  ]);

  refs.playRef.current = play;

  const toggleAudioEngine = useCallback(() => {
    let newEngine: 'worklet' | 'native-worklet';
    if (activeEngine === 'native-worklet') {
      newEngine = 'worklet';
    } else {
      newEngine = isNativeWorkletAvailable ? 'native-worklet' : 'worklet';
    }

    writeStoredAudioEngineOverride(overrideFromActiveEngine(newEngine));

    console.log('[toggleEngine]', {
      from: activeEngine,
      to: newEngine,
      isNativeAvailable: isNativeWorkletAvailable,
      isWorkletSupported,
      willRestart: isPlaying,
    });

    if (isPlaying) {
      setRestartPlayback(true);
      stopMusic(false);
    }
    setActiveEngine(newEngine);
    setWorkletLoadError(null);
  }, [activeEngine, isPlaying, isNativeWorkletAvailable, isWorkletSupported, stopMusic, setActiveEngine, setWorkletLoadError, setRestartPlayback]);

  useEffect(() => {
    refs.audioWorkletNodeRef.current?.port.postMessage(postSetAudioLite(liteMode));
  }, [liteMode]);

  useEffect(() => {
    if (restartPlayback) {
      setRestartPlayback(false);
      void play();
    }
  }, [restartPlayback, play, setRestartPlayback]);

  useEffect(() => {
    void runLibOpenMPTInit({
      refs,
      setters,
      checkWorkletSupport,
      verifyWorkletFile,
    });
    return () => cleanupLibOpenMPT(refs);
  }, []);

  useEffect(() => {
    _setVolume(initialVolume);
  }, [initialVolume]);

  useEffect(() => {
    applyMasterLevels(
      { gainNodeRef: refs.gainNodeRef, stereoPannerRef: refs.stereoPannerRef },
      volume,
      panValue,
    );
    if (refs.nativeEngineRef.current) {
      refs.nativeEngineRef.current.setVolume(volume);
    }
  }, [volume, panValue]);

  const applyMasterLevelsNow = useCallback((vol: number, pan: number) => {
    applyMasterLevels(
      { gainNodeRef: refs.gainNodeRef, stereoPannerRef: refs.stereoPannerRef },
      vol,
      pan,
    );
    if (refs.nativeEngineRef.current) {
      refs.nativeEngineRef.current.setVolume(vol);
    }
  }, []);

  const replacePatternMatrix = useCallback((matrix: PatternMatrix) => {
    const order = matrix.order;
    if (order >= 0 && order < refs.patternMatricesRef.current.length) {
      const nextMatrices = [...refs.patternMatricesRef.current];
      nextMatrices[order] = matrix;
      refs.patternMatricesRef.current = nextMatrices;
    }
    setSequencerMatrix(matrix);
  }, [setSequencerMatrix]);

  const getModuleFileData = useCallback((): Uint8Array | null => {
    return refs.fileDataRef.current ? refs.fileDataRef.current.slice() : null;
  }, []);

  const toggleChannelMute = useCallback((channelIndex: number) => {
    setChannelStates((prev) => {
      const next = [...prev];
      const existing = next[channelIndex];
      if (!existing) return prev;
      const muted = (existing.isMuted ?? 0) > 0 ? 0 : 1;
      next[channelIndex] = { ...existing, isMuted: muted };
      refs.channelStatesRef.current[channelIndex] = next[channelIndex]!;
      return next;
    });
  }, [setChannelStates]);

  useEffect(() => {
    if (isReady && !refs.userModuleLoadedRef.current && !hasShareModuleIntent()) {
      const loadDefault = async () => {
        const fileName = DEFAULT_MODULE_URL.split('/').pop() || 'default.mod';
        setStatus(`Fetching "${fileName}"...`);
        try {
          const response = await fetch(DEFAULT_MODULE_URL);
          if (!response.ok) throw new Error(`Failed to fetch module: ${response.statusText}`);
          const arrayBuffer = await response.arrayBuffer();
          const fileData = new Uint8Array(arrayBuffer);
          await processModuleData(fileData, fileName);
        } catch (e) {
          console.error('Failed to load default module:', e);
          setStatus('Error fetching default module. See console.');
        }
      };
      void loadDefault();
    }
  }, [isReady, processModuleData, setStatus]);

  return {
    status, isReady, isPlaying, isModuleLoaded, moduleInfo, patternData,
    loadFile: loadModule, play, stopMusic, sequencerMatrix, sequencerCurrentRow, sequencerGlobalRow,
    totalPatternRows, playbackSeconds, playbackRowFraction, setPlaybackRowFraction, channelStates, beatPhase, grooveAmount, kickTrigger, activeChannels,
    instrumentNames,
    instrumentTable,
    moduleComments,
    isLooping, setIsLooping, seekToStep: seekToStepWrapper, panValue, setPanValue,
    activeEngine, isWorkletSupported, toggleAudioEngine, syncDebug,
    analyserNode: refs.analyserRef.current,
    replacePatternMatrix,
    moduleDurationSeconds,
    moduleFileName,
    getModuleFileData,
    toggleChannelMute,
    getAudioContext: () => refs.audioContextRef.current,
    getAudioTapNode: () => refs.stereoPannerRef.current ?? refs.gainNodeRef.current,
    getMasterGainValue: () => refs.gainNodeRef.current?.gain.value ?? null,
    getMasterPanValue: () => refs.stereoPannerRef.current?.pan.value ?? null,
    applyMasterLevels: applyMasterLevelsNow,
    playbackStateRef: refs.playbackStateRef,
    channelStatesRef: refs.channelStatesRef,
    workletLoadError,
    oscBufferRef: refs.oscBufferRef,
    audioReactiveRef: refs.audioReactiveRef,
    requestOscBuffer,
  };
}
