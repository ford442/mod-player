import { Suspense } from 'react';
import { App3DView, App3DLoadingFallback } from './App3DViewLazy';
import type { AppTheme } from '../appConfig';
import type { ChannelShadowState, SyncDebugInfo, MediaItem } from '../types';
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
  isPlaying: boolean;
  playbackSeconds: number;
  channelStates: ChannelShadowState[];
  volume: number;
  pan: number;
  isLooping: boolean;
  play: () => void;
  stopMusic: (v: boolean) => void;
  setIsLooping: (v: boolean | ((prev: boolean) => boolean)) => void;
  setVolume: (v: number | ((prev: number) => number)) => void;
  setPan: (v: number) => void;
  handleFileSelected: (file: File) => void;
  handleMediaAdd: (file: File) => void;
  handleRemoteMediaSelect: (item: MediaItem) => void;
  /** See App3DViewProps.onStudioDisplayHostChange — teleports PatternDisplay in, never remounts it. */
  onStudioDisplayHostChange: (node: HTMLDivElement | null) => void;
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
