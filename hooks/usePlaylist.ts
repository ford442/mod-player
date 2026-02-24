import { useState, useCallback, useRef } from 'react';
import type { PlaylistItem } from '../components/Playlist';

interface UsePlaylistReturn {
  items: PlaylistItem[];
  currentIndex: number;
  shuffle: boolean;
  repeat: 'none' | 'all' | 'one';
  addFiles: (files: FileList) => void;
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

export function usePlaylist(): UsePlaylistReturn {
  const [items, setItems] = useState<PlaylistItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<'none' | 'all' | 'one'>('none');
  const shuffleHistoryRef = useRef<number[]>([]);

  const addFiles = useCallback((files: FileList) => {
    const newItems: PlaylistItem[] = [];
    const readers: Promise<void>[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      readers.push(
        file.arrayBuffer().then(buf => {
          newItems.push({
            id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`,
            fileName: file.name,
            fileData: new Uint8Array(buf),
          });
        })
      );
    }

    Promise.all(readers).then(() => {
      setItems(prev => [...prev, ...newItems]);
    });
  }, []);

  const select = useCallback((index: number): PlaylistItem | null => {
    if (index < 0) return null;
    setCurrentIndex(index);
    // Read from current items state
    let result: PlaylistItem | null = null;
    setItems(prev => {
      result = prev[index] ?? null;
      return prev;
    });
    return result;
  }, []);

  const remove = useCallback((index: number) => {
    setItems(prev => {
      const next = [...prev];
      next.splice(index, 1);
      // Adjust currentIndex based on the new array length
      setCurrentIndex(ci => {
        if (index < ci) return ci - 1;
        if (index === ci) return Math.min(ci, next.length - 1);
        return ci;
      });
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setItems([]);
    setCurrentIndex(-1);
    shuffleHistoryRef.current = [];
  }, []);

  const getRandomIndex = useCallback((exclude: number, total: number): number => {
    if (total <= 1) return 0;
    let next: number;
    do {
      next = Math.floor(Math.random() * total);
    } while (next === exclude && total > 1);
    return next;
  }, []);

  const next = useCallback((): PlaylistItem | null => {
    let result: PlaylistItem | null = null;
    setItems(prev => {
      if (prev.length === 0) return prev;
      let nextIdx: number;
      if (shuffle) {
        nextIdx = getRandomIndex(currentIndex, prev.length);
      } else {
        nextIdx = currentIndex + 1;
        if (nextIdx >= prev.length) {
          if (repeat === 'all') nextIdx = 0;
          else return prev; // no more tracks
        }
      }
      setCurrentIndex(nextIdx);
      result = prev[nextIdx] ?? null;
      return prev;
    });
    return result;
  }, [currentIndex, shuffle, repeat, getRandomIndex]);

  const prev = useCallback((): PlaylistItem | null => {
    let result: PlaylistItem | null = null;
    setItems(prev => {
      if (prev.length === 0) return prev;
      let prevIdx: number;
      if (shuffle) {
        prevIdx = getRandomIndex(currentIndex, prev.length);
      } else {
        prevIdx = currentIndex - 1;
        if (prevIdx < 0) {
          if (repeat === 'all') prevIdx = prev.length - 1;
          else return prev;
        }
      }
      setCurrentIndex(prevIdx);
      result = prev[prevIdx] ?? null;
      return prev;
    });
    return result;
  }, [currentIndex, shuffle, repeat, getRandomIndex]);

  const toggleShuffle = useCallback(() => setShuffle(s => !s), []);

  const cycleRepeat = useCallback(() => {
    setRepeat(r => r === 'none' ? 'all' : r === 'all' ? 'one' : 'none');
  }, []);

  const onTrackEnded = useCallback((): PlaylistItem | null => {
    if (repeat === 'one') {
      // Replay current
      let result: PlaylistItem | null = null;
      setItems(prev => {
        result = prev[currentIndex] ?? null;
        return prev;
      });
      return result;
    }
    return next();
  }, [repeat, currentIndex, next]);

  return {
    items,
    currentIndex,
    shuffle,
    repeat,
    addFiles,
    select,
    remove,
    clear,
    prev,
    next,
    toggleShuffle,
    cycleRepeat,
    onTrackEnded,
  };
}
