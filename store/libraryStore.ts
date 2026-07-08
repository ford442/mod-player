import { create } from 'zustand';
import { useMemo } from 'react';
import type { LibraryEntry, LibraryFilter, LibraryFormatFilter, LibraryRoot, LibrarySortBy } from '../types/localLibrary';
import {
  deleteLibraryEntry,
  deleteLibraryRoot,
  loadLibraryEntries,
  loadLibraryRoots,
  mergeLibraryScan,
  replaceRootEntries,
  saveLibraryEntries,
} from '../utils/localLibraryDb';

const PERSIST_DEBOUNCE_MS = 400;

let persistTimer: ReturnType<typeof setTimeout> | null = null;
const pendingEntryIds = new Set<string>();

function scheduleEntryPersist(entryId: string): void {
  pendingEntryIds.add(entryId);
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void flushPendingEntryPersists();
  }, PERSIST_DEBOUNCE_MS);
}

async function flushPendingEntryPersists(): Promise<void> {
  const ids = [...pendingEntryIds];
  pendingEntryIds.clear();
  persistTimer = null;
  if (ids.length === 0) return;

  const { entriesById } = useLibraryStore.getState();
  const entries = ids
    .map((id) => entriesById[id])
    .filter((entry): entry is LibraryEntry => entry !== undefined);
  if (entries.length === 0) return;

  try {
    await saveLibraryEntries(entries);
  } catch (err) {
    console.error('[LibraryStore] Failed to persist entry updates', err);
  }
}

function entriesRecordToList(entriesById: Record<string, LibraryEntry>): LibraryEntry[] {
  return Object.values(entriesById);
}

function mergeEntries(
  current: Record<string, LibraryEntry>,
  incoming: LibraryEntry[],
): Record<string, LibraryEntry> {
  const next = { ...current };
  for (const entry of incoming) {
    const existing = next[entry.id];
    if (!existing) {
      next[entry.id] = entry;
      continue;
    }
    const merged: LibraryEntry = { ...entry };
    if (existing.favorite !== undefined) merged.favorite = existing.favorite;
    if (existing.lastPlayed !== undefined) merged.lastPlayed = existing.lastPlayed;
    if (existing.tags !== undefined) merged.tags = existing.tags;
    next[entry.id] = merged;
  }
  return next;
}

export function matchesLibrarySearch(entry: LibraryEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    entry.title.toLowerCase().includes(q) ||
    (entry.artist?.toLowerCase().includes(q) ?? false) ||
    entry.fileName.toLowerCase().includes(q) ||
    entry.relativePath.toLowerCase().includes(q) ||
    (entry.format?.toLowerCase().includes(q) ?? false)
  );
}

export function entryFormat(entry: LibraryEntry): string {
  return (entry.format ?? entry.fileName.split('.').pop() ?? '').toLowerCase();
}

export function filterAndSearchEntries(
  entries: LibraryEntry[],
  query: string,
  filter: LibraryFilter,
  formatFilter: LibraryFormatFilter = 'all',
  sortBy: LibrarySortBy = 'title',
): LibraryEntry[] {
  let result = entries;

  if (formatFilter !== 'all') {
    result = result.filter((entry) => entryFormat(entry) === formatFilter);
  }

  if (filter === 'favorites') {
    result = result.filter((entry) => entry.favorite === true);
  } else if (filter === 'recent') {
    result = result.filter((entry) => entry.lastPlayed !== undefined);
  }

  if (filter === 'recent' || sortBy === 'lastPlayed') {
    result = [...result].sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0));
  } else if (sortBy === 'importedAt') {
    result = [...result].sort((a, b) => b.importedAt - a.importedAt);
  } else {
    result = [...result].sort((a, b) => a.title.localeCompare(b.title));
  }

  if (!query.trim()) return result;
  return result.filter((entry) => matchesLibrarySearch(entry, query));
}

export interface LibraryStoreState {
  roots: LibraryRoot[];
  entriesById: Record<string, LibraryEntry>;
  isHydrated: boolean;
  isLoading: boolean;
  searchQuery: string;
  filter: LibraryFilter;
  formatFilter: LibraryFormatFilter;
  sortBy: LibrarySortBy;
  hydrate: () => Promise<void>;
  setSearchQuery: (query: string) => void;
  setFilter: (filter: LibraryFilter) => void;
  setFormatFilter: (format: LibraryFormatFilter) => void;
  setSortBy: (sort: LibrarySortBy) => void;
  addSongs: (entries: LibraryEntry[]) => void;
  addRoot: (root: LibraryRoot) => void;
  removeSong: (entryId: string) => Promise<void>;
  removeRoot: (rootId: string) => Promise<void>;
  updateSong: (entryId: string, patch: Partial<LibraryEntry>) => void;
  toggleFavorite: (entryId: string) => void;
  markPlayed: (entryId: string) => void;
  mergeScan: (root: LibraryRoot, entries: LibraryEntry[]) => Promise<void>;
  replaceRoot: (root: LibraryRoot, entries: LibraryEntry[]) => Promise<void>;
  getEntry: (entryId: string) => LibraryEntry | undefined;
  getFilteredEntries: () => LibraryEntry[];
}

