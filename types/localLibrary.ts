/** Local-first music library types (metadata index + optional FS handles). */

export type LibraryRootSource = 'fs-access' | 'webkit-directory';

export interface LibraryRoot {
  id: string;
  label: string;
  source: LibraryRootSource;
  importedAt: number;
  entryCount: number;
  /** Present when imported via File System Access API (persisted in IndexedDB). */
  directoryHandle?: FileSystemDirectoryHandle;
}

export interface LibraryEntry {
  id: string;
  rootId: string;
  relativePath: string;
  fileName: string;
  title: string;
  artist?: string;
  format?: string;
  type?: string;
  container?: string;
  message?: string;
  size: number;
  lastModified: number;
  importedAt: number;
  parseError?: string;
  favorite?: boolean;
  lastPlayed?: number;
  tags?: string[];
}

/** In-memory index shape — metadata only, safe to keep fully loaded for 2000+ entries. */
export type LibraryIndex = LibraryEntry[];

export type LibraryFilter = 'all' | 'favorites' | 'recent';

export type LibraryFormatFilter = 'all' | 'mod' | 'xm' | 'it' | 's3m';

export type LibrarySortBy = 'title' | 'lastPlayed' | 'importedAt';

export interface LibraryImportProgress {
  phase: 'collecting' | 'scanning';
  done: number;
  total: number;
  currentFile?: string;
  elapsedMs: number;
  estimatedRemainingMs?: number;
}

export interface LibraryScanResult {
  root: LibraryRoot;
  entries: LibraryEntry[];
}
