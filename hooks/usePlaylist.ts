import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { PlaylistItem } from '../components/Playlist';
import { usePlaylistStore, type PlaylistRepeat } from '../store/playlistStore';

export interface UsePlaylistReturn {
  items: PlaylistItem[];
  currentIndex: number;
  shuffle: boolean;
  repeat: PlaylistRepeat;
  addFiles: (files: FileList) => void;
  addItem: (item: PlaylistItem) => void;
  select: (index: number) => PlaylistItem | null;
  remove: (index: number) => void;
  clear: () => void;
  prev: () => PlaylistItem | null;
  next: () => PlaylistItem | null;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  /** Call when the current track ends naturally */
  onTrackEnded: () => PlaylistItem | null;
}

function addFilesReported(files: FileList): void {
  usePlaylistStore.getState().addFiles(files).catch((err: unknown) => {
    // An unreadable file rejects the whole batch; report it rather than leaving an unhandled rejection.
    console.error('Failed to read playlist files:', err);
  });
}

/**
 * React view of `store/playlistStore.ts`. The actions are the store's own (stable identities,
 * synchronous reads), so a caller can use the item `select` / `next` / `prev` return right away.
 * The returned object only changes when the playlist state does.
 */
export function usePlaylist(): UsePlaylistReturn {
  const { items, currentIndex, shuffle, repeat } = usePlaylistStore(useShallow((s) => ({
    items: s.items,
    currentIndex: s.currentIndex,
    shuffle: s.shuffle,
    repeat: s.repeat,
  })));
  return useMemo((): UsePlaylistReturn => {
    const s = usePlaylistStore.getState();
    return {
      items,
      currentIndex,
      shuffle,
      repeat,
      addFiles: addFilesReported,
      addItem: s.addItem,
      select: s.select,
      remove: s.remove,
      clear: s.clear,
      prev: s.prev,
      next: s.next,
      toggleShuffle: s.toggleShuffle,
      cycleRepeat: s.cycleRepeat,
      onTrackEnded: s.onTrackEnded,
    };
  }, [items, currentIndex, shuffle, repeat]);
}
