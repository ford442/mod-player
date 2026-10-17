import { useEffect, useMemo } from 'react';
import type { PatternMatrix } from '../types';
import { usePlayerEngine, usePlayerEngineInstance } from './usePlayerEngine';
import { useLibOpenMPTRefs } from './libOpenMPT/useLibOpenMPTRefs';

/**
 * Thin adapter over the PlayerEngine (#492; see audio/engine/PlayerEngine.ts). It ties the engine's
 * lifecycle to the component that mounts the player (init on mount, dispose on unmount) and returns
 * the pre-#492 shape so callers can migrate to `usePlayerEngine(selector)` one at a time.
 *
 * Note the full-snapshot subscription: a caller of this hook re-renders on every snapshot change,
 * exactly as it did when this hook held the state itself. Components that only need a few fields
 * should select them instead.
 */
export function useLibOpenMPT(liteMode: boolean = false) {
  const engine = usePlayerEngineInstance();
  const s = usePlayerEngine((snapshot) => snapshot);
  const { playbackStateRef, channelStatesRef, oscBufferRef, audioReactiveRef } = useLibOpenMPTRefs();

  useEffect(() => {
    void engine.init();
    return () => engine.dispose();
  }, [engine]);

  useEffect(() => {
    engine.setLiteMode(liteMode);
  }, [engine, liteMode]);

  // Stable for the engine's lifetime: callers put these in effect / callback deps.
  const actions = useMemo(() => ({
    loadFile: (fileData: Uint8Array, fileName: string) => engine.loadFile(fileData, fileName),
    play: (options?: { forceModuleLoad?: boolean }) => engine.play(options),
    stopMusic: (destroy?: boolean) => engine.stop(destroy),
    pause: () => engine.pause(),
    resume: () => engine.resume(),
    togglePlayPause: () => engine.togglePlayPause(),
    seekToStep: (step: number) => engine.seekToStep(step),
    setIsLooping: (value: boolean | ((previous: boolean) => boolean)) => engine.setLooping(value),
    setPanValue: (value: number | ((previous: number) => number)) => engine.setMasterPan(value),
    setPlaybackRowFraction: (value: number) => engine.setPlayheadForTest(value),
    toggleAudioEngine: () => engine.toggleAudioEngine(),
    replacePatternMatrix: (matrix: PatternMatrix) => engine.replacePatternMatrix(matrix),
    getModuleFileData: () => engine.getModuleFileData(),
    toggleChannelMute: (channelIndex: number) => engine.toggleChannelMute(channelIndex),
    getAudioContext: () => engine.getAudioContext(),
    getAudioTapNode: () => engine.getAudioTapNode(),
    getMasterGainValue: () => engine.getMasterGainValue(),
    getMasterPanValue: () => engine.getMasterPanValue(),
    applyMasterLevels: (volume: number, pan: number) => {
      engine.setMasterVolume(volume);
      engine.setMasterPan(pan);
    },
    requestOscBuffer: () => engine.requestOscBuffer(),
  }), [engine]);

  return {
    status: s.status,
    isReady: s.isReady,
    isPlaying: s.isPlaying,
    isPaused: s.isPaused,
    isModuleLoaded: s.isModuleLoaded,
    moduleInfo: s.moduleInfo,
    transportState: s.transportState,
    sequencerMatrix: s.sequencerMatrix,
    sequencerCurrentRow: s.sequencerCurrentRow,
    sequencerGlobalRow: s.sequencerGlobalRow,
    totalPatternRows: s.totalPatternRows,
    playbackSeconds: s.playbackSeconds,
    playbackRowFraction: s.playbackRowFraction,
    channelStates: s.channelStates,
    beatPhase: s.beatPhase,
    grooveAmount: 0,
    kickTrigger: 0,
    activeChannels: NO_ACTIVE_CHANNELS,
    instrumentNames: s.instrumentNames,
    sampleNames: s.sampleNames,
    moduleFormat: s.moduleFormat,
    instrumentTable: s.instrumentTable,
    moduleComments: s.moduleComments,
    isLooping: s.isLooping,
    panValue: s.pan,
    activeEngine: s.activeEngine,
    isWorkletSupported: s.isWorkletSupported,
    syncDebug: s.syncDebug,
    analyserNode: s.analyserNode,
    moduleDurationSeconds: s.moduleDurationSeconds,
    moduleFileName: s.moduleFileName,
    workletLoadError: s.workletLoadError,
    playbackStateRef,
    channelStatesRef,
    oscBufferRef,
    audioReactiveRef,
    ...actions,
  };
}

const NO_ACTIVE_CHANNELS: number[] = [];
