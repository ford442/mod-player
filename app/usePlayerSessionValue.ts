import { useMemo } from 'react';
import type { PlayerSessionValue } from '../context/PlayerSessionContext';
import type { ModuleMetadata } from '../components/MetadataPanel';
import type { ChannelShadowState, PatternMatrix, PlaybackState } from '../types';
import type { InstrumentTable } from '../types/instruments';
import type { SyncDebugInfo } from '../types';

export interface UsePlayerSessionValueParams {
  isReady: boolean;
  isModuleLoaded: boolean;
  isPlaying: boolean;
  isLooping: boolean;
  playbackSeconds: number;
  playbackRowFraction: number;
  totalPatternRows: number;
  sequencerMatrix: PatternMatrix | null;
  channelStates: ChannelShadowState[];
  beatPhase: number;
  grooveAmount: number;
  kickTrigger: number;
  activeChannels: number[];
  volume: number;
  pan: number;
  status: string;
  activeEngine: string;
  isWorkletSupported: boolean;
  syncDebug: SyncDebugInfo;
  workletLoadError: string | null | undefined;
  analyserNode: AnalyserNode | null;
  channelVU: Float32Array | null;
  moduleMetadata: ModuleMetadata | null;
  moduleFileName: string;
  moduleDurationSeconds: number;
  instrumentTable: InstrumentTable;
  channelMuteMask: boolean[];
  displayShaderFile: string;
  instrumentPalette: Uint8Array;
  dimFactor: number;
  isNightShader: boolean;
  isStepsShader: boolean;
  nightConfig: PlayerSessionValue['nightConfig'];
  playbackStateRef: React.MutableRefObject<PlaybackState>;
  channelStatesRef: React.MutableRefObject<ChannelShadowState[]>;
  oscBufferRef: React.MutableRefObject<Float32Array | null>;
  audioReactiveRef: React.MutableRefObject<Float32Array | null>;
  playGuarded: () => void;
  stopMusic: (destroy?: boolean) => void;
  seekToStep: (step: number) => void;
  setIsLooping: (v: boolean | ((prev: boolean) => boolean)) => void;
  setVolume: (v: number | ((prev: number) => number)) => void;
  setPan: (v: number) => void;
  handleFileSelected: (file: File) => void;
  toggleAudioEngine: () => void;
  toggleChannelMute: (channel: number) => void;
}

export function usePlayerSessionValue(params: UsePlayerSessionValueParams): PlayerSessionValue {
  const {
    isReady,
    isModuleLoaded,
    isPlaying,
    isLooping,
    playbackSeconds,
    playbackRowFraction,
    totalPatternRows,
    sequencerMatrix,
    channelStates,
    beatPhase,
    grooveAmount,
    kickTrigger,
    activeChannels,
    volume,
    pan,
    status,
    activeEngine,
    isWorkletSupported,
    syncDebug,
    workletLoadError,
    analyserNode,
    channelVU,
    moduleMetadata,
    moduleFileName,
    moduleDurationSeconds,
    instrumentTable,
    channelMuteMask,
    displayShaderFile,
    instrumentPalette,
    dimFactor,
    isNightShader,
    isStepsShader,
    nightConfig,
    playbackStateRef,
    channelStatesRef,
    oscBufferRef,
    audioReactiveRef,
    playGuarded,
    stopMusic,
    seekToStep,
    setIsLooping,
    setVolume,
    setPan,
    handleFileSelected,
    toggleAudioEngine,
    toggleChannelMute,
  } = params;

  return useMemo((): PlayerSessionValue => ({
    isReady,
    isModuleLoaded,
    isPlaying,
    isLooping,
    playbackSeconds,
    playbackRowFraction,
    totalPatternRows,
    sequencerMatrix,
    channelStates,
    beatPhase,
    grooveAmount,
    kickTrigger,
    activeChannels,
    volume,
    pan,
    status,
    activeEngine,
    isWorkletSupported,
    syncDebug,
    workletLoadError,
    analyserNode,
    channelVU,
    moduleMetadata,
    moduleFileName,
    moduleDurationSeconds,
    instrumentTable,
    channelMuteMask,
    displayShaderFile,
    instrumentPalette,
    dimFactor,
    isNightShader,
    isStepsShader,
    nightConfig,
    playbackStateRef,
    channelStatesRef,
    oscBufferRef,
    audioReactiveRef,
    play: playGuarded,
    stopMusic,
    seekToStep,
    setIsLooping,
    setVolume,
    setPan,
    handleFileSelected,
    toggleAudioEngine,
    toggleChannelMute,
  }), [
    isReady, isModuleLoaded, isPlaying, isLooping, playbackSeconds, playbackRowFraction,
    totalPatternRows, sequencerMatrix, channelStates, beatPhase, grooveAmount, kickTrigger,
    activeChannels, volume, pan, status, activeEngine, isWorkletSupported, syncDebug, workletLoadError,
    analyserNode, channelVU, moduleMetadata, moduleFileName, moduleDurationSeconds,
    instrumentTable, channelMuteMask, displayShaderFile, instrumentPalette, dimFactor, isNightShader,
    isStepsShader, nightConfig, playbackStateRef, channelStatesRef, oscBufferRef,
    audioReactiveRef, playGuarded, stopMusic, seekToStep, setIsLooping, setVolume, setPan,
    handleFileSelected, toggleAudioEngine, toggleChannelMute,
  ]);
}
