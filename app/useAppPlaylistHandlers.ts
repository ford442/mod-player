import { useState, useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import type { PlaylistItem } from '../components/Playlist';
import { usePlayerEngineInstance } from '../hooks/usePlayerEngine';
import { usePlaylistStore } from '../store/playlistStore';
import { createLogger } from '../utils/log';
import { playlistItemAfterSongEnded, type PlaylistOwnedLoad } from './playlistAutoAdvance';
import { fetchRemoteModule, inferFileNameFromUrl } from '../utils/remoteMedia';
import type { RemoteSong } from '../utils/storageApi';
import type { LibraryEntry } from '../types/localLibrary';
import type { usePlaylist } from '../hooks/usePlaylist';
import type { useLocalLibrary } from '../hooks/useLocalLibrary';

type Playlist = ReturnType<typeof usePlaylist>;
type LocalLibrary = ReturnType<typeof useLocalLibrary>;

const log = createLogger('Playlist');

export interface UseAppPlaylistHandlersParams {
  playlist: Playlist;
  loadFileWithHash: (fileData: Uint8Array, fileName: string) => void;
  setModuleSourceUrl: React.Dispatch<React.SetStateAction<string | null>>;
  localLibrary: LocalLibrary;
  /** Unsaved pattern edits: a song that plays out then does not advance (no discard prompt mid-set). */
  patternEditDirtyRef: MutableRefObject<boolean>;
}

export function useAppPlaylistHandlers(params: UseAppPlaylistHandlersParams) {
  const { playlist, loadFileWithHash, setModuleSourceUrl, localLibrary, patternEditDirtyRef } = params;
  const engine = usePlayerEngineInstance();

  const [activeLibraryEntryId, setActiveLibraryEntryId] = useState<string | null>(null);

  // The playlist item the playlist last loaded: only that song, when it plays out, advances it.
  const ownedLoadRef = useRef<PlaylistOwnedLoad | null>(null);

  const loadPlaylistItem = useCallback((item: PlaylistItem | null) => {
    if (!item) return;
    ownedLoadRef.current = { id: item.id, fileName: item.fileName };
    loadFileWithHash(item.fileData, item.fileName);
  }, [loadFileWithHash]);

  const handlePlaylistSelect = useCallback((index: number) => {
    loadPlaylistItem(playlist.select(index));
  }, [playlist, loadPlaylistItem]);

  const handlePlaylistNext = useCallback(() => {
    loadPlaylistItem(playlist.next());
  }, [playlist, loadPlaylistItem]);

  const handlePlaylistPrev = useCallback(() => {
    loadPlaylistItem(playlist.prev());
  }, [playlist, loadPlaylistItem]);

  // Auto-advance (phase 1: plain stop-and-load). The engine reports a song that played out with the
  // loop off; looping songs never end (libopenmpt loops them natively).
  useEffect(() => engine.onSongEnded(() => {
    const item = playlistItemAfterSongEnded({
      owned: ownedLoadRef.current,
      endedFileName: engine.getSnapshot().moduleFileName,
      patternEditDirty: patternEditDirtyRef.current,
      store: usePlaylistStore.getState(),
    });
    if (!item) return;
    log.log('Song ended — playing next:', item.fileName);
    loadPlaylistItem(item);
  }), [engine, loadPlaylistItem, patternEditDirtyRef]);

  const handlePlaylistFilesAdded = useCallback((files: FileList) => {
    playlist.addFiles(files);
  }, [playlist]);

  const handleLibrarySongLoad = useCallback(async (song: RemoteSong) => {
    const fileData = await fetchRemoteModule(song.downloadUrl);
    const fileName = song.fileName || inferFileNameFromUrl(song.downloadUrl);
    setModuleSourceUrl(song.downloadUrl);
    const remotePlaylistId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? `remote-${crypto.randomUUID()}`
      : `remote-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    playlist.addItem({
      id: remotePlaylistId,
      fileName,
      fileData,
    });
    ownedLoadRef.current = null;
    loadFileWithHash(fileData, fileName);
  }, [loadFileWithHash, playlist, setModuleSourceUrl]);

  const { resolveEntryFile, markPlayed } = localLibrary;
  const handleLocalLibraryPlay = useCallback(async (entry: LibraryEntry) => {
    const file = await resolveEntryFile(entry);
    const data = new Uint8Array(await file.arrayBuffer());
    ownedLoadRef.current = null;
    loadFileWithHash(data, entry.fileName);
    markPlayed(entry.id);
    setActiveLibraryEntryId(entry.id);
  }, [resolveEntryFile, markPlayed, loadFileWithHash]);

  return {
    activeLibraryEntryId,
    handlePlaylistSelect,
    handlePlaylistNext,
    handlePlaylistPrev,
    handlePlaylistFilesAdded,
    handleLibrarySongLoad,
    handleLocalLibraryPlay,
  };
}