export const useLibraryStore = create<LibraryStoreState>((set, get) => ({
  roots: [],
  entriesById: {},
  isHydrated: false,
  isLoading: false,
  searchQuery: '',
  filter: 'all',
  formatFilter: 'all',
  sortBy: 'title',

  hydrate: async () => {
    if (get().isHydrated || get().isLoading) return;
    set({ isLoading: true });
    try {
      const [roots, entries] = await Promise.all([loadLibraryRoots(), loadLibraryEntries()]);
      const entriesById: Record<string, LibraryEntry> = {};
      for (const entry of entries) {
        entriesById[entry.id] = entry;
      }
      set({ roots, entriesById, isHydrated: true });
    } catch (err) {
      console.error('[LibraryStore] Hydration failed', err);
    } finally {
      set({ isLoading: false });
    }
  },

  setSearchQuery: (query) => set({ searchQuery: query }),

  setFilter: (filter) => set({ filter }),

  setFormatFilter: (formatFilter) => set({ formatFilter }),

  setSortBy: (sortBy) => set({ sortBy }),

  addSongs: (entries) => {
    set((state) => ({
      entriesById: mergeEntries(state.entriesById, entries),
    }));
  },

  addRoot: (root) => {
    set((state) => ({
      roots: [...state.roots.filter((r) => r.id !== root.id), root],
    }));
  },

  removeSong: async (entryId) => {
    set((state) => {
      const next = { ...state.entriesById };
      delete next[entryId];
      return { entriesById: next };
    });
    try {
      await deleteLibraryEntry(entryId);
    } catch (err) {
      console.error('[LibraryStore] Failed to delete entry', err);
    }
  },

  removeRoot: async (rootId) => {
    set((state) => ({
      roots: state.roots.filter((r) => r.id !== rootId),
      entriesById: Object.fromEntries(
        Object.entries(state.entriesById).filter(([, entry]) => entry.rootId !== rootId),
      ),
    }));
    try {
      await deleteLibraryRoot(rootId);
    } catch (err) {
      console.error('[LibraryStore] Failed to delete root', err);
    }
  },

  updateSong: (entryId, patch) => {
    set((state) => {
      const existing = state.entriesById[entryId];
      if (!existing) return state;
      const updated = { ...existing, ...patch, id: existing.id };
      scheduleEntryPersist(entryId);
      return {
        entriesById: { ...state.entriesById, [entryId]: updated },
      };
    });
  },

  toggleFavorite: (entryId) => {
    const entry = get().entriesById[entryId];
    if (!entry) return;
    get().updateSong(entryId, { favorite: !entry.favorite });
  },

  markPlayed: (entryId) => {
    get().updateSong(entryId, { lastPlayed: Date.now() });
  },

  mergeScan: async (root, entries) => {
    await mergeLibraryScan(root, entries);
    set((state) => ({
      roots: [...state.roots.filter((r) => r.id !== root.id), root],
      entriesById: mergeEntries(
        Object.fromEntries(
          Object.entries(state.entriesById).filter(([, entry]) => entry.rootId !== root.id),
        ),
        entries,
      ),
    }));
  },

  replaceRoot: async (root, entries) => {
    await replaceRootEntries(root, entries);
    set((state) => ({
      roots: state.roots.map((r) => (r.id === root.id ? root : r)),
      entriesById: mergeEntries(
        Object.fromEntries(
          Object.entries(state.entriesById).filter(([, entry]) => entry.rootId !== root.id),
        ),
        entries,
      ),
    }));
  },

  getEntry: (entryId) => get().entriesById[entryId],

  getFilteredEntries: () => {
    const { entriesById, searchQuery, filter, formatFilter, sortBy } = get();
    return filterAndSearchEntries(entriesRecordToList(entriesById), searchQuery, filter, formatFilter, sortBy);
  },
}));

/** Reactive hook for library index queries (search, filter, favorites, recent). */
export function useLocalLibraryIndex() {
  const roots = useLibraryStore((s) => s.roots);
  const entries = useLibraryStore((s) => s.entriesById);
  const isLoading = useLibraryStore((s) => s.isLoading);
  const isHydrated = useLibraryStore((s) => s.isHydrated);
  const searchQuery = useLibraryStore((s) => s.searchQuery);
  const filter = useLibraryStore((s) => s.filter);
  const formatFilter = useLibraryStore((s) => s.formatFilter);
  const sortBy = useLibraryStore((s) => s.sortBy);
  const setSearchQuery = useLibraryStore((s) => s.setSearchQuery);
  const setFilter = useLibraryStore((s) => s.setFilter);
  const setFormatFilter = useLibraryStore((s) => s.setFormatFilter);
  const setSortBy = useLibraryStore((s) => s.setSortBy);
  const toggleFavorite = useLibraryStore((s) => s.toggleFavorite);
  const markPlayed = useLibraryStore((s) => s.markPlayed);
  const removeSong = useLibraryStore((s) => s.removeSong);
  const hydrate = useLibraryStore((s) => s.hydrate);

  const allEntries = useMemo(() => Object.values(entries), [entries]);
  const filteredEntries = useMemo(
    () => filterAndSearchEntries(allEntries, searchQuery, filter, formatFilter, sortBy),
    [allEntries, searchQuery, filter, formatFilter, sortBy],
  );

  return {
    roots,
    entries: allEntries,
    filteredEntries,
    isLoading,
    isHydrated,
    searchQuery,
    filter,
    formatFilter,
    sortBy,
    setSearchQuery,
    setFilter,
    setFormatFilter,
    setSortBy,
    toggleFavorite,
    markPlayed,
    removeSong,
    hydrate,
  };
}
