import React from 'react';
import { cn } from '../utils/cn';
import { Studio3D } from './Studio3D';
import { Header } from './Header';
import { PatternDisplay } from './PatternDisplay';
import { Controls } from './Controls';
import { MediaOverlay } from './MediaOverlay';
import { KeyboardShortcutHelp } from './KeyboardShortcutHelp';
import type { AppTheme } from '../appConfig';
import type { PatternMatrix, ChannelShadowState, PlaybackState, SyncDebugInfo, MediaItem } from '../types';
import type { BloomPreset, ColorScheme } from '../types/bloomPresets';

interface App3DViewProps {
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
  mediaFades?: { in: number; out: number };
  setMediaVisible: (v: boolean) => void;
  setMediaItem: (item: MediaItem | null) => void;
  isReady: boolean;
  cheatsheetOpen: boolean;
  setCheatsheetOpen: (v: boolean) => void;
}

export function App3DView({
  isDarkMode,
  viewMode,
  setViewMode,
  setIs3DMode,
  setTheme,
  dimFactor,
  status,
  isModuleLoaded,
  syncDebug,
  sequencerMatrix,
  playbackRowFraction,
  isPlaying,
  playbackSeconds,
  channelStates,
  beatPhase,
  grooveAmount,
  kickTrigger,
  activeChannels,
  volume,
  pan,
  isLooping,
  totalPatternRows,
  play,
  stopMusic,
  seekToStep,
  setIsLooping,
  setVolume,
  setPan,
  handleFileSelected,
  handleMediaAdd,
  handleRemoteMediaSelect,
  analyserNode,
  debugPanelOpen,
  setDebugPanelOpen,
  playbackStateRef,
  channelStatesRef,
  oscBufferRef,
  bloomPreset,
  setBloomPreset,
  colorScheme,
  setColorScheme,
  mediaItem,
  mediaVisible,
  setMediaVisible,
  setMediaItem,
  mediaFades,
  isReady,
  cheatsheetOpen,
  setCheatsheetOpen,
}: App3DViewProps) {
  const shader3D = viewMode === 'wall' ? 'patternv0.21.wgsl' : 'patternv0.38.wgsl';

  return (
    <>
      <Studio3D
        darkMode={isDarkMode}
        viewMode={viewMode}
        onDarkModeToggle={() => setTheme(isDarkMode ? 'light' : 'dark')}
        onViewModeToggle={() => setViewMode(viewMode === 'device' ? 'wall' : 'device')}
        onExitStudio={() => setIs3DMode(false)}
        dimFactor={dimFactor}
        headerContent={
          <div className="scale-75 origin-top-left">
          <Header status={status} isModuleLoaded={isModuleLoaded} />
          {/* === AUDIO ENGINE DIAGNOSTICS === */}
          <div className={cn("debug-section audio-diagnostics mb-2 inline-flex flex-col rounded border px-2 py-1 text-[10px] font-mono", isDarkMode ? "border-gray-700 bg-black/50 text-gray-300" : "border-gray-300 bg-white/80 text-gray-700")}>
            <h4 className="m-0 mb-1 border-b pb-1 font-bold">🎛️ Audio Engine</h4>
            <div className="debug-grid grid grid-cols-2 gap-x-4 gap-y-1">
              <div><strong>Context:</strong> {syncDebug.audioContextState}</div>
              <div><strong>Sample Rate:</strong> {syncDebug.sampleRate} Hz</div>
              <div><strong>Base Latency:</strong> {syncDebug.baseLatency.toFixed(2)} ms</div>
              <div><strong>Output Latency:</strong> {syncDebug.outputLatency.toFixed(2)} ms</div>
              <div><strong>Drift:</strong> {syncDebug.driftMs} ms <span style={{color: Math.abs(syncDebug.driftAccumulator) > 0.008 ? "#ff4444" : "#44ff88"}}>({syncDebug.driftAccumulator.toFixed(4)})</span></div>
              <div><strong>Last Corrected:</strong> {syncDebug.lastCorrectedTime.toFixed(3)} s</div>
              <div><strong>Last Worklet Update:</strong> {syncDebug.lastWorkletUpdate.toFixed(3)} s</div>
              <div><strong>Seek Pending:</strong> <span style={{color: syncDebug.seekPending ? "#ffaa00" : "#44ff88"}}>{syncDebug.seekPending ? "YES" : "No"}</span></div>
              <div><strong>Buffer:</strong> {(syncDebug.bufferMs / 1000).toFixed(2)} s</div>
              <div><strong>Starvation Count:</strong> {syncDebug.starvationCount}</div>
            </div>
          </div>
          </div>
        }
        patternDisplayContent={
          <div className="scale-75 origin-center">
            <PatternDisplay
              key={shader3D}
              matrix={sequencerMatrix}
              playheadRow={playbackRowFraction}
              isPlaying={isPlaying}
              bpm={120}
              timeSec={playbackSeconds}
              tickOffset={playbackRowFraction % 1}
              channels={channelStates}
              beatPhase={beatPhase}
              grooveAmount={grooveAmount}
              kickTrigger={kickTrigger}
              activeChannels={activeChannels}
              isModuleLoaded={isModuleLoaded}
              shaderFile={shader3D}
              volume={volume}
              pan={pan}
              isLooping={isLooping}
              totalRows={totalPatternRows}
              onPlay={play}
              onStop={() => stopMusic(false)}
              onFileSelected={handleFileSelected}
              onLoopToggle={() => setIsLooping(!isLooping)}
              onSeek={(row) => seekToStep(row)}
              onVolumeChange={setVolume}
              onPanChange={setPan}
              externalVideoSource={null}
              dimFactor={dimFactor}
              analyserNode={analyserNode}
              debugPanelOpen={debugPanelOpen}
              onCloseDebug={() => setDebugPanelOpen(false)}
              onOpenDebug={() => setDebugPanelOpen(true)}
              // PERFORMANCE OPTIMIZATION: Pass ref for high-frequency updates
              playbackStateRef={playbackStateRef}
              channelStatesRef={channelStatesRef}
              oscBufferRef={oscBufferRef}
              // Bloom settings from preset
              bloomIntensity={bloomPreset.intensity}
              bloomThreshold={bloomPreset.threshold}
            />
          </div>
        }
        controlsContent={
          <div className="scale-75 origin-top-left">
            <Controls
              isReady={isReady}
              isPlaying={isPlaying}
              isModuleLoaded={isModuleLoaded}
              onFileSelected={handleFileSelected}
              onPlay={play}
              onStop={() => stopMusic(false)}
              isLooping={isLooping}
              onLoopToggle={() => setIsLooping(!isLooping)}
              volume={volume}
              setVolume={setVolume}
              pan={pan}
              setPan={setPan}
              onMediaAdd={handleMediaAdd}
              onRemoteMediaSelect={handleRemoteMediaSelect}
              remoteMediaList={[
                { id: '1', kind: 'video', url: 'clouds.mp4', fileName: 'Clouds Demo (MP4)', mimeType: 'video/mp4' }
              ]}
              bloomPreset={bloomPreset}
              onBloomPresetChange={setBloomPreset}
              colorScheme={colorScheme}
              onColorSchemeChange={setColorScheme}
            />
          </div>
        }
        mediaOverlayContent={
          mediaVisible && mediaItem ? (
            <div className="scale-75 origin-center">
              <MediaOverlay
                item={mediaItem}
                visible={mediaVisible}
                fadeInMs={mediaFades?.in}
                fadeOutMs={mediaFades?.out}
                onClose={() => setMediaVisible(false)}
                onUpdate={(partial) => {
                  if (mediaItem) setMediaItem({ ...mediaItem, ...partial });
                }}
              />
            </div>
          ) : undefined
        }
        playheadX={playbackSeconds * 10.0}
        channels={channelStates}
      />
      {cheatsheetOpen && <KeyboardShortcutHelp onClose={() => setCheatsheetOpen(false)} />}
    </>
  );
}
