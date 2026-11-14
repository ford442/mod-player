import { useLayoutEffect, useMemo, useRef } from 'react';
import type { PlayerFeaturesValue } from '../context/PlayerFeaturesContext';
import type { MediaItem } from '../types';
import type { RemoteSong, SongSaveRequest } from '../utils/storageApi';
import type { LibraryEntry } from '../types/localLibrary';
import type { PatternEditField } from '../utils/patternEdit';
import type { useMidiControls } from '../hooks/useMidiControls';
import type { OfflineExportState } from '../hooks/useOfflineExport';
import type { PerformanceCaptureState } from '../hooks/usePerformanceCapture';
import type { usePlaylist } from '../hooks/usePlaylist';
import type { useLocalLibrary } from '../hooks/useLocalLibrary';
import type { useLibrary, useSaveSong, useSyncLibrary } from '../hooks/useLibrary';
import type { useRateShader } from '../hooks/useRateShader';
import type { usePatternEdit } from '../hooks/usePatternEdit';
import type { ExportSampleRate } from '../utils/wavEncoder';

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
  setMediaVisible: (v: boolean) => void;
  setMediaItem: (item: MediaItem | null) => void;
  handleMediaRemove: (id: string) => void;
  setMediaFades: React.Dispatch<React.SetStateAction<{ in: number; out: number }>>;
  handleMediaAdd: (file: File) => void;
  handleRemoteMediaSelect: (item: MediaItem) => void;
  handleFileSelected: (file: File) => void;
  shadersQuery: ShadersQuery;
  shaderCatalogErrorMessage: string | null;
  rateShaderMutation: RateShaderMutation;
  localLibrary: LocalLibrary;
  activeLibraryEntryId: string | null;
  handleLocalLibraryPlay: (entry: import('../types/localLibrary').LibraryEntry) => Promise<void>;
  playlist: Playlist;
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
  handleExportWav: (sampleRate: ExportSampleRate) => void;
  handleStartCapture: () => void;
  stopCapture: () => void;
  offlineExportState: OfflineExportState;
  isExporting: boolean;
  captureState: PerformanceCaptureState;
  isRecording: boolean;
}

