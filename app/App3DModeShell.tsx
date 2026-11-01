import { Suspense } from 'react';
import { App3DView, App3DLoadingFallback } from './App3DViewLazy';
import type { MediaItem } from '../types';
import { usePlayerEngine } from '../hooks/usePlayerEngine';
import { useDisplayShader, usePlayerActions } from '../hooks/usePlayerView';
import { usePlayerUiStore } from '../store/playerUiStore';
import { useShaderPrefsStore } from '../store/shaderPrefsStore';

/** App-owned state the 3D studio needs; the player and UI-store state it selects itself (#492). */
export interface App3DModeShellProps {
  viewMode: 'device' | 'wall';
  setViewMode: (mode: 'device' | 'wall') => void;
  setIs3DMode: (v: boolean) => void;
  handleFileSelected: (file: File) => void;
  handleMediaAdd: (file: File) => void;
  handleRemoteMediaSelect: (item: MediaItem) => void;
  /** See App3DViewProps.onStudioDisplayHostChange — teleports PatternDisplay in, never remounts it. */
  onStudioDisplayHostChange: (node: HTMLDivElement | null) => void;
  mediaItem: MediaItem | null;
  mediaVisible: boolean;
  setMediaVisible: (v: boolean) => void;
  setMediaItem: (item: MediaItem | null) => void;
  mediaFades: { in: number; out: number };
}

export function App3DModeShell(props: App3DModeShellProps) {
  const status = usePlayerEngine((s) => s.status);
  const isReady = usePlayerEngine((s) => s.isReady);
  const isModuleLoaded = usePlayerEngine((s) => s.isModuleLoaded);
  const syncDebug = usePlayerEngine((s) => s.syncDebug);
  const isPlaying = usePlayerEngine((s) => s.isPlaying);
  const isPaused = usePlayerEngine((s) => s.isPaused);
  const playbackSeconds = usePlayerEngine((s) => s.playbackSeconds);
  const channelStates = usePlayerEngine((s) => s.channelStates);
  const volume = usePlayerEngine((s) => s.volume);
  const pan = usePlayerEngine((s) => s.pan);
  const isLooping = usePlayerEngine((s) => s.isLooping);
  const { play, pause, stopMusic, setIsLooping, setVolume, setPan } = usePlayerActions();
  const { isDarkMode, dimFactor } = useDisplayShader();
  const setTheme = usePlayerUiStore((s) => s.setTheme);
  const cheatsheetOpen = usePlayerUiStore((s) => s.cheatsheetOpen);
  const setCheatsheetOpen = usePlayerUiStore((s) => s.setCheatsheetOpen);
  const bloomPreset = useShaderPrefsStore((s) => s.bloomPreset);
  const setBloomPreset = useShaderPrefsStore((s) => s.setBloomPreset);
  const colorScheme = useShaderPrefsStore((s) => s.colorScheme);
  const setColorScheme = useShaderPrefsStore((s) => s.setColorScheme);

  return (
    <Suspense fallback={<App3DLoadingFallback />}>
      <App3DView
        {...props}
        isDarkMode={isDarkMode}
        setTheme={setTheme}
        dimFactor={dimFactor}
        status={status}
        isModuleLoaded={isModuleLoaded}
        syncDebug={syncDebug}
        isPlaying={isPlaying}
        isPaused={isPaused}
        playbackSeconds={playbackSeconds}
        channelStates={channelStates}
        volume={volume}
        pan={pan}
        isLooping={isLooping}
        play={play}
        pause={pause}
        stopMusic={stopMusic}
        setIsLooping={setIsLooping}
        setVolume={setVolume}
        setPan={setPan}
        bloomPreset={bloomPreset}
        setBloomPreset={setBloomPreset}
        colorScheme={colorScheme}
        setColorScheme={setColorScheme}
        isReady={isReady}
        cheatsheetOpen={cheatsheetOpen}
        setCheatsheetOpen={setCheatsheetOpen}
      />
    </Suspense>
  );
}
