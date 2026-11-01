import React, { createContext, useContext } from 'react';
import type { PlaylistItem } from '../components/Playlist';
import type { MediaFades } from '../utils/mediaFades';
import type { MediaItem } from '../types';
import type { LibraryEntry, LibraryImportProgress, LibraryRoot } from '../types/localLibrary';
import type { PatternCellPatch, PatternEditField } from '../utils/patternEdit';
import type { RemoteSong, SongSaveRequest, ShaderMeta } from '../utils/storageApi';
import type { useMidiControls } from '../hooks/useMidiControls';
import type { OfflineExportState } from '../hooks/useOfflineExport';
import type { PerformanceCaptureState } from '../hooks/usePerformanceCapture';
import type { ExportSampleRate } from '../utils/wavEncoder';

/**
 * Feature panels, library, media, export — callbacks and state owned by the App composition root.
 * Player state (transport, module, levels) is not here: components select it from the engine
 * (hooks/usePlayerEngine.ts, #492).
 */
export interface PlayerFeaturesValue {
  setIs3DMode: (v: boolean) => void;
  onCopyShareLink?: () => void;
  mediaItem: MediaItem | null;
  mediaVisible: boolean;
  mediaFades?: MediaFades;
  moduleMediaFileName?: string;
  setMediaVisible: (v: boolean) => void;
  setMediaItem: (item: MediaItem | null) => void;
  onMediaRemove: (id: string) => void;
  onMediaFadesChange: (fades: MediaFades) => void;
  handleMediaAdd: (file: File) => void;
  handleRemoteMediaSelect: (item: MediaItem) => void;
  /** Load a module the user picked (file input / drop): source URL cleared, pattern edits confirmed. */
  handleFileSelected: (file: File) => void;
  shaderCatalog: ShaderMeta[];
  shaderCatalogLoading: boolean;
  shaderCatalogError: string | null;
  onRateShader: (shaderId: string, score: number) => Promise<void>;
  ratingInFlightShaderId: string | null;
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
  onExportPatternDump?: () => void;
  midiControls?: ReturnType<typeof useMidiControls>;
  onExportWav: (sampleRate: ExportSampleRate) => void;
  onStartCapture: () => void;
  onStopCapture: () => void;
  offlineExportState: OfflineExportState;
  isExporting: boolean;
  captureState: PerformanceCaptureState;
  isRecording: boolean;
  getRendererBackend: () => import('../src/renderers/types').PatternRendererBackend | null;
}

const PlayerFeaturesContext = createContext<PlayerFeaturesValue | null>(null);

export function PlayerFeaturesProvider({
  value,
  children,
}: {
  value: PlayerFeaturesValue;
  children: React.ReactNode;
}) {
  return <PlayerFeaturesContext.Provider value={value}>{children}</PlayerFeaturesContext.Provider>;
}

export function usePlayerFeatures(): PlayerFeaturesValue {
  const ctx = useContext(PlayerFeaturesContext);
  if (!ctx) {
    throw new Error('usePlayerFeatures must be used within PlayerFeaturesProvider');
  }
  return ctx;
}
