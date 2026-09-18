import { cn } from '../utils/cn';
import { Studio3D } from './Studio3D';
import { Header } from './Header';
import { Controls } from './Controls';
import { MediaOverlay } from './MediaOverlay';
import { KeyboardShortcutHelp } from './KeyboardShortcutHelp';
import type { AppTheme } from '../appConfig';
import type { ChannelShadowState, SyncDebugInfo, MediaItem } from '../types';
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
  /**
   * Ref callback for the 3D pattern-display panel's host div. PerformanceStage
   * teleports the *same* PatternDisplay instance (and WebGPU device) into
   * this node instead of App3DView constructing a second one — see Problem A
   * in the WebGPU teardown/init unification effort.
   */
  onStudioDisplayHostChange: (node: HTMLDivElement | null) => void;
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
  isPlaying,
  playbackSeconds,
  channelStates,
  volume,
  pan,
  isLooping,
  play,
  stopMusic,
  setIsLooping,
  setVolume,
  setPan,
  handleFileSelected,
  handleMediaAdd,
  handleRemoteMediaSelect,
  onStudioDisplayHostChange,
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
              {syncDebug.sampleRow != null && (
                <>
                  <div><strong>Sample Row:</strong> {syncDebug.sampleRow.toFixed(3)}</div>
                  <div><strong>Predicted Row:</strong> {syncDebug.predictedRow?.toFixed(3) ?? '—'}</div>
                  <div><strong>Smoothed Row:</strong> {syncDebug.smoothedRow?.toFixed(3) ?? '—'}</div>
                  <div><strong>Lag Rows:</strong> {syncDebug.predictionLagRows?.toFixed(3) ?? '—'}</div>
                </>
              )}
              <div><strong>Last Corrected:</strong> {syncDebug.lastCorrectedTime.toFixed(3)} s</div>
              <div><strong>Last Worklet Update:</strong> {syncDebug.lastWorkletUpdate.toFixed(3)} s</div>
              <div><strong>Seek Pending:</strong> <span style={{color: syncDebug.seekPending ? "#ffaa00" : "#44ff88"}}>{syncDebug.seekPending ? "YES" : "No"}</span></div>
              <div><strong>Buffer:</strong> {(syncDebug.bufferMs / 1000).toFixed(2)} s</div>
              <div><strong>Starvation Count:</strong> {syncDebug.starvationCount}</div>
            </div>
          </div>
          </div>
        }
        onPatternHostRef={onStudioDisplayHostChange}
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
