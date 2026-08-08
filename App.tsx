import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { MainLayout } from './components/MainLayout';
import { ProjectMEmbedView } from './components/ProjectMEmbedView';
import { useLibOpenMPT } from './hooks/useLibOpenMPT';
import { usePlaylist } from './hooks/usePlaylist';
import { useMidiControls } from './hooks/useMidiControls';
import { useLibrary, useSaveSong, useSyncLibrary } from './hooks/useLibrary';
import { useLocalLibrary } from './hooks/useLocalLibrary';
import { useRateShader } from './hooks/useRateShader';
import { startProjectMBridge } from './utils/projectMBridge';
import { supportsStepsLength, usesOscilloscope } from './utils/shaderVersion';
import { preserveWindowScroll } from './utils/scrollContainer';
import { useToast } from './hooks/useToast';
import { usePlayerShare } from './hooks/usePlayerShare';
import { useOpenGraph } from './hooks/useOpenGraph';
import { ToastStack } from './components/ToastStack';
import { useOfflineExport } from './hooks/useOfflineExport';
import { usePerformanceCapture } from './hooks/usePerformanceCapture';
import { PlayerSessionProvider } from './context/PlayerSessionContext';
import { PlayerFeaturesProvider } from './context/PlayerFeaturesContext';
import { usePlayerUiStore } from './store/playerUiStore';
import { useShaderPrefsStore } from './store/shaderPrefsStore';
import { LIGHT_THEMES, IS_PROJECTM_EMBED, IS_PUBLIC_MODE } from './appConfig';
import { App3DModeShell } from './app/App3DModeShell';
import { useAppTestHooks } from './app/useAppTestHooks';
import { usePwaRegistration } from './app/usePwaRegistration';
import { useAppMedia } from './app/useAppMedia';
import { useAppDerivedState } from './app/useAppDerivedState';
import { useAppModuleLoading } from './app/useAppModuleLoading';
import { useAppPlaylistHandlers } from './app/useAppPlaylistHandlers';
import { useAppKeyboardActions } from './app/useAppKeyboardActions';
import { useAppPatternEdit, usePatternEditDirtyRef } from './app/useAppPatternEdit';
import { usePlayerSessionValue } from './app/usePlayerSessionValue';
import { usePlayerFeaturesValue } from './app/usePlayerFeaturesValue';

