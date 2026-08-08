import { useState, useCallback } from 'react';
import { fetchRemoteModule, inferFileNameFromUrl } from '../utils/remoteMedia';
import type { RemoteSong } from '../utils/storageApi';
import type { LibraryEntry } from '../types/localLibrary';
import type { usePlaylist } from '../hooks/usePlaylist';
import type { useLocalLibrary } from '../hooks/useLocalLibrary';

type Playlist = ReturnType<typeof usePlaylist>;
type LocalLibrary = ReturnType<typeof useLocalLibrary>;

export interface UseAppPlaylistHandlersParams {
  playlist: Playlist;
  loadFileWithHash: (fileData: Uint8Array, fileName: string) => void;
  setModuleSourceUrl: React.Dispatch<React.SetStateAction<string | null>>;
  localLibrary: LocalLibrary;
}

export function useAppPlaylistHandlers(params: UseAppPlaylistHandlersParams) {
  const { playlist, loadFileWithHash, setModuleSourceUrl, localLibrary } = params;

  const [activeLibraryEntryId, setActiveLibraryEntryId] = useState<string | null>(null);

  const handlePlaylistSelect = useCallback((index: number) => {
    const item = playlist.select(index);
    if (item) loadFileWithHash(item.fileData, item.fileName);
  }, [playlist, loadFileWithHash]);

  const handlePlaylistNext = useCallback(() => {
    const item = playlist.next();
    if (item) loadFileWithHash(item.fileData, item.fileName);
  }, [playlist, loadFileWithHash]);

  const handlePlaylistPrev = useCallback(() => {
    const item = playlist.prev();
    if (item) loadFileWithHash(item.fileData, item.fileName);
  }, [playlist, loadFileWithHash]);

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
    loadFileWithHash(fileData, fileName);
  }, [loadFileWithHash, playlist, setModuleSourceUrl]);

  const handleLocalLibraryPlay = useCallback(async (entry: LibraryEntry) => {
    const file = await localLibrary.resolveEntryFile(entry);
    const data = new Uint8Array(await file.arrayBuffer());
    loadFileWithHash(data, entry.fileName);
    localLibrary.markPlayed(entry.id);
    setActiveLibraryEntryId(entry.id);
  }, [localLibrary.resolveEntryFile, localLibrary.markPlayed, loadFileWithHash]);

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
