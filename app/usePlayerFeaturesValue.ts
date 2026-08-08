import { useMemo } from 'react';
import type { PlayerFeaturesValue } from '../context/PlayerFeaturesContext';
import type { MediaItem } from '../types';
import type { SongSaveRequest } from '../utils/storageApi';
import type { PatternEditField } from '../utils/patternEdit';
import type { useMidiControls } from '../hooks/useMidiControls';
import type { OfflineExportState } from '../hooks/useOfflineExport';
import type { PerformanceCaptureState } from '../hooks/usePerformanceCapture';
import type { usePlaylist } from '../hooks/usePlaylist';
import type { useLocalLibrary } from '../hooks/useLocalLibrary';
import type { useLibrary, useSaveSong, useSyncLibrary } from '../hooks/useLibrary';
import type { useRateShader } from '../hooks/useRateShader';
import type { usePatternEdit } from '../hooks/usePatternEdit';

type Playlist = ReturnType<typeof usePlaylist>;
type LocalLibrary = ReturnType<typeof useLocalLibrary>;
type SongsQuery = ReturnType<typeof useLibrary>['songsQuery'];
type ShadersQuery = ReturnType<typeof useLibrary>['shadersQuery'];
type RateShaderMutation = ReturnType<typeof useRateShader>;
type SaveSongMutation = ReturnType<typeof useSaveSong>;
type SyncLibraryMutation = ReturnType<typeof useSyncLibrary>;
type PatternEdit = ReturnType<typeof usePatternEdit>;
type MidiControls = ReturnType<typeof useMidiControls>;

export interface UsePlayerFeaturesValueParams {
  setIs3DMode: (v: boolean) => void;
  copyShareLink: () => void | Promise<void>;
  mediaItem: MediaItem | null;
  mediaVisible: boolean;
  mediaFades: { in: number; out: number };
  currentModuleFileName: string;
  moduleMediaHintText: string;
  setMediaVisible: (v: boolean) => void;
  setMediaItem: (item: MediaItem | null) => void;
  handleMediaRemove: (id: string) => void;
  setMediaFades: React.Dispatch<React.SetStateAction<{ in: number; out: number }>>;
  handleMediaAdd: (file: File) => void;
  handleRemoteMediaSelect: (item: MediaItem) => void;
  shadersQuery: ShadersQuery;
  shaderCatalogErrorMessage: string | null;
  rateShaderMutation: RateShaderMutation;
  validShaderFavorites: string[];
  validShaderRecents: string[];
  localLibrary: LocalLibrary;
  activeLibraryEntryId: string | null;
  handleLocalLibraryPlay: (entry: import('../types/localLibrary').LibraryEntry) => Promise<void>;
  playlist: Playlist;
  isPlaying: boolean;
  handlePlaylistSelect: (index: number) => void;
  handlePlaylistPrev: () => void;
  handlePlaylistNext: () => void;
  handlePlaylistFilesAdded: (files: FileList) => void;
  songsQuery: SongsQuery;
  libraryErrorMessage: string | null;
  handleLibrarySongLoad: (song: import('../utils/storageApi').RemoteSong) => Promise<void>;
  syncLibraryMutation: SyncLibraryMutation;
  syncLibraryErrorMessage: string | null;
  activeModuleForSave: SongSaveRequest | null;
  saveSongMutation: SaveSongMutation;
  saveSongErrorMessage: string | null;
  patternEdit: PatternEdit;
  handlePatternRevert: () => void;
  handlePatternCellEdit: (row: number, channel: number, field: PatternEditField) => void;
  handlePatternCellPatch: (row: number, channel: number, patch: Parameters<PatternEdit['editCell']>[2]) => void;
  handlePatternCellClear: (row: number, channel: number) => void;
  handleSequencerCellEdit: (row: number, channel: number) => void;
  handleExportPatternDump: () => void;
  midiControls: MidiControls;
  handleExportWav: () => void;
  handleStartCapture: () => void;
  stopCapture: () => void;
  offlineExportState: OfflineExportState;
  isExporting: boolean;
  captureState: PerformanceCaptureState;
  isRecording: boolean;
  activeEngine: string;
}

