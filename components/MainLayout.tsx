import React from 'react';
import { Header } from './Header';
import { Controls } from './Controls';
import { PatternDisplay } from './PatternDisplay';
import { MediaOverlay } from './MediaOverlay';
import { MediaPanel, type MediaFades } from './MediaPanel';
import { KeyboardShortcutHelp } from './KeyboardShortcutHelp';
import { ChannelMeters } from './ChannelMeters';
import { MetadataPanel } from './MetadataPanel';
import type { ModuleMetadata } from './MetadataPanel';
import { Playlist } from './Playlist';
import type { PlaylistItem } from './Playlist';
import { LibraryBrowser } from './LibraryBrowser';
import { LibraryPanel } from './LibraryPanel';
import { SeekBar } from './SeekBar';
import { Panel } from './Panel';
import { ShaderSelectorPanel } from './ShaderSelectorPanel';
import { PatternEditor } from './PatternEditor';
import { MidiControlsPanel } from './MidiControlsPanel';
import { ExportPanel } from './ExportPanel';
import { cn } from '../utils/cn';
import { setLiteOverride } from '../utils/deviceCapabilities';
import { usesInstrumentPalette } from '../utils/shaderVersion';
import { IS_PUBLIC_MODE, AVAILABLE_SHADERS, THEME_OPTIONS } from '../appConfig';
import type { AppTheme } from '../appConfig';
import type { PatternMatrix, ChannelShadowState, PlaybackState, MediaItem } from '../types';
import type { BloomPreset, ColorScheme, NightPreset } from '../types/bloomPresets';
import type { RemoteSong, SongSaveRequest, ShaderMeta } from '../utils/storageApi';
import type { LibraryEntry, LibraryImportProgress, LibraryRoot } from '../types/localLibrary';
import type { PatternCellPatch, PatternEditField } from '../utils/patternEdit';
import type { useMidiControls } from '../hooks/useMidiControls';

