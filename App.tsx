import { useState, useCallback } from 'react';
import { MainLayout } from './components/MainLayout';
import { useLibOpenMPT } from './hooks/useLibOpenMPT';
import { usePlayerEngine } from './hooks/usePlayerEngine';
import { useDisplayShader } from './hooks/usePlayerView';
import { usePlaylist } from './hooks/usePlaylist';
import { useMidiControls } from './hooks/useMidiControls';
import { useLibrary, useSaveSong, useSyncLibrary } from './hooks/useLibrary';
import { useLocalLibrary } from './hooks/useLocalLibrary';
import { useRateShader } from './hooks/useRateShader';
import { useToast } from './hooks/useToast';
import { usePlayerShare } from './hooks/usePlayerShare';
import { useOpenGraph } from './hooks/useOpenGraph';
import { ToastStack } from './components/ToastStack';
import { useOfflineExport } from './hooks/useOfflineExport';
import type { ExportSampleRate } from './utils/wavEncoder';
import { useFxRackBootstrap } from './hooks/useFxRackBootstrap';
import { useFxStore } from './store/fxStore';
import { usePerformanceCapture } from './hooks/usePerformanceCapture';
import { PlayerFeaturesProvider } from './context/PlayerFeaturesContext';
import { IS_PROJECTM_EMBED, IS_PUBLIC_MODE } from './appConfig';
import { App3DModeShell } from './app/App3DModeShell';
import { ProjectMEmbedHost } from './app/ProjectMEmbedHost';
import { useAppTestHooks } from './app/useAppTestHooks';
import { usePwaRegistration } from './app/usePwaRegistration';
import { useAppMedia } from './app/useAppMedia';
import { useAppDerivedState } from './app/useAppDerivedState';
import { useAppAudioTaps, useAppPresentationEffects } from './app/useAppEffects';
import { useAppModuleLoading } from './app/useAppModuleLoading';
import { useAppPlaylistHandlers } from './app/useAppPlaylistHandlers';
import { useAppKeyboardActions } from './app/useAppKeyboardActions';
import { useAppPatternEdit, usePatternEditDirtyRef } from './app/useAppPatternEdit';
import { usePlayerFeaturesValue } from './app/usePlayerFeaturesValue';

/**
 * Composition root. It mounts the PlayerEngine and wires the app-level features (library, playlist,
 * media, export, share); it no longer threads player state or UI-store values down — components
 * select what they need from the engine (hooks/usePlayerEngine.ts) and the stores (#492). App itself
 * re-renders only on coarse changes (a module loaded, an order change), never per row.
 */