export function usePlayerFeaturesValue(params: UsePlayerFeaturesValueParams): PlayerFeaturesValue {
  const {
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
    activeLibraryEntryId,
    handleLocalLibraryPlay,
    playlist,
    isPlaying,
    handlePlaylistSelect,
    handlePlaylistPrev,
    handlePlaylistNext,
    handlePlaylistFilesAdded,
    songsQuery,
    libraryErrorMessage,
    handleLibrarySongLoad,
    syncLibraryMutation,
    syncLibraryErrorMessage,
    activeModuleForSave,
    saveSongMutation,
    saveSongErrorMessage,
    patternEdit,
    handlePatternRevert,
    handlePatternCellEdit,
    handlePatternCellPatch,
    handlePatternCellClear,
    handleSequencerCellEdit,
    handleExportPatternDump,
    midiControls,
    handleExportWav,
    handleStartCapture,
    stopCapture,
    offlineExportState,
    isExporting,
    captureState,
    isRecording,
    activeEngine,
  } = params;

  return useMemo((): PlayerFeaturesValue => ({
    setIs3DMode,
    onCopyShareLink: () => { void copyShareLink(); },
    mediaItem,
    mediaVisible,
    mediaFades,
    moduleMediaFileName: currentModuleFileName,
    moduleMediaHintText,
    setMediaVisible,
    setMediaItem,
    onMediaRemove: handleMediaRemove,
    onMediaFadesChange: setMediaFades,
    handleMediaAdd,
    handleRemoteMediaSelect,
    shaderCatalog: shadersQuery.data ?? [],
    shaderCatalogLoading: shadersQuery.isLoading || shadersQuery.isFetching,
    shaderCatalogError: shaderCatalogErrorMessage,
    onRateShader: async (shaderId, score) => { await rateShaderMutation.mutateAsync({ id: shaderId, score }); },
    ratingInFlightShaderId: rateShaderMutation.isPending ? rateShaderMutation.variables?.id ?? null : null,
    validShaderFavorites,
    validShaderRecents,
    localLibraryRoots: localLibrary.roots,
    localLibraryLoading: localLibrary.isLoading,
    localLibraryImporting: localLibrary.isImporting,
    localLibraryImportProgress: localLibrary.importProgress,
    localLibraryImportError: localLibrary.importError,
    localLibraryFsAccessSupported: localLibrary.fsAccessSupported,
    activeLibraryEntryId,
    onLocalLibraryImportFolder: () => { void localLibrary.importFolder(); },
    onLocalLibraryImportWebkit: (files) => { void localLibrary.importWebkitFiles(files); },
    onLocalLibraryRescanRoot: (rootId) => { void localLibrary.rescanRoot(rootId); },
    onLocalLibraryRemoveRoot: (rootId) => { void localLibrary.removeRoot(rootId); },
    onLocalLibraryCancelImport: localLibrary.cancelImport,
    onLocalLibraryPlay: handleLocalLibraryPlay,
    playlistItems: playlist.items,
    playlistCurrentIndex: playlist.currentIndex,
    playlistIsPlaying: isPlaying,
    playlistShuffle: playlist.shuffle,
    playlistRepeat: playlist.repeat,
    onPlaylistSelect: handlePlaylistSelect,
    onPlaylistRemove: playlist.remove,
    onPlaylistClear: playlist.clear,
    onPlaylistPrev: handlePlaylistPrev,
    onPlaylistNext: handlePlaylistNext,
    onPlaylistShuffleToggle: playlist.toggleShuffle,
    onPlaylistRepeatCycle: playlist.cycleRepeat,
    onPlaylistFilesAdded: handlePlaylistFilesAdded,
    songsData: songsQuery.data,
    songsLoading: songsQuery.isLoading,
    songsRefreshing: songsQuery.isFetching && !songsQuery.isLoading,
    libraryErrorMessage,
    onRefreshLibrary: () => { void songsQuery.refetch(); },
    handleLibrarySongLoad,
    onSyncLibrary: async () => { await syncLibraryMutation.mutateAsync(); },
    syncPending: syncLibraryMutation.isPending,
    syncLibraryErrorMessage,
    activeModuleForSave,
    onSaveModule: async (req) => { await saveSongMutation.mutateAsync(req); },
    savePending: saveSongMutation.isPending,
    saveSongErrorMessage,
    patternEditDirty: patternEdit.isDirty,
    canPatternUndo: patternEdit.canUndo,
    canPatternRedo: patternEdit.canRedo,
    onPatternUndo: patternEdit.undo,
    onPatternRedo: patternEdit.redo,
    onPatternRevert: handlePatternRevert,
    onPatternCellEdit: handlePatternCellEdit,
    onPatternCellPatch: handlePatternCellPatch,
    onPatternCellClear: handlePatternCellClear,
    onSequencerCellEdit: handleSequencerCellEdit,
    onExportPatternDump: handleExportPatternDump,
    midiControls,
    onExportWav: handleExportWav,
    onStartCapture: handleStartCapture,
    onStopCapture: stopCapture,
    offlineExportState,
    isExporting,
    captureState,
    isRecording,
    getRendererBackend: () => window.currentPatternRenderer?.backend ?? null,
    dualAudioContext: activeEngine === 'native-worklet',
  }), [
    setIs3DMode, copyShareLink, mediaItem, mediaVisible, mediaFades, currentModuleFileName,
    moduleMediaHintText, handleMediaRemove, handleMediaAdd, handleRemoteMediaSelect,
    shadersQuery.data, shadersQuery.isLoading, shadersQuery.isFetching, shaderCatalogErrorMessage,
    rateShaderMutation, validShaderFavorites, validShaderRecents, localLibrary, activeLibraryEntryId,
    handleLocalLibraryPlay, playlist, isPlaying, handlePlaylistSelect, handlePlaylistPrev,
    handlePlaylistNext, handlePlaylistFilesAdded, songsQuery, libraryErrorMessage,
    handleLibrarySongLoad, syncLibraryMutation, activeModuleForSave, saveSongMutation,
    saveSongErrorMessage, patternEdit, handlePatternCellEdit, handlePatternCellPatch,
    handlePatternCellClear, handleSequencerCellEdit, handlePatternRevert, handleExportPatternDump,
    midiControls, handleExportWav, handleStartCapture, stopCapture, offlineExportState,
    isExporting, captureState, isRecording, activeEngine, setMediaVisible, setMediaItem, setMediaFades,
  ]);
}