function App() {
  const theme = usePlayerUiStore((s) => s.theme);
  const setTheme = usePlayerUiStore((s) => s.setTheme);
  const liteMode = usePlayerUiStore((s) => s.liteMode);
  const setLiteMode = usePlayerUiStore((s) => s.setLiteMode);
  const debugPanelOpen = usePlayerUiStore((s) => s.debugPanelOpen);
  const setDebugPanelOpen = usePlayerUiStore((s) => s.setDebugPanelOpen);
  const cheatsheetOpen = usePlayerUiStore((s) => s.cheatsheetOpen);
  const setCheatsheetOpen = usePlayerUiStore((s) => s.setCheatsheetOpen);
  const editMode = usePlayerUiStore((s) => s.editMode);
  const clearInstrumentSelection = usePlayerUiStore((s) => s.clearInstrumentSelection);

  const shaderFile = useShaderPrefsStore((s) => s.storedShader);
  const shaderFavorites = useShaderPrefsStore((s) => s.shaderFavorites);
  const shaderRecents = useShaderPrefsStore((s) => s.shaderRecents);
  const shaderThumbnails = useShaderPrefsStore((s) => s.shaderThumbnails);
  const setShaderThumbnails = useShaderPrefsStore((s) => s.setShaderThumbnails);
  const setModuleHash = useShaderPrefsStore((s) => s.setModuleHash);
  const bloomPreset = useShaderPrefsStore((s) => s.bloomPreset);
  const setBloomPreset = useShaderPrefsStore((s) => s.setBloomPreset);
  const colorScheme = useShaderPrefsStore((s) => s.colorScheme);
  const setColorScheme = useShaderPrefsStore((s) => s.setColorScheme);
  const colorPalette = useShaderPrefsStore((s) => s.colorPalette);
  const setColorPalette = useShaderPrefsStore((s) => s.setColorPalette);
  const paletteMode = useShaderPrefsStore((s) => s.paletteMode);
  const setPaletteMode = useShaderPrefsStore((s) => s.setPaletteMode);
  const setStepsLength = useShaderPrefsStore((s) => s.setStepsLength);
  const nightModeEnabled = useShaderPrefsStore((s) => s.nightModeEnabled);
  const nightModePreset = useShaderPrefsStore((s) => s.nightModePreset);
  const markSkipModuleShaderRestore = useShaderPrefsStore((s) => s.markSkipModuleShaderRestore);
  const setShaderFile = useShaderPrefsStore((s) => s.selectShader);

  const [volume, setVolume] = useState<number>(0.5);
  const [pan, setPan] = useState<number>(0.0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const preMuteVolumeRef = useRef<number>(0.5);

  const [is3DMode, setIs3DMode] = useState<boolean>(false);
  const isDarkMode = !LIGHT_THEMES.has(theme);
  const [viewMode, setViewMode] = useState<'device' | 'wall'>('device');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const isStepsShader = supportsStepsLength(shaderFile);
  useEffect(() => {
    if (!isStepsShader) setStepsLength(32);
  }, [isStepsShader, setStepsLength]);

  const {
    isReady,
    isModuleLoaded,
    isPlaying,
    isLooping,
    playbackSeconds,
    playbackRowFraction,
    setPlaybackRowFraction,
    totalPatternRows,
    sequencerMatrix,
    channelStates,
    moduleInfo,
    instrumentNames,
    instrumentTable,
    moduleComments,
    beatPhase,
    grooveAmount,
    kickTrigger,
    activeChannels,
    play,
    stopMusic,
    loadFile,
    setIsLooping,
    seekToStep,
    setPanValue: setLibPan,
    applyMasterLevels: applyAudioMasterLevels,
    getMasterGainValue,
    getMasterPanValue,
    replacePatternMatrix,
    moduleDurationSeconds,
    moduleFileName,
    getModuleFileData,
    toggleChannelMute,
    getAudioContext,
    getAudioTapNode,
    activeEngine,
    isWorkletSupported,
    toggleAudioEngine,
    status,
    syncDebug,
    analyserNode,
    playbackStateRef,
    channelStatesRef,
    workletLoadError,
    oscBufferRef,
    audioReactiveRef,
    requestOscBuffer,
  } = useLibOpenMPT(volume, liteMode);

  const { state: offlineExportState, exportWav, isExporting } = useOfflineExport();
  const {
    state: captureState,
    start: startCapture,
    stop: stopCapture,
    isRecording,
  } = usePerformanceCapture();

  const channelMuteMask = useMemo(
    () => channelStates.map((ch) => (ch?.isMuted ?? 0) > 0),
    [channelStates],
  );

  const handleExportWav = useCallback(async () => {
    const fileData = getModuleFileData();
    if (!fileData) return;
    await exportWav({
      fileData,
      fileName: moduleFileName || 'export.mod',
      ...(channelMuteMask.some(Boolean) ? { muteMask: channelMuteMask } : {}),
    });
  }, [channelMuteMask, exportWav, getModuleFileData, moduleFileName]);

  const handleStartCapture = useCallback(async () => {
    const renderer = window.currentPatternRenderer;
    await startCapture({
      getRenderer: () => renderer,
      audioContext: getAudioContext(),
      audioTapNode: getAudioTapNode(),
      preferWebGL2: true,
      dualAudioContext: activeEngine === 'native-worklet',
    });
  }, [activeEngine, getAudioContext, getAudioTapNode, startCapture]);

  const playGuarded = useCallback(() => {
    preserveWindowScroll(() => play());
  }, [play]);

  useAppTestHooks({
    seekToStep,
    stopMusic,
    playGuarded,
    isPlaying,
    getAudioContext,
    isModuleLoaded,
    sequencerMatrix,
    loadFile,
    setPlaybackRowFraction,
    playbackStateRef,
    activeEngine,
    liteMode,
    getMasterGainValue,
    getMasterPanValue,
    applyAudioMasterLevels,
    volume,
    pan,
  });

  useEffect(() => {
    const stopBridge = startProjectMBridge(analyserNode);
    return stopBridge;
  }, [analyserNode]);

  const {
    mediaVisible,
    setMediaVisible,
    mediaItem,
    setMediaItem,
    mediaFades,
    setMediaFades,
    handleMediaAdd,
    handleRemoteMediaSelect,
    handleMediaRemove,
  } = useAppMedia();

  const { songsQuery, shadersQuery } = useLibrary();
  const rateShaderMutation = useRateShader();
  const saveSongMutation = useSaveSong();
  const syncLibraryMutation = useSyncLibrary();
  const localLibrary = useLocalLibrary();
  const playlist = usePlaylist();

  const patternEditDirtyRef = usePatternEditDirtyRef();

  const {
    currentModuleFileName,
    moduleSourceUrl,
    setModuleSourceUrl,
    loadFileWithHash,
    handleFileSelected,
    activeModuleForSave,
  } = useAppModuleLoading({
    loadFile,
    setModuleHash,
    patternEditDirtyRef,
    isModuleLoaded,
    status,
    sequencerMatrix,
    playlistItems: playlist.items,
    playlistCurrentIndex: playlist.currentIndex,
  });

  const {
    channelVU,
    moduleMetadata,
    validShaderFavorites,
    validShaderRecents,
    libraryErrorMessage,
    shaderCatalogErrorMessage,
    saveSongErrorMessage,
    syncLibraryErrorMessage,
    moduleMediaHintText,
    isNightShader,
    nightConfig,
    dimFactor,
    displayShaderFile,
    instrumentPalette,
    sharePageUrl,
  } = useAppDerivedState({
    channelStates,
    isModuleLoaded,
    sequencerMatrix,
    status,
    activeEngine,
    totalPatternRows,
    instrumentNames,
    moduleComments,
    moduleDurationSeconds,
    moduleFileName,
    clearInstrumentSelection,
    shaderFile,
    shaderFavorites,
    shaderRecents,
    shaderThumbnails,
    setShaderThumbnails,
    songsQueryError: songsQuery.error,
    shadersQueryError: shadersQuery.error,
    saveSongMutationError: saveSongMutation.error,
    syncLibraryMutationError: syncLibraryMutation.error,
    liteMode,
    isDarkMode,
    nightModeEnabled,
    nightModePreset,
    moduleSourceUrl,
    moduleInfoOrder: moduleInfo.order,
    moduleInfoRow: moduleInfo.row,
    paletteMode,
    colorPalette,
    mediaItem,
  });

  const playlistHandlers = useAppPlaylistHandlers({
    playlist,
    loadFileWithHash,
    setModuleSourceUrl,
    localLibrary,
  });

  useEffect(() => { setLibPan(pan); }, [pan, setLibPan]);
  useEffect(() => {
    applyAudioMasterLevels(volume, pan);
  }, [volume, pan, applyAudioMasterLevels]);

  useAppKeyboardActions({
    isPlaying,
    stopMusic,
    playGuarded,
    seekToStep,
    playbackRowFraction,
    sequencerMatrix,
    setVolume,
    setPan,
    isMuted,
    setIsMuted,
    volume,
    preMuteVolumeRef,
    setIsLooping,
    setDebugPanelOpen,
    debugPanelOpen,
    setCheatsheetOpen,
    cheatsheetOpen,
    setShaderFile,
  });

  usePwaRegistration();

  const midiControls = useMidiControls();

  useEffect(() => {
    if (usesOscilloscope(displayShaderFile)) {
      requestOscBuffer();
    }
  }, [displayShaderFile, requestOscBuffer]);

  const { toasts, showToast, dismissToast } = useToast();

  const patternModuleKey = isModuleLoaded
    ? `${moduleSourceUrl ?? ''}|${moduleInfo.title}`
    : null;

  const patternEditHandlers = useAppPatternEdit({
    sequencerMatrix,
    replacePatternMatrix,
    patternModuleKey,
    isExporting,
    moduleFileName,
    currentModuleFileName,
    editMode,
    patternEditDirtyRef,
  });

  const { copyShareLink } = usePlayerShare({
    isReady,
    isModuleLoaded,
    sequencerMatrix,
    shaderFile,
    paletteMode,
    liteMode,
    colorPalette,
    moduleSourceUrl,
    moduleOrder: moduleInfo.order,
    moduleRow: moduleInfo.row,
    mediaItem,
    setShaderFile,
    setPaletteMode,
    setColorPalette,
    setLiteMode,
    setModuleSourceUrl,
    loadFileWithHash,
    seekToStep,
    setMediaItem,
    setMediaVisible,
    showToast,
    onShareShaderApplied: markSkipModuleShaderRestore,
  });

  useOpenGraph({
    ...(moduleMetadata?.title
      ? { title: `${moduleMetadata.title} · MOD Player` }
      : {}),
    ...(moduleMetadata
      ? { description: `Listen to "${moduleMetadata.title}" with shader ${shaderFile}` }
      : {}),
    url: sharePageUrl,
  });

  const playerSession = usePlayerSessionValue({
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
  });

  const playerFeatures = usePlayerFeaturesValue({
    setIs3DMode,
    copyShareLink,
    mediaItem,
    mediaVisible,
    mediaFades,
    currentModuleFileName,
    moduleMediaHintText,
    setMediaVisible,
    setMediaItem,
    handleMediaRemove,
    setMediaFades,
    handleMediaAdd,
    handleRemoteMediaSelect,
    shadersQuery,
    shaderCatalogErrorMessage,
    rateShaderMutation,
    validShaderFavorites,
    validShaderRecents,
    localLibrary,
    activeLibraryEntryId: playlistHandlers.activeLibraryEntryId,
    handleLocalLibraryPlay: playlistHandlers.handleLocalLibraryPlay,
    playlist,
    isPlaying,
    handlePlaylistSelect: playlistHandlers.handlePlaylistSelect,
    handlePlaylistPrev: playlistHandlers.handlePlaylistPrev,
    handlePlaylistNext: playlistHandlers.handlePlaylistNext,
    handlePlaylistFilesAdded: playlistHandlers.handlePlaylistFilesAdded,
    songsQuery,
    libraryErrorMessage,
    handleLibrarySongLoad: playlistHandlers.handleLibrarySongLoad,
    syncLibraryMutation,
    syncLibraryErrorMessage,
    activeModuleForSave,
    saveSongMutation,
    saveSongErrorMessage,
    patternEdit: patternEditHandlers.patternEdit,
    handlePatternRevert: patternEditHandlers.handlePatternRevert,
    handlePatternCellEdit: patternEditHandlers.handlePatternCellEdit,
    handlePatternCellPatch: patternEditHandlers.handlePatternCellPatch,
    handlePatternCellClear: patternEditHandlers.handlePatternCellClear,
    handleSequencerCellEdit: patternEditHandlers.handleSequencerCellEdit,
    handleExportPatternDump: patternEditHandlers.handleExportPatternDump,
    midiControls,
    handleExportWav,
    handleStartCapture,
    stopCapture,
    offlineExportState,
    isExporting,
    captureState,
    isRecording,
    activeEngine,
  });

  if (IS_PROJECTM_EMBED) {
    return (
      <ProjectMEmbedView
        status={status}
        isReady={isReady}
        isModuleLoaded={isModuleLoaded}
        isPlaying={isPlaying}
        isLooping={isLooping}
        playbackSeconds={playbackSeconds}
        playbackRow={Math.floor(playbackRowFraction)}
        totalRows={totalPatternRows}
        moduleTitle={moduleMetadata?.title ?? null}
        play={playGuarded}
        stopMusic={stopMusic}
        seekToStep={seekToStep}
        setIsLooping={setIsLooping}
        handleFileSelected={handleFileSelected}
      />
    );
  }

  if (is3DMode && !IS_PUBLIC_MODE) {
    return (
      <App3DModeShell
        isDarkMode={isDarkMode}
        viewMode={viewMode}
        setViewMode={setViewMode}
        setIs3DMode={setIs3DMode}
        setTheme={setTheme}
        dimFactor={dimFactor}
        status={status}
        isModuleLoaded={isModuleLoaded}
        syncDebug={syncDebug}
        sequencerMatrix={sequencerMatrix}
        playbackRowFraction={playbackRowFraction}
        isPlaying={isPlaying}
        playbackSeconds={playbackSeconds}
        channelStates={channelStates}
        beatPhase={beatPhase}
        grooveAmount={grooveAmount}
        kickTrigger={kickTrigger}
        activeChannels={activeChannels}
        volume={volume}
        pan={pan}
        isLooping={isLooping}
        totalPatternRows={totalPatternRows}
        play={playGuarded}
        stopMusic={stopMusic}
        seekToStep={seekToStep}
        setIsLooping={setIsLooping}
        setVolume={setVolume}
        setPan={setPan}
        handleFileSelected={handleFileSelected}
        handleMediaAdd={handleMediaAdd}
        handleRemoteMediaSelect={handleRemoteMediaSelect}
        analyserNode={analyserNode}
        debugPanelOpen={debugPanelOpen}
        setDebugPanelOpen={setDebugPanelOpen}
        playbackStateRef={playbackStateRef}
        channelStatesRef={channelStatesRef}
        oscBufferRef={oscBufferRef}
        bloomPreset={bloomPreset}
        setBloomPreset={setBloomPreset}
        colorScheme={colorScheme}
        setColorScheme={setColorScheme}
        mediaItem={mediaItem}
        mediaVisible={mediaVisible}
        setMediaVisible={setMediaVisible}
        setMediaItem={setMediaItem}
        mediaFades={mediaFades}
        isReady={isReady}
        cheatsheetOpen={cheatsheetOpen}
        setCheatsheetOpen={setCheatsheetOpen}
      />
    );
  }

  return (
    <>
      <PlayerSessionProvider value={playerSession}>
        <PlayerFeaturesProvider value={playerFeatures}>
          <MainLayout />
        </PlayerFeaturesProvider>
      </PlayerSessionProvider>
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}

export default App;