export function usePlayerFeaturesValue(params: UsePlayerFeaturesValueParams): PlayerFeaturesValue {
  // Callbacks go through the latest params, so their identities never change: App's handlers,
  // the query / mutation results and the hook return objects (playlist, localLibrary,
  // patternEdit, …) are new objects on most renders, and with them in the dependency list the
  // memo below was rebuilt on every App render — every order change — and so re-rendered every
  // context consumer. Only the data fields below decide when the value changes.
  const latest = useRef(params);
  useLayoutEffect(() => {
    latest.current = params;
  });
  const actions = useMemo(() => {
    const p = () => latest.current;
    return {
      setIs3DMode: (v: boolean) => p().setIs3DMode(v),
      onCopyShareLink: () => { void p().copyShareLink(); },
      setMediaVisible: (v: boolean) => p().setMediaVisible(v),
      setMediaItem: (item: MediaItem | null) => p().setMediaItem(item),
      onMediaRemove: (id: string) => p().handleMediaRemove(id),
      onMediaFadesChange: ((value) => p().setMediaFades(value)) as UsePlayerFeaturesValueParams['setMediaFades'],
      handleMediaAdd: (file: File) => p().handleMediaAdd(file),
      handleRemoteMediaSelect: (item: MediaItem) => p().handleRemoteMediaSelect(item),
      handleFileSelected: (file: File) => p().handleFileSelected(file),
      onRateShader: async (shaderId: string, score: number) => {
        await p().rateShaderMutation.mutateAsync({ id: shaderId, score });
      },
      onLocalLibraryImportFolder: () => { void p().localLibrary.importFolder(); },
      onLocalLibraryImportWebkit: (files: FileList) => { void p().localLibrary.importWebkitFiles(files); },
      onLocalLibraryRescanRoot: (rootId: string) => { void p().localLibrary.rescanRoot(rootId); },
      onLocalLibraryRemoveRoot: (rootId: string) => { void p().localLibrary.removeRoot(rootId); },
      onLocalLibraryCancelImport: () => p().localLibrary.cancelImport(),
      onLocalLibraryPlay: (entry: LibraryEntry) => p().handleLocalLibraryPlay(entry),
      onPlaylistSelect: (index: number) => p().handlePlaylistSelect(index),
      onPlaylistRemove: (index: number) => p().playlist.remove(index),
      onPlaylistClear: () => p().playlist.clear(),
      onPlaylistPrev: () => p().handlePlaylistPrev(),
      onPlaylistNext: () => p().handlePlaylistNext(),
      onPlaylistShuffleToggle: () => p().playlist.toggleShuffle(),
      onPlaylistRepeatCycle: () => p().playlist.cycleRepeat(),
      onPlaylistFilesAdded: (files: FileList) => p().handlePlaylistFilesAdded(files),
      onRefreshLibrary: () => { void p().songsQuery.refetch(); },
      handleLibrarySongLoad: (song: RemoteSong) => p().handleLibrarySongLoad(song),
      onSyncLibrary: async () => { await p().syncLibraryMutation.mutateAsync(); },
      onSaveModule: async (req: SongSaveRequest) => { await p().saveSongMutation.mutateAsync(req); },
      onPatternUndo: () => p().patternEdit.undo(),
      onPatternRedo: () => p().patternEdit.redo(),
      onPatternRevert: () => p().handlePatternRevert(),
      onPatternCellEdit: (row: number, channel: number, field: PatternEditField) => p().handlePatternCellEdit(row, channel, field),
      onPatternCellPatch: (row: number, channel: number, patch: Parameters<PatternEdit['editCell']>[2]) =>
        p().handlePatternCellPatch(row, channel, patch),
      onPatternCellClear: (row: number, channel: number) => p().handlePatternCellClear(row, channel),
      onSequencerCellEdit: (row: number, channel: number) => p().handleSequencerCellEdit(row, channel),
      onExportPatternDump: () => p().handleExportPatternDump(),
      onExportWav: (sampleRate: ExportSampleRate) => p().handleExportWav(sampleRate),
      onStartCapture: () => p().handleStartCapture(),
      onStopCapture: () => p().stopCapture(),
      getRendererBackend: () => window.currentPatternRenderer?.backend ?? null,
    };
  }, []);

  const {
    mediaItem,
    mediaVisible,
    mediaFades,
    currentModuleFileName,
    shadersQuery,
    shaderCatalogErrorMessage,
    rateShaderMutation,
    localLibrary,
    activeLibraryEntryId,
    playlist,
    songsQuery,
    libraryErrorMessage,
    syncLibraryMutation,
    syncLibraryErrorMessage,
    activeModuleForSave,
    saveSongMutation,
    saveSongErrorMessage,
    patternEdit,
    midiControls,
    offlineExportState,
    isExporting,
    captureState,
    isRecording,
  } = params;

  const shaderCatalog = shadersQuery.data;
  const shaderCatalogLoading = shadersQuery.isLoading || shadersQuery.isFetching;
  const ratingInFlightShaderId = rateShaderMutation.isPending ? rateShaderMutation.variables?.id ?? null : null;
  const songsData = songsQuery.data;
  const songsLoading = songsQuery.isLoading;
  const songsRefreshing = songsQuery.isFetching && !songsQuery.isLoading;
  const syncPending = syncLibraryMutation.isPending;
  const savePending = saveSongMutation.isPending;
  const {
    roots: localLibraryRoots,
    isLoading: localLibraryLoading,
    isImporting: localLibraryImporting,
    importProgress: localLibraryImportProgress,
    importError: localLibraryImportError,
    fsAccessSupported: localLibraryFsAccessSupported,
  } = localLibrary;
  const { isDirty: patternEditDirty, canUndo: canPatternUndo, canRedo: canPatternRedo } = patternEdit;

  return useMemo((): PlayerFeaturesValue => ({
    ...actions,
    mediaItem,
    mediaVisible,
    mediaFades,
    moduleMediaFileName: currentModuleFileName,
    shaderCatalog: shaderCatalog ?? EMPTY_CATALOG,
    shaderCatalogLoading,
    shaderCatalogError: shaderCatalogErrorMessage,
    ratingInFlightShaderId,
    localLibraryRoots,
    localLibraryLoading,
    localLibraryImporting,
    localLibraryImportProgress,
    localLibraryImportError,
    localLibraryFsAccessSupported,
    activeLibraryEntryId,
    playlistItems: playlist.items,
    playlistCurrentIndex: playlist.currentIndex,
    playlistShuffle: playlist.shuffle,
    playlistRepeat: playlist.repeat,
    songsData,
    songsLoading,
    songsRefreshing,
    libraryErrorMessage,
    syncPending,
    syncLibraryErrorMessage,
    activeModuleForSave,
    savePending,
    saveSongErrorMessage,
    patternEditDirty,
    canPatternUndo,
    canPatternRedo,
    midiControls,
    offlineExportState,
    isExporting,
    captureState,
    isRecording,
  }), [
    actions, mediaItem, mediaVisible, mediaFades, currentModuleFileName,
    shaderCatalog, shaderCatalogLoading, shaderCatalogErrorMessage, ratingInFlightShaderId,
    localLibraryRoots, localLibraryLoading, localLibraryImporting, localLibraryImportProgress,
    localLibraryImportError, localLibraryFsAccessSupported, activeLibraryEntryId,
    playlist.items, playlist.currentIndex, playlist.shuffle, playlist.repeat,
    songsData, songsLoading, songsRefreshing, libraryErrorMessage, syncPending, syncLibraryErrorMessage,
    activeModuleForSave, savePending, saveSongErrorMessage,
    patternEditDirty, canPatternUndo, canPatternRedo, midiControls,
    offlineExportState, isExporting, captureState, isRecording,
  ]);
}

const EMPTY_CATALOG: NonNullable<PlayerFeaturesValue['shaderCatalog']> = [];
