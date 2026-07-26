import React, { createContext, useContext } from 'react';
import type { ModuleMetadata } from '../components/MetadataPanel';
import type { InstrumentTable } from '../types/instruments';
import type { ChannelShadowState, PatternMatrix, PlaybackState, SyncDebugInfo } from '../types';

/** Playback + visualization session — refs stay on mutable objects, not Zustand. */
export interface PlayerSessionValue {
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
  nightConfig: {
    bloomIntensity: number;
    dimFactor: number;
    vignetteStrength: number;
    filmGrain: number;
    invertMix: number;
    presetIndex: number;
  };
  playbackStateRef: React.MutableRefObject<PlaybackState>;
  channelStatesRef: React.MutableRefObject<ChannelShadowState[]>;
  oscBufferRef: React.MutableRefObject<Float32Array | null>;
  audioReactiveRef: React.MutableRefObject<Float32Array | null>;
  play: () => void;
  stopMusic: (destroy?: boolean) => void;
  seekToStep: (step: number) => void;
  setIsLooping: (v: boolean | ((prev: boolean) => boolean)) => void;
  setVolume: (v: number | ((prev: number) => number)) => void;
  setPan: (v: number) => void;
  handleFileSelected: (file: File) => void;
  toggleAudioEngine: () => void;
  toggleChannelMute: (channel: number) => void;
}

const PlayerSessionContext = createContext<PlayerSessionValue | null>(null);

export function PlayerSessionProvider({
  value,
  children,
}: {
  value: PlayerSessionValue;
  children: React.ReactNode;
}) {
  return <PlayerSessionContext.Provider value={value}>{children}</PlayerSessionContext.Provider>;
}

export function usePlayerSession(): PlayerSessionValue {
  const ctx = useContext(PlayerSessionContext);
  if (!ctx) {
    throw new Error('usePlayerSession must be used within PlayerSessionProvider');
  }
  return ctx;
}