function App() {
  useFxRackBootstrap();
  const engine = useLibOpenMPT();
  useAppPresentationEffects();
  useAppAudioTaps();
  useAppKeyboardActions();
  useAppTestHooks();
  usePwaRegistration();

  const isModuleLoaded = usePlayerEngine((s) => s.isModuleLoaded);
  const moduleTitle = usePlayerEngine((s) => s.moduleInfo.title);
  const { shaderFile } = useDisplayShader();

  const [is3DMode, setIs3DMode] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'device' | 'wall'>('device');
  // DOM node inside the R3F 3D studio's pattern-display panel (when open).
  // PerformanceStage teleports its live PatternDisplay into this node instead
  // of App3DView constructing a second instance — see Problem A.
  const [studioDisplayHost, setStudioDisplayHost] = useState<HTMLDivElement | null>(null);

  const { state: offlineExportState, exportWav, isExporting } = useOfflineExport();
  const {
    state: captureState,
    start: startCapture,
    stop: stopCapture,
    isRecording,
  } = usePerformanceCapture();

  // Read at click time — none of this needs App to re-render while it changes.
  const handleExportWav = useCallback(async (sampleRate: ExportSampleRate) => {
    const fileData = engine.getModuleFileData();
    if (!fileData) return;
    const { moduleFileName, channelStates } = engine.getSnapshot();
    const muteMask = channelStates.map((ch) => (ch?.isMuted ?? 0) > 0);
    await exportWav({
      fileData,
      fileName: moduleFileName || 'export.mod',
      sampleRate,
      ...(muteMask.some(Boolean) ? { muteMask } : {}),
      // What plays is what's exported (#453): the effective FX rack, if any module is on.
      fx: useFxStore.getState().exportSnapshot(),
    });
  }, [engine, exportWav]);

  const handleStartCapture = useCallback(async () => {
    const renderer = window.currentPatternRenderer;
    await startCapture({
      getRenderer: () => renderer,
      audioContext: engine.getAudioContext(),
      audioTapNode: engine.getAudioTapNode(),
      preferWebGL2: true,
    });
  }, [engine, startCapture]);

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
    patternEditDirtyRef,
    playlistItems: playlist.items,
    playlistCurrentIndex: playlist.currentIndex,
  });

  const {
    libraryErrorMessage,
    shaderCatalogErrorMessage,
    saveSongErrorMessage,
    syncLibraryErrorMessage,
    sharePageUrl,
  } = useAppDerivedState({
    songsQueryError: songsQuery.error,
    shadersQueryError: shadersQuery.error,
    saveSongMutationError: saveSongMutation.error,
    syncLibraryMutationError: syncLibraryMutation.error,
    moduleSourceUrl,
    mediaItem,
  });

  const playlistHandlers = useAppPlaylistHandlers({
    playlist,
    loadFileWithHash,
    setModuleSourceUrl,
    localLibrary,
  });

  const midiControls = useMidiControls();

  const { toasts, showToast, dismissToast } = useToast();

  const patternModuleKey = isModuleLoaded
    ? `${moduleSourceUrl ?? ''}|${moduleTitle}`
    : null;

  const patternEditHandlers = useAppPatternEdit({
    patternModuleKey,
    isExporting,
    currentModuleFileName,
    patternEditDirtyRef,
  });

  const { copyShareLink } = usePlayerShare({
    moduleSourceUrl,
    mediaItem,
    setModuleSourceUrl,
    loadFileWithHash,
    setMediaItem,
    setMediaVisible,
    showToast,
  });

  useOpenGraph({
    ...(isModuleLoaded ? { title: `${moduleTitle} · MOD Player` } : {}),
    ...(isModuleLoaded
      ? { description: `Listen to "${moduleTitle}" with shader ${shaderFile}` }
      : {}),
    url: sharePageUrl,
  });

  const playerFeatures = usePlayerFeaturesValue({
    setIs3DMode,
    copyShareLink,
    mediaItem,
    mediaVisible,
    mediaFades,
    currentModuleFileName,
    setMediaVisible,
    setMediaItem,
    handleMediaRemove,
    setMediaFades,
    handleMediaAdd,
    handleRemoteMediaSelect,
    handleFileSelected,
    shadersQuery,
    shaderCatalogErrorMessage,
    rateShaderMutation,
    localLibrary,
    activeLibraryEntryId: playlistHandlers.activeLibraryEntryId,
    handleLocalLibraryPlay: playlistHandlers.handleLocalLibraryPlay,
    playlist,
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
  });

  if (IS_PROJECTM_EMBED) {
    return <ProjectMEmbedHost handleFileSelected={handleFileSelected} />;
  }

  return (
    <>
      <PlayerFeaturesProvider value={playerFeatures}>
        <MainLayout studioDisplayHost={studioDisplayHost} />
      </PlayerFeaturesProvider>
      {is3DMode && !IS_PUBLIC_MODE && (
        <App3DModeShell
          viewMode={viewMode}
          setViewMode={setViewMode}
          setIs3DMode={setIs3DMode}
          handleFileSelected={handleFileSelected}
          handleMediaAdd={handleMediaAdd}
          handleRemoteMediaSelect={handleRemoteMediaSelect}
          onStudioDisplayHostChange={setStudioDisplayHost}
          mediaItem={mediaItem}
          mediaVisible={mediaVisible}
          setMediaVisible={setMediaVisible}
          setMediaItem={setMediaItem}
          mediaFades={mediaFades}
        />
      )}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}

export default App;