interface MainLayoutProps {
  isDarkMode: boolean;
  theme: AppTheme;
  setTheme: (t: AppTheme) => void;
  setIs3DMode: (v: boolean) => void;
  liteMode: boolean;
  setLiteMode: (v: boolean) => void;
  reactiveMode: boolean;
  setReactiveMode: (v: boolean) => void;
  isWorkletSupported: boolean;
  workletLoadError: string | null | undefined;
  toggleAudioEngine: () => void;
  activeEngine: string;
  shaderFile: string;
  displayShaderFile: string;
  setShaderFile: (s: string) => void;
  handleRandomShader: () => void;
  validShaderFavorites: string[];
  validShaderRecents: string[];
  shaderThumbnails: Record<string, string>;
  toggleShaderFavorite: (s: string) => void;
  shaderCatalog: ShaderMeta[];
  shaderCatalogLoading: boolean;
  shaderCatalogError: string | null;
  onRateShader: (shaderId: string, score: number) => Promise<void>;
  ratingInFlightShaderId: string | null;
  colorPalette: number;
  setColorPalette: (v: number) => void;
  paletteMode: number;
  setPaletteMode: (v: number) => void;
  instrumentPalette: Uint8Array;
  isStepsShader: boolean;
  stepsLength: 32 | 64;
  setStepsLength: (v: 32 | 64) => void;
  sequencerMatrix: PatternMatrix | null;
  playbackRowFraction: number;
  isPlaying: boolean;
  playbackSeconds: number;
  channelStates: ChannelShadowState[];
  beatPhase: number;
  grooveAmount: number;
  kickTrigger: number;
  activeChannels: number[];
  isModuleLoaded: boolean;
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
  analyserNode: AnalyserNode | null;
  debugPanelOpen: boolean;
  setDebugPanelOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  playbackStateRef: React.MutableRefObject<PlaybackState>;
  channelStatesRef: React.MutableRefObject<ChannelShadowState[]>;
  oscBufferRef: React.MutableRefObject<Float32Array | null>;
  audioReactiveRef: React.MutableRefObject<Float32Array | null>;
  bloomPreset: BloomPreset;
  setBloomPreset: (v: BloomPreset) => void;
  colorScheme: ColorScheme;
  setColorScheme: (v: ColorScheme) => void;
  isNightShader: boolean;
  nightModeEnabled: boolean;
  nightConfig: { bloomIntensity: number; dimFactor: number; vignetteStrength: number; filmGrain: number; invertMix: number; presetIndex: number };
  nightModePreset: NightPreset;
  setNightModeEnabled: (v: boolean) => void;
  setNightModePreset: (v: NightPreset) => void;
  crtEnabled: boolean;
  setCrtEnabled: (v: boolean) => void;
  chassisDark: boolean;
  setChassisDark: (v: boolean) => void;
  dimFactor: number;
  mediaItem: MediaItem | null;
  mediaVisible: boolean;
  mediaFades?: { in: number; out: number };
  moduleMediaFileName?: string;
  moduleMediaHintText?: string;
  setMediaVisible: (v: boolean) => void;
  setMediaItem: (item: MediaItem | null) => void;
  onMediaRemove: (id: string) => void;
  onMediaFadesChange: (fades: MediaFades) => void;
  handleMediaAdd: (file: File) => void;
  handleRemoteMediaSelect: (item: MediaItem) => void;
  isReady: boolean;
  channelVU: Float32Array | null;
  moduleMetadata: ModuleMetadata | null;
  showChannelMeters: boolean;
  setShowChannelMeters: (v: boolean) => void;
  showMetadata: boolean;
  setShowMetadata: (v: boolean) => void;
  showPlaylist: boolean;
  setShowPlaylist: (v: boolean) => void;
  showLibraryBrowser: boolean;
  setShowLibraryBrowser: (v: boolean) => void;
  showLocalLibrary: boolean;
  setShowLocalLibrary: (v: boolean) => void;
  localLibraryRoots: LibraryRoot[];
  localLibraryLoading: boolean;
  localLibraryImporting: boolean;
  localLibraryImportProgress: LibraryImportProgress | null;
  localLibraryImportError: string | null;
  localLibraryFsAccessSupported: boolean;
  activeLibraryEntryId?: string | null;
  onLocalLibraryImportFolder: () => void;
  onLocalLibraryImportWebkit: (files: FileList) => void;
  onLocalLibraryRescanRoot: (rootId: string) => void;
  onLocalLibraryRemoveRoot: (rootId: string) => void;
  onLocalLibraryCancelImport: () => void;
  onLocalLibraryPlay: (entry: LibraryEntry) => Promise<void>;
  playlistItems: PlaylistItem[];
  playlistCurrentIndex: number;
  playlistIsPlaying: boolean;
  playlistShuffle: boolean;
  playlistRepeat: 'none' | 'one' | 'all';
  onPlaylistSelect: (index: number) => void;
  onPlaylistRemove: (index: number) => void;
  onPlaylistClear: () => void;
  onPlaylistPrev: () => void;
  onPlaylistNext: () => void;
  onPlaylistShuffleToggle: () => void;
  onPlaylistRepeatCycle: () => void;
  onPlaylistFilesAdded: (files: FileList) => void;
  songsData: RemoteSong[] | undefined;
  songsLoading: boolean;
  songsRefreshing: boolean;
  libraryErrorMessage: string | null;
  onRefreshLibrary: () => void;
  handleLibrarySongLoad: (song: RemoteSong) => Promise<void>;
  onSyncLibrary: () => Promise<void>;
  syncPending: boolean;
  syncLibraryErrorMessage: string | null;
  activeModuleForSave: SongSaveRequest | null;
  onSaveModule: (req: SongSaveRequest) => Promise<void>;
  savePending: boolean;
  saveSongErrorMessage: string | null;
  cheatsheetOpen: boolean;
  setCheatsheetOpen: (v: boolean) => void;
  status: string;
  onCopyShareLink?: () => void;
  editMode?: boolean;
  onToggleEditMode?: () => void;
  patternEditDirty?: boolean;
  canPatternUndo?: boolean;
  canPatternRedo?: boolean;
  onPatternUndo?: () => void;
  onPatternRedo?: () => void;
  onPatternRevert?: () => void;
  onPatternCellEdit?: (row: number, channel: number, field: PatternEditField) => void;
  onPatternCellPatch?: (row: number, channel: number, patch: PatternCellPatch) => void;
  onPatternCellClear?: (row: number, channel: number) => void;
  onSequencerCellEdit?: (row: number, channel: number) => void;
  midiControls?: ReturnType<typeof useMidiControls>;
  moduleFileName: string;
  moduleDurationSeconds: number;
  channelMuteMask: boolean[];
  onToggleChannelMute: (channel: number) => void;
  onExportWav: () => void;
  onStartCapture: () => void;
  onStopCapture: () => void;
  offlineExportState: import('../hooks/useOfflineExport').OfflineExportState;
  isExporting: boolean;
  captureState: import('../hooks/usePerformanceCapture').PerformanceCaptureState;
  isRecording: boolean;
  getRendererBackend: () => import('../src/renderers/types').PatternRendererBackend | null;
  dualAudioContext: boolean;
}

