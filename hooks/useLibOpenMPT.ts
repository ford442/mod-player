import { useCallback, useEffect, useState } from 'react';
import type { PatternMatrix } from '../types';
import { startAudioPlayback, type AudioGraphCallbacks, type AudioGraphConfig, type AudioGraphRefs } from './useAudioGraph';
import { useWorkletLoader } from './useWorkletLoader';
import { postSetAudioLite } from '../audio-worklet/protocol';
import { hasShareModuleIntent } from '../utils/shareState';
import { deriveTransportState, playShouldResume } from '../utils/transportClock';
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
  createPauseMusic,
  createRequestOscBuffer,
  createResumeMusic,
  createSeekToStep,
  createStopMusic,
} from './libOpenMPT/createTransportActions';
import { cleanupLibOpenMPT, runLibOpenMPTInit } from './libOpenMPT/runInit';

export function useLibOpenMPT(initialVolume: number = 0.4, liteMode: boolean = false) {
  const state = useLibOpenMPTState(initialVolume);
  const refs = useLibOpenMPTRefs();

  const {
    status, isReady, isPlaying, isPaused, isModuleLoaded, moduleInfo, patternData,
    sequencerMatrix, sequencerCurrentRow, sequencerGlobalRow, totalPatternRows,
    playbackSeconds, playbackRowFraction, channelStates, beatPhase, grooveAmount,
    kickTrigger, activeChannels, isLooping, panValue, volume,
    isWorkletSupported, syncDebug,
    workletLoadError, instrumentNames, sampleNames, moduleFormat, instrumentTable, moduleComments,
    moduleDurationSeconds, moduleFileName,
    setStatus, setIsPlaying, setIsPaused, setIsModuleLoaded, setModuleInfo, setSequencerMatrix,
    setInstrumentNames, setSampleNames, setModuleFormat, setInstrumentTable, setModuleComments, setModuleDurationSeconds,
    setModuleFileName, setSequencerCurrentRow, setSequencerGlobalRow, setPlaybackSeconds,
    setPlaybackRowFraction, setTotalPatternRows, setChannelStates, setBeatPhase,
    setSyncDebug, setIsReady, setIsWorkletSupported,
    setWorkletLoadError, setIsLooping, setPanValue, _setVolume,
  } = state;

  const { verifyWorkletFile, isAudioWorkletSupported: checkWorkletSupport } = useWorkletLoader({
    debug: true,
  });

  const setters = {
    setStatus,
    setIsPlaying,
    setIsPaused,
    setIsModuleLoaded,
    setModuleInfo,
    setSequencerMatrix,
    setInstrumentNames,
    setSampleNames,
    setModuleFormat,
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
    setWorkletLoadError,
  };

  const transportDeps = { refs, setters };

  const stopMusic = useCallback(createStopMusic(transportDeps), []);
  // Stable for the component's lifetime, like stopMusic (they only touch refs and React's stable
  // setters). A lazily-initialised state value rather than useCallback(createX(deps), []), which the
  // exhaustive-deps rule flags ("dependencies are unknown") and would add to the warning budget.
  const [pauseMusic] = useState(() => createPauseMusic(transportDeps));
  const [resumeMusic] = useState(() => createResumeMusic(transportDeps));
  const [seekToStepWrapper] = useState(() => createSeekToStep(transportDeps));
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
      kickTrigger,
      grooveAmount,
    }),
    [kickTrigger, grooveAmount],
  );
  refs.updateUIRef.current = updateUI;

  const play = useCallback(async (options?: { forceModuleLoad?: boolean }) => {
    // "Play" while paused means resume, not a fresh start (see playShouldResume). A module load
    // (forceModuleLoad) is the exception: it comes up cued/paused via the engine start paths.
    if (playShouldResume(refs.isPausedRef.current, options)) {
      resumeMusic();
      return;
    }
    const audioRefs: AudioGraphRefs = {
      libopenmptRef: refs.libopenmptRef,
      fileDataRef: refs.fileDataRef,
      audioContextRef: refs.audioContextRef,
      workletLoadedRef: refs.workletLoadedRef,
      masterInputRef: refs.masterInputRef,
      masterDirectRef: refs.masterDirectRef,
      stereoPannerRef: refs.stereoPannerRef,
      gainNodeRef: refs.gainNodeRef,
      analyserRef: refs.analyserRef,
      audioWorkletNodeRef: refs.audioWorkletNodeRef,
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
      isPausedRef: refs.isPausedRef,
      playbackEngineRef: refs.playbackEngineRef,
      animationFrameHandle: refs.animationFrameHandle,
      currentModulePtr: refs.currentModulePtr,
      channelStatesRef: refs.channelStatesRef,
      patternMatricesRef: refs.patternMatricesRef,
      audioClockStartRef: refs.audioClockStartRef,
      workletTimeAtStartRef: refs.workletTimeAtStartRef,
      driftAccumulatorRef: refs.driftAccumulatorRef,
      updateUIRef: refs.updateUIRef,
      ensureMainThreadModuleRef: refs.ensureMainThreadModuleRef,
      workletModuleTokenRef: refs.workletModuleTokenRef,
      lastWorkletModuleTokenSentRef: refs.lastWorkletModuleTokenSentRef,
    };
    const audioCbs: AudioGraphCallbacks = {
      setStatus,
      setIsPlaying,
      setModuleInfo,
      setSequencerMatrix,
      stopMusic,
      seekToStepWrapper,
      updateUI,
    };
    const audioConfig: AudioGraphConfig = {
      isWorkletSupported,
      panValue,
      volume,
      isLooping,
      WORKLET_URL,
      ...(options?.forceModuleLoad ? { forceModuleLoad: true } : {}),
    };
    await startAudioPlayback(audioRefs, audioCbs, audioConfig);
    requestOscBuffer();
  }, [
    isWorkletSupported, panValue, volume, isLooping,
    stopMusic, resumeMusic, seekToStepWrapper, updateUI, requestOscBuffer,
    setStatus, setIsPlaying, setModuleInfo, setSequencerMatrix,
  ]);

  /** Space / MIDI note 60 / the play button: pause while playing, otherwise play-or-resume. */
  const togglePlayPause = useCallback(() => {
    if (refs.isPlayingRef.current) pauseMusic();
    else void play();
  }, [pauseMusic, play, refs.isPlayingRef]);

  refs.playRef.current = play;

  useEffect(() => {
    refs.audioWorkletNodeRef.current?.port.postMessage(postSetAudioLite(liteMode));
  }, [liteMode]);

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
  }, [volume, panValue]);

  const applyMasterLevelsNow = useCallback((vol: number, pan: number) => {
    applyMasterLevels(
      { gainNodeRef: refs.gainNodeRef, stereoPannerRef: refs.stereoPannerRef },
      vol,
      pan,
    );
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
    status, isReady, isPlaying, isPaused, isModuleLoaded, moduleInfo, patternData,
    transportState: deriveTransportState(isPlaying, isPaused),
    loadFile: loadModule, play, stopMusic, pause: pauseMusic, resume: resumeMusic, togglePlayPause, sequencerMatrix, sequencerCurrentRow, sequencerGlobalRow,
    totalPatternRows, playbackSeconds, playbackRowFraction, setPlaybackRowFraction, channelStates, beatPhase, grooveAmount, kickTrigger, activeChannels,
    instrumentNames,
    sampleNames,
    moduleFormat,
    instrumentTable,
    moduleComments,
    isLooping, setIsLooping, seekToStep: seekToStepWrapper, panValue, setPanValue,
    isWorkletSupported, syncDebug,
    analyserNode: refs.analyserRef.current,
    replacePatternMatrix,
    moduleDurationSeconds,
    moduleFileName,
    getModuleFileData,
    toggleChannelMute,
    getAudioContext: () => refs.audioContextRef.current,
    /** The engine rendering the current playback (null before the first play). */
    getPlaybackEngine: () => refs.playbackEngineRef.current,
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
