import { create } from 'zustand';
import type { PlaylistItem } from '../components/Playlist';

/**
 * Playlist state.
 *
 * It replaces a `useState` hook whose `select` / `next` / `prev` read the items through a
 * `setItems` updater and expected that updater to have run before they returned. With an update
 * already queued (the `setCurrentIndex` right before it), React 18 queues the updater instead of
 * running it eagerly, so `select()` returned `null` and clicking an item loaded nothing.
 *
 * A Zustand store reads and writes synchronously: every navigation action returns the item it
 * moved to (or `null`) from the state it just wrote, and nothing runs a side effect inside an
 * updater.
 */

export type PlaylistRepeat = 'none' | 'all' | 'one';

export interface PlaylistState {
  items: PlaylistItem[];
  /** Index of the current item, -1 when none. */
  currentIndex: number;
  shuffle: boolean;
  repeat: PlaylistRepeat;
  /** Indices visited in shuffle mode, most recent last (`prev` walks back through them). */
  shuffleHistory: number[];
}

export interface PlaylistActions {
  addItems: (items: PlaylistItem[]) => void;
  addItem: (item: PlaylistItem) => void;
  /** Reads every file, then appends them in their original order. Rejects if one is unreadable. */
  addFiles: (files: FileList | readonly File[]) => Promise<void>;
  /** Makes `index` current and returns its item, or `null` (index out of range: nothing changes). */
  select: (index: number) => PlaylistItem | null;
  remove: (index: number) => void;
  clear: () => void;
  /** Moves to the next item and returns it; `null` at the end (repeat none) or when empty. */
  next: () => PlaylistItem | null;
  /** Moves to the previous item and returns it; `null` at the start (repeat none) or when empty. */
  prev: () => PlaylistItem | null;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  /**
   * What to play when the current track ends on its own: the same item under repeat-one,
   * otherwise `next()`. `null` means the playlist is done.
   */
  onTrackEnded: () => PlaylistItem | null;
  /** Current item, or `null`. */
  current: () => PlaylistItem | null;
}

export type PlaylistStore = PlaylistState & PlaylistActions;

const INITIAL_STATE: PlaylistState = {
  items: [],
  currentIndex: -1,
  shuffle: false,
  repeat: 'none',
  shuffleHistory: [],
};

/** Random source for shuffle; tests replace it with `setPlaylistRandom`. */
let random: () => number = Math.random;

/** Test hook: deterministic shuffle. Pass `null` to restore `Math.random`. */
export function setPlaylistRandom(fn: (() => number) | null): void {
  random = fn ?? Math.random;
}

function randomIndexExcluding(exclude: number, total: number): number {
  if (total <= 1) return 0;
  // Pick among the other total-1 indices, so one draw always lands on a different track.
  const pick = Math.min(total - 2, Math.floor(random() * (total - 1)));
  return pick >= exclude && exclude >= 0 ? pick + 1 : pick;
}

function newItemId(index: number): string {
  const uuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  return `${Date.now()}-${index}-${uuid}`;
}

export const usePlaylistStore = create<PlaylistStore>()((set, get) => ({
  ...INITIAL_STATE,

  addItems: (items) => {
    if (items.length === 0) return;
    set((s) => ({ items: [...s.items, ...items] }));
  },

  addItem: (item) => {
    set((s) => ({ items: [...s.items, item] }));
  },

  addFiles: async (files) => {
    const list = Array.from(files);
    const items = await Promise.all(list.map(async (file, i): Promise<PlaylistItem> => ({
      id: newItemId(i),
      fileName: file.name,
      fileData: new Uint8Array(await file.arrayBuffer()),
    })));
    get().addItems(items);
  },

  select: (index) => {
    const { items } = get();
    const item = items[index];
    if (index < 0 || item === undefined) return null;
    set((s) => ({
      currentIndex: index,
      shuffleHistory: s.shuffle && s.currentIndex >= 0 && s.currentIndex !== index
        ? [...s.shuffleHistory, s.currentIndex]
        : s.shuffleHistory,
    }));
    return item;
  },

  remove: (index) => {
    const { items, currentIndex, shuffleHistory } = get();
    if (index < 0 || index >= items.length) return;
    const nextItems = items.slice();
    nextItems.splice(index, 1);
    let nextIndex = currentIndex;
    if (index < currentIndex) nextIndex = currentIndex - 1;
    else if (index === currentIndex) nextIndex = Math.min(currentIndex, nextItems.length - 1);
    set({
      items: nextItems,
      currentIndex: nextIndex,
      // Re-map the history onto the shortened list; the removed index drops out.
      shuffleHistory: shuffleHistory
        .filter((i) => i !== index)
        .map((i) => (i > index ? i - 1 : i)),
    });
  },

  clear: () => {
    set({ items: [], currentIndex: -1, shuffleHistory: [] });
  },

  next: () => {
    const { items, currentIndex, shuffle, repeat, shuffleHistory } = get();
    if (items.length === 0) return null;
    let nextIdx: number;
    if (shuffle) {
      nextIdx = randomIndexExcluding(currentIndex, items.length);
    } else {
      nextIdx = currentIndex + 1;
      if (nextIdx >= items.length) {
        if (repeat !== 'all') return null;
        nextIdx = 0;
      }
    }
    set({
      currentIndex: nextIdx,
      shuffleHistory: shuffle && currentIndex >= 0 ? [...shuffleHistory, currentIndex] : shuffleHistory,
    });
    return items[nextIdx] ?? null;
  },

  prev: () => {
    const { items, currentIndex, shuffle, repeat, shuffleHistory } = get();
    if (items.length === 0) return null;
    let prevIdx: number;
    let history = shuffleHistory;
    if (shuffle) {
      const last = history[history.length - 1];
      if (last !== undefined && last < items.length) {
        prevIdx = last;
        history = history.slice(0, -1);
      } else {
        prevIdx = randomIndexExcluding(currentIndex, items.length);
      }
    } else {
      prevIdx = currentIndex - 1;
      if (prevIdx < 0) {
        if (repeat !== 'all') return null;
        prevIdx = items.length - 1;
      }
    }
    set({ currentIndex: prevIdx, shuffleHistory: history });
    return items[prevIdx] ?? null;
  },

  toggleShuffle: () => {
    set((s) => ({ shuffle: !s.shuffle, shuffleHistory: [] }));
  },

  cycleRepeat: () => {
    set((s) => ({ repeat: s.repeat === 'none' ? 'all' : s.repeat === 'all' ? 'one' : 'none' }));
  },

  onTrackEnded: () => {
    const { repeat } = get();
    if (repeat === 'one') return get().current();
    return get().next();
  },

  current: () => {
    const { items, currentIndex } = get();
    return items[currentIndex] ?? null;
  },
}));

/** Test hook: back to an empty playlist with default modes. */
export function resetPlaylistStore(): void {
  usePlaylistStore.setState({ ...INITIAL_STATE });
}