export function MainLayout({
  isDarkMode,
  theme,
  setTheme,
  setIs3DMode,
  liteMode,
  setLiteMode,
  reactiveMode,
  setReactiveMode,
  isWorkletSupported,
  workletLoadError,
  toggleAudioEngine,
  activeEngine,
  shaderFile,
  displayShaderFile,
  setShaderFile,
  handleRandomShader,
  validShaderFavorites,
  validShaderRecents,
  shaderThumbnails,
  toggleShaderFavorite,
  shaderCatalog,
  shaderCatalogLoading,
  shaderCatalogError,
  onRateShader,
  ratingInFlightShaderId,
  colorPalette,
  setColorPalette,
  paletteMode,
  setPaletteMode,
  instrumentPalette,
  isStepsShader,
  stepsLength,
  setStepsLength,
  sequencerMatrix,
  playbackRowFraction,
  isPlaying,
  playbackSeconds,
  channelStates,
  beatPhase,
  grooveAmount,
  kickTrigger,
  activeChannels,
  isModuleLoaded,
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
  analyserNode,
  debugPanelOpen,
  setDebugPanelOpen,
  playbackStateRef,
  channelStatesRef,
  oscBufferRef,
  audioReactiveRef,
  bloomPreset,
  setBloomPreset,
  colorScheme,
  setColorScheme,
  isNightShader,
  nightModeEnabled,
  nightConfig,
  nightModePreset,
  setNightModeEnabled,
  setNightModePreset,
  crtEnabled,
  setCrtEnabled,
  chassisDark,
  setChassisDark,
  dimFactor,
  mediaItem,
  mediaVisible,
  setMediaVisible,
  setMediaItem,
  mediaFades,
  moduleMediaFileName,
  moduleMediaHintText,
  onMediaRemove,
  onMediaFadesChange,
  handleMediaAdd,
  handleRemoteMediaSelect,
  isReady,
  channelVU,
  moduleMetadata,
  showChannelMeters,
  setShowChannelMeters,
  showMetadata,
  setShowMetadata,
  showPlaylist,
  setShowPlaylist,
  showLibraryBrowser,
  setShowLibraryBrowser,
  showLocalLibrary,
  setShowLocalLibrary,
  localLibraryRoots,
  localLibraryLoading,
  localLibraryImporting,
  localLibraryImportProgress,
  localLibraryImportError,
  localLibraryFsAccessSupported,
  activeLibraryEntryId,
  onLocalLibraryImportFolder,
  onLocalLibraryImportWebkit,
  onLocalLibraryRescanRoot,
  onLocalLibraryRemoveRoot,
  onLocalLibraryCancelImport,
  onLocalLibraryPlay,
  playlistItems,
  playlistCurrentIndex,
  playlistIsPlaying,
  playlistShuffle,
  playlistRepeat,
  onPlaylistSelect,
  onPlaylistRemove,
  onPlaylistClear,
  onPlaylistPrev,
  onPlaylistNext,
  onPlaylistShuffleToggle,
  onPlaylistRepeatCycle,
  onPlaylistFilesAdded,
  songsData,
  songsLoading,
  songsRefreshing,
  libraryErrorMessage,
  onRefreshLibrary,
  handleLibrarySongLoad,
  onSyncLibrary,
  syncPending,
  syncLibraryErrorMessage,
  activeModuleForSave,
  onSaveModule,
  savePending,
  saveSongErrorMessage,
  cheatsheetOpen,
  setCheatsheetOpen,
  status,
  onCopyShareLink,
  editMode = false,
  onToggleEditMode,
  patternEditDirty = false,
  canPatternUndo = false,
  canPatternRedo = false,
  onPatternUndo,
  onPatternRedo,
  onPatternRevert,
  onPatternCellEdit,
  onPatternCellPatch,
  onPatternCellClear,
  onSequencerCellEdit,
  midiControls,
  moduleFileName,
  moduleDurationSeconds,
  channelMuteMask,
  onToggleChannelMute,
  onExportWav,
  onStartCapture,
  onStopCapture,
  offlineExportState,
  isExporting,
  captureState,
  isRecording,
  getRendererBackend,
  dualAudioContext,
}: MainLayoutProps) {
  return (
    <div className="min-h-screen bg-panel-base text-[var(--text-primary)] p-4 flex flex-col items-center transition-colors duration-300">
      <div className="w-full max-w-[1280px]">
        <Header status={status} isModuleLoaded={isModuleLoaded} />

        {/* Global Controls */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex gap-2">
                <button
                  onClick={() => setIs3DMode(true)}
                  className="px-4 py-2 bg-blue-600 text-white text-sm font-mono rounded-lg shadow-lg hover:bg-blue-700 transition-colors border border-blue-500"
                >
                  🎬 3D Mode
                </button>
                {/* Theme selector */}
                <select
                  value={theme}
                  onChange={(e) => setTheme(e.target.value as AppTheme)}
                  className={cn(
                    'px-3 py-2 text-sm font-mono rounded-lg shadow-lg transition-colors border outline-none cursor-pointer',
                    isDarkMode
                      ? 'bg-gray-800 text-white border-gray-700 hover:bg-gray-700'
                      : 'bg-white text-black border-gray-300 hover:bg-gray-50',
                  )}
                  title="Switch UI theme"
                >
                  {THEME_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <button
                  onClick={toggleAudioEngine}
                  disabled={!isWorkletSupported || !!workletLoadError}
                  title={workletLoadError ? `Worklet Error: ${workletLoadError}` : !isWorkletSupported ? "AudioWorklet not supported" : "Toggle Audio Engine (Worklet vs ScriptProcessor)"}
                  className={`px-4 py-2 text-sm font-mono rounded-lg shadow-lg transition-colors border ${
                    !isWorkletSupported || !!workletLoadError
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed border-gray-400 opacity-50'
                      : activeEngine === 'native-worklet'
                        ? 'bg-purple-600 text-white border-purple-500 hover:bg-purple-700'
                        : activeEngine === 'worklet'
                          ? 'bg-green-600 text-white border-green-500 hover:bg-green-700'
                          : 'bg-yellow-500 text-black border-yellow-400 hover:bg-yellow-600'
                  }`}
                >
                  {activeEngine === 'native-worklet' ? '🚀 Native' : activeEngine === 'worklet' ? '⚡ Worklet' : '🐌 Script'}
                </button>
                <button
                  onClick={() => {
                    const next = !liteMode;
                    setLiteMode(next);
                    setLiteOverride(next);
                  }}
                  className={cn(
                    'px-4 py-2 text-sm font-mono rounded-lg shadow-lg transition-colors border',
                    liteMode
                      ? 'bg-orange-600 text-white border-orange-500 hover:bg-orange-700'
                      : 'bg-gray-700 text-gray-200 border-gray-600 hover:bg-gray-600',
                  )}
                  title={liteMode ? 'Lite mode active (mobile/low-power)' : 'Desktop mode'}
                >
                  {liteMode ? '⚡ Lite' : '🖥️ Full'}
                </button>
                <button
                  onClick={() => setReactiveMode(!reactiveMode)}
                  className={cn(
                    'px-4 py-2 text-sm font-mono rounded-lg shadow-lg transition-colors border',
                    reactiveMode
                      ? 'bg-fuchsia-700 text-white border-fuchsia-500 hover:bg-fuchsia-600'
                      : 'bg-gray-700 text-gray-200 border-gray-600 hover:bg-gray-600',
                  )}
                  title={reactiveMode ? 'Audio-reactive chassis on (v0.58+)' : 'Static chassis — no SAB band drive'}
                >
                  {reactiveMode ? '🎛️ Reactive' : '🎛️ Static'}
                </button>
                {onCopyShareLink && (
                  <button
                    type="button"
                    onClick={onCopyShareLink}
                    disabled={!isModuleLoaded}
                    className={cn(
                      'px-4 py-2 text-sm font-mono rounded-lg shadow-lg transition-colors border',
                      isModuleLoaded
                        ? 'bg-cyan-700 text-white border-cyan-500 hover:bg-cyan-600'
                        : 'bg-gray-700 text-gray-500 border-gray-600 cursor-not-allowed opacity-60',
                    )}
                    title="Copy a link that restores this module, shader, and playback position"
                  >
                    🔗 Share
                  </button>
                )}
                {onToggleEditMode && (
                  <button
                    type="button"
                    onClick={onToggleEditMode}
                    disabled={!isModuleLoaded}
                    className={cn(
                      'px-4 py-2 text-sm font-mono rounded-lg shadow-lg transition-colors border',
                      editMode
                        ? 'bg-amber-600 text-white border-amber-500 hover:bg-amber-700'
                        : isModuleLoaded
                          ? 'bg-gray-700 text-gray-200 border-gray-600 hover:bg-gray-600'
                          : 'bg-gray-700 text-gray-500 border-gray-600 cursor-not-allowed opacity-60',
                    )}
                    title="Toggle pattern edit mode (session-only)"
                  >
                    ✏️ Edit{patternEditDirty ? ' *' : ''}
                  </button>
                )}
                {editMode && (
                  <>
                    <button
                      type="button"
                      onClick={onPatternUndo}
                      disabled={!canPatternUndo}
                      className={cn(
                        'px-3 py-2 text-sm font-mono rounded-lg border transition-colors',
                        canPatternUndo
                          ? 'bg-gray-700 text-gray-200 border-gray-600 hover:bg-gray-600'
                          : 'bg-gray-800 text-gray-600 border-gray-700 cursor-not-allowed',
                      )}
                      title="Undo (Ctrl+Z)"
                    >
                      ↶ Undo
                    </button>
                    <button
                      type="button"
                      onClick={onPatternRedo}
                      disabled={!canPatternRedo}
                      className={cn(
                        'px-3 py-2 text-sm font-mono rounded-lg border transition-colors',
                        canPatternRedo
                          ? 'bg-gray-700 text-gray-200 border-gray-600 hover:bg-gray-600'
                          : 'bg-gray-800 text-gray-600 border-gray-700 cursor-not-allowed',
                      )}
                      title="Redo (Ctrl+Shift+Z)"
                    >
                      ↷ Redo
                    </button>
                    {patternEditDirty && onPatternRevert && (
                      <button
                        type="button"
                        onClick={onPatternRevert}
                        className="px-3 py-2 text-sm font-mono rounded-lg border transition-colors bg-amber-900/60 text-amber-100 border-amber-700 hover:bg-amber-800/70"
                        title="Discard edits and restore loaded pattern (session-only)"
                      >
                        ↩ Revert
                      </button>
                    )}
                  </>
                )}
            </div>

            <div className={cn('flex flex-wrap gap-2 p-2 rounded-xl border', isDarkMode ? 'bg-black border-gray-800' : 'bg-gray-200 border-gray-300')}>
                {!IS_PUBLIC_MODE && (
                  <>
                    <ShaderSelectorPanel
                      shaderOptions={AVAILABLE_SHADERS}
                      selectedShader={shaderFile}
                      onSelectShader={setShaderFile}
                      onRandomShader={handleRandomShader}
                      favorites={validShaderFavorites}
                      recents={validShaderRecents}
                      thumbnails={shaderThumbnails}
                      onToggleFavorite={toggleShaderFavorite}
                      isDarkMode={isDarkMode}
                      shaderCatalog={shaderCatalog}
                      shaderCatalogLoading={shaderCatalogLoading}
                      shaderCatalogError={shaderCatalogError}
                      onRateShader={onRateShader}
                      ratingInFlightShaderId={ratingInFlightShaderId}
                    />
                    <div className={cn('w-px h-6', isDarkMode ? 'bg-gray-800' : 'bg-gray-300')}></div>
                  </>
                )}
                <div className="flex items-center gap-1">
                    <span className="text-[10px] font-bold text-gray-500 uppercase px-1">Palette</span>
                    <select
                        className={cn('text-xs font-mono p-1 rounded border outline-none', isDarkMode ? 'bg-gray-800 border-gray-600 text-white' : 'bg-white border-gray-300 text-black')}
                        value={colorPalette}
                        onChange={(e) => setColorPalette(parseInt(e.target.value, 10))}
                    >
                        <option value={0}>Rainbow</option>
                        <option value={1}>Warm</option>
                        <option value={2}>Cool</option>
                        <option value={3}>Neon</option>
                        <option value={4}>Acid</option>
                        <option value={5}>Fifths</option>
                    </select>
                    <button
                      onClick={() => setPaletteMode(paletteMode === 0 ? 1 : 0)}
                      disabled={!usesInstrumentPalette(shaderFile)}
                      title={usesInstrumentPalette(shaderFile) ? 'Toggle pitch hue vs per-instrument color' : 'Per-instrument palette not available on this shader'}
                      className={cn(
                        'text-[10px] font-mono px-2 py-1 rounded border transition-colors',
                        usesInstrumentPalette(shaderFile)
                          ? paletteMode === 1
                            ? 'bg-cyan-700 text-white border-cyan-500 hover:bg-cyan-600'
                            : isDarkMode
                              ? 'bg-gray-800 text-gray-300 border-gray-600 hover:bg-gray-700'
                              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                          : 'bg-gray-700 text-gray-500 border-gray-600 cursor-not-allowed opacity-50'
                      )}
                    >
                      {paletteMode === 1 ? 'By Instrument' : 'By Pitch'}
                    </button>
                </div>
                {isStepsShader && (
                  <>
                    <div className={cn('w-px h-6', isDarkMode ? 'bg-gray-800' : 'bg-gray-300')}></div>
                    <button
                      onClick={() => setStepsLength(stepsLength === 32 ? 64 : 32)}
                      className={cn(
                        'text-xs font-mono px-2 py-1 rounded border transition-colors',
                        isDarkMode
                          ? 'bg-gray-800 text-gray-300 border-gray-600 hover:bg-gray-700 hover:text-white'
                          : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50',
                      )}
                      title="Toggle pattern length (32 or 64 steps visible)"
                    >
                      {stepsLength} Steps
                    </button>
                  </>
                )}
            </div>
        </div>

        {/* Main Display Area */}
        <div className={cn('relative rounded-xl overflow-hidden shadow-2xl mb-6 border', isDarkMode ? 'bg-black border-gray-800' : 'bg-white border-gray-300')}>
           <PatternDisplay
             key={displayShaderFile}
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
             shaderFile={displayShaderFile}
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
              audioReactiveRef={audioReactiveRef}
              reactiveMode={reactiveMode}
             // Bloom settings from preset
             bloomIntensity={(isNightShader && nightModeEnabled) ? nightConfig.bloomIntensity : bloomPreset.intensity}
             bloomThreshold={bloomPreset.threshold}
             colorPalette={colorPalette}
             paletteMode={paletteMode}
             instrumentPalette={instrumentPalette}
             stepsLength={stepsLength}
             onStepsLengthToggle={() => setStepsLength(stepsLength === 32 ? 64 : 32)}
             chassisDark={chassisDark}
             // Night Mode 2.0
             nightModeEnabled={isNightShader && nightModeEnabled}
             nightPreset={nightModeEnabled ? nightConfig.presetIndex : 0}
             vignetteStrength={nightConfig.vignetteStrength}
             filmGrain={nightConfig.filmGrain}
             invertMix={nightConfig.invertMix}
             // CRT effect
             crtEnabled={crtEnabled}
             // Lite mode
             liteMode={liteMode}
             editMode={editMode}
             {...(onSequencerCellEdit ? { onSequencerCellEdit } : {})}
           />

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

        {/* Controls */}
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
          chassisDark={chassisDark}
          onToggleChassisDark={() => setChassisDark(!chassisDark)}
          // Night Mode 2.0
          nightModeEnabled={nightModeEnabled}
          nightModePreset={nightModePreset}
          onNightModeToggle={() => setNightModeEnabled(!nightModeEnabled)}
          onNightPresetChange={setNightModePreset}
          isNightShader={isNightShader}
          // CRT effect
          crtEnabled={crtEnabled}
          onToggleCrt={() => setCrtEnabled(!crtEnabled)}
        />

        {/* Seek Bar */}
        {isModuleLoaded && (
          <div className="mt-4">
            <SeekBar
              currentSeconds={playbackSeconds}
              durationSeconds={moduleDurationSeconds}
              currentRow={playbackRowFraction}
              totalRows={totalPatternRows}
              isPlaying={isPlaying}
              onSeekRow={seekToStep}
            />
          </div>
        )}

        {/* Panel Toggle Buttons */}
        <div className="mt-4 flex flex-wrap gap-2">
          {[
            { key: 'meters', label: '📊 VU Meters', state: showChannelMeters, toggle: setShowChannelMeters },
            { key: 'meta', label: 'ℹ️ Metadata', state: showMetadata, toggle: setShowMetadata },
            { key: 'playlist', label: '📋 Playlist', state: showPlaylist, toggle: setShowPlaylist },
            { key: 'library', label: '☁️ Browse Library', state: showLibraryBrowser, toggle: setShowLibraryBrowser },
            { key: 'collection', label: '📁 Library', state: showLocalLibrary, toggle: setShowLocalLibrary },
          ].map(({ key, label, state, toggle }) => (
            <button
              key={key}
              onClick={() => toggle(!state)}
              className={cn(
                'px-3 py-1 text-xs font-mono rounded-lg border transition-colors',
                state
                  ? 'bg-cyan-900/30 text-cyan-300 border-cyan-800'
                  : isDarkMode
                    ? 'bg-gray-800 text-gray-500 border-gray-700 hover:text-gray-300'
                    : 'bg-gray-200 text-gray-500 border-gray-300 hover:text-gray-700',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Virtual Hardware Panels */}
        <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left Column: placeholder — PatternDisplay is rendered above */}
          <div className="lg:col-span-2" />

          {/* Right Column: Metadata + VU Meters */}
          <div className="flex flex-col gap-4">
            {showMetadata && (
              <Panel variant="bezel" title="Module Info" titleAccent>
                <MetadataPanel
                  metadata={moduleMetadata}
                  currentOrder={sequencerMatrix?.order ?? 0}
                  currentRow={Math.floor(playbackRowFraction)}
                  currentPattern={sequencerMatrix?.patternIndex ?? 0}
                  matrix={sequencerMatrix}
                  isPlaying={isPlaying}
                  playbackSeconds={playbackSeconds}
                />
              </Panel>
            )}
            {showChannelMeters && (
              <Panel variant="bezel" title="VU Meters" titleAccent>
                <ChannelMeters
                  channelVU={channelVU}
                  numChannels={sequencerMatrix?.numChannels ?? 4}
                  analyserNode={analyserNode}
                  isPlaying={isPlaying}
                />
              </Panel>
            )}
            {midiControls && (
              <Panel variant="bezel" title="MIDI / Hardware" titleAccent>
                <MidiControlsPanel midi={midiControls} isDarkMode={isDarkMode} />
              </Panel>
            )}
            <Panel variant="bezel" title="Export" titleAccent>
              <ExportPanel
                isModuleLoaded={isModuleLoaded}
                isDarkMode={isDarkMode}
                moduleFileName={moduleFileName}
                moduleDurationSeconds={moduleDurationSeconds}
                numChannels={sequencerMatrix?.numChannels ?? 0}
                channelMuteMask={channelMuteMask}
                onToggleChannelMute={onToggleChannelMute}
                onExportWav={onExportWav}
                onStartCapture={onStartCapture}
                onStopCapture={onStopCapture}
                offlineExport={offlineExportState}
                isExporting={isExporting}
                captureState={captureState}
                isRecording={isRecording}
                rendererBackend={getRendererBackend()}
                dualAudioContext={dualAudioContext}
              />
            </Panel>
          </div>
        </div>

        {/* Pattern editor (edit mode) */}
        {editMode && onPatternCellEdit && onPatternCellPatch && onPatternCellClear && (
          <div className="mt-4">
            <Panel
              variant="raised"
              title={patternEditDirty ? 'Pattern Editor (unsaved)' : 'Pattern Editor'}
              titleAccent
            >
              <PatternEditor
                matrix={sequencerMatrix}
                currentRow={Math.floor(playbackRowFraction)}
                numChannels={sequencerMatrix?.numChannels ?? 4}
                isPlaying={isPlaying}
                editMode={editMode}
                onCellEdit={onPatternCellEdit}
                onCellPatch={onPatternCellPatch}
                onCellClear={onPatternCellClear}
                onSeek={(row) => seekToStep(row)}
              />
            </Panel>
          </div>
        )}

        {/* Playlist */}
        {showPlaylist && (
          <div className="mt-4">
            <Panel variant="raised" title="Playlist">
              <Playlist
                items={playlistItems}
                currentIndex={playlistCurrentIndex}
                isPlaying={playlistIsPlaying}
                shuffle={playlistShuffle}
                repeat={playlistRepeat}
                onSelect={onPlaylistSelect}
                onRemove={onPlaylistRemove}
                onClear={onPlaylistClear}
                onPrev={onPlaylistPrev}
                onNext={onPlaylistNext}
                onShuffleToggle={onPlaylistShuffleToggle}
                onRepeatCycle={onPlaylistRepeatCycle}
                onFilesAdded={onPlaylistFilesAdded}
              />
            </Panel>
          </div>
        )}

        <div className="mt-4">
          <Panel variant="raised" title="Media Overlay">
            <MediaPanel
              media={mediaItem ? [mediaItem] : []}
              activeMediaId={mediaVisible ? mediaItem?.id : undefined}
              onSelect={(id) => {
                if (id && mediaItem?.id === id) {
                  setMediaVisible(true);
                  return;
                }
                setMediaVisible(false);
              }}
              onRemove={onMediaRemove}
              moduleFileName={moduleMediaFileName}
              moduleHintText={moduleMediaHintText}
              onApplyDetected={handleRemoteMediaSelect}
              fades={mediaFades}
              onFadesChange={onMediaFadesChange}
            />
          </Panel>
        </div>

        {/* Cloud Library */}
        {showLibraryBrowser && (
          <Panel variant="raised" title="Cloud Library" className="mt-4">
            <LibraryBrowser
              songs={songsData ?? []}
              loading={songsLoading}
              refreshPending={songsRefreshing}
              error={libraryErrorMessage}
              isDarkMode={isDarkMode}
              onRefresh={onRefreshLibrary}
              onLoadSong={handleLibrarySongLoad}
              onSync={onSyncLibrary}
              syncPending={syncPending}
              syncError={syncLibraryErrorMessage}
              activeModule={activeModuleForSave}
              onSaveModule={onSaveModule}
              savePending={savePending}
              saveError={saveSongErrorMessage}
            />
          </Panel>
        )}

        {/* Local Collection */}
        {showLocalLibrary && (
          <Panel variant="raised" title="Library" className="mt-4">
            <LibraryPanel
              roots={localLibraryRoots}
              isLoading={localLibraryLoading}
              isImporting={localLibraryImporting}
              importProgress={localLibraryImportProgress}
              importError={localLibraryImportError}
              fsAccessSupported={localLibraryFsAccessSupported}
              isDarkMode={isDarkMode}
              activeEntryId={activeLibraryEntryId ?? null}
              onImportFolder={onLocalLibraryImportFolder}
              onImportWebkitFiles={onLocalLibraryImportWebkit}
              onRescanRoot={onLocalLibraryRescanRoot}
              onRemoveRoot={onLocalLibraryRemoveRoot}
              onCancelImport={onLocalLibraryCancelImport}
              onPlayEntry={onLocalLibraryPlay}
            />
          </Panel>
        )}

        <div className="mt-8 text-center text-xs opacity-50">
             <p>Supports .mod, .xm, .s3m, .it files.</p>
             <p>WebGPU required for visualization.</p>
        </div>
      </div>
      {cheatsheetOpen && <KeyboardShortcutHelp onClose={() => setCheatsheetOpen(false)} />}
    </div>
  );
}
