import { Suspense } from 'react';
import { App3DView, App3DLoadingFallback } from './App3DViewLazy';
import type { AppTheme } from '../appConfig';
import type { PatternMatrix, ChannelShadowState, PlaybackState, SyncDebugInfo, MediaItem } from '../types';
import type { BloomPreset, ColorScheme } from '../types/bloomPresets';

export interface App3DModeShellProps {
  isDarkMode: boolean;
  viewMode: 'device' | 'wall';
  setViewMode: (mode: 'device' | 'wall') => void;
  setIs3DMode: (v: boolean) => void;
  setTheme: (theme: AppTheme) => void;
  dimFactor: number;
  status: string;
  isModuleLoaded: boolean;
  syncDebug: SyncDebugInfo;
  sequencerMatrix: PatternMatrix | null;
  playbackRowFraction: number;
  isPlaying: boolean;
  playbackSeconds: number;
  channelStates: ChannelShadowState[];
  beatPhase: number;
  grooveAmount: number;
  kickTrigger: number;
  activeChannels: number[];
  volume: number;
  pan: number;
  isLooping: boolean;
  totalPatternRows: number;
  play: () => void;
  stopMusic: (v: boolean) => void;
  seekToStep: (step: number) => void;
  setIsLooping: (v: boolean | ((prev: boolean) => boolean)) => void;
  setVolume: (v: number | ((prev: number) => number)) => void;
  setPan: (v: number) => void;
  handleFileSelected: (file: File) => void;
  handleMediaAdd: (file: File) => void;
  handleRemoteMediaSelect: (item: MediaItem) => void;
  analyserNode: AnalyserNode | null;
  debugPanelOpen: boolean;
  setDebugPanelOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  playbackStateRef: React.MutableRefObject<PlaybackState>;
  channelStatesRef: React.MutableRefObject<ChannelShadowState[]>;
  oscBufferRef: React.MutableRefObject<Float32Array | null>;
  bloomPreset: BloomPreset;
  setBloomPreset: (v: BloomPreset) => void;
  colorScheme: ColorScheme;
  setColorScheme: (v: ColorScheme) => void;
  mediaItem: MediaItem | null;
  mediaVisible: boolean;
  setMediaVisible: (v: boolean) => void;
  setMediaItem: (item: MediaItem | null) => void;
  mediaFades: { in: number; out: number };
  isReady: boolean;
  cheatsheetOpen: boolean;
  setCheatsheetOpen: (v: boolean) => void;
}

export function App3DModeShell(props: App3DModeShellProps) {
  return (
    <Suspense fallback={<App3DLoadingFallback />}>
      <App3DView {...props} />
    </Suspense>
  );
}
