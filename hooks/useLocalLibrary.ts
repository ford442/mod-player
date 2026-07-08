import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LibOpenMPT } from '../types';
import type { LibraryEntry, LibraryImportProgress, LibraryRoot } from '../types/localLibrary';
import { useLibraryStore } from '../store/libraryStore';
import {
  ensureDirectoryReadPermission,
  importDirectoryHandle,
  importWebkitFileList,
  isFileSystemAccessSupported,
  pickDirectoryHandle,
  resolveFileFromDirectoryHandle,
} from '../utils/folderImport';

const LIB_INIT_TIMEOUT_MS = 30_000;

async function waitForLibOpenMPT(): Promise<LibOpenMPT> {
  if (typeof window === 'undefined' || !window.libopenmptReady) {
    throw new Error('libopenmpt is not available');
  }
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error(`libopenmpt init timeout after ${LIB_INIT_TIMEOUT_MS}ms`)),
      LIB_INIT_TIMEOUT_MS,
    );
  });
  return Promise.race([window.libopenmptReady, timeout]);
}

export interface UseLocalLibraryReturn {
  roots: LibraryRoot[];
  entries: LibraryEntry[];
  isLoading: boolean;
  isImporting: boolean;
  importProgress: LibraryImportProgress | null;
  importError: string | null;
  fsAccessSupported: boolean;
  importFolder: () => Promise<void>;
  importWebkitFiles: (files: FileList | File[]) => Promise<void>;
  rescanRoot: (rootId: string) => Promise<void>;
  cancelImport: () => void;
  removeRoot: (rootId: string) => Promise<void>;
  resolveEntryFile: (entry: LibraryEntry) => Promise<File>;
  reload: () => Promise<void>;
  markPlayed: (entryId: string) => void;
}

export function useLocalLibrary(): UseLocalLibraryReturn {
  const roots = useLibraryStore((s) => s.roots);
  const entriesById = useLibraryStore((s) => s.entriesById);
  const isLoading = useLibraryStore((s) => s.isLoading);
  const hydrate = useLibraryStore((s) => s.hydrate);
  const mergeScan = useLibraryStore((s) => s.mergeScan);
  const replaceRoot = useLibraryStore((s) => s.replaceRoot);
  const removeRootFromStore = useLibraryStore((s) => s.removeRoot);
  const markPlayed = useLibraryStore((s) => s.markPlayed);

  const entries = useMemo(() => Object.values(entriesById), [entriesById]);

  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<LibraryImportProgress | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const sessionFilesRef = useRef<Map<string, File>>(new Map());

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const reload = useCallback(async () => {
    useLibraryStore.setState({ isHydrated: false });
    await hydrate();
  }, [hydrate]);

  const cacheSessionFiles = useCallback((scannedEntries: LibraryEntry[], files: File[]) => {
    const byPath = new Map<string, File>();
    for (const file of files) {
      const path = file.webkitRelativePath || file.name;
      byPath.set(path, file);
    }
    for (const entry of scannedEntries) {
      const file = byPath.get(entry.relativePath);
      if (file) sessionFilesRef.current.set(entry.id, file);
    }
  }, []);

  const finishImport = useCallback(
    async (root: LibraryRoot, newEntries: LibraryEntry[], webkitFiles?: File[]) => {
      await mergeScan(root, newEntries);
      if (webkitFiles) cacheSessionFiles(newEntries, webkitFiles);
    },
    [cacheSessionFiles, mergeScan],
  );

  const runImport = useCallback(
    async (runner: (lib: LibOpenMPT, signal: AbortSignal) => Promise<{ root: LibraryRoot; entries: LibraryEntry[]; webkitFiles?: File[] }>) => {
      setImportError(null);
      setIsImporting(true);
      setImportProgress({ phase: 'collecting', done: 0, total: 0, elapsedMs: 0 });

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const lib = await waitForLibOpenMPT();
        const { root, entries: scanned, webkitFiles } = await runner(lib, controller.signal);
        await finishImport(root, scanned, webkitFiles);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          setImportError('Import cancelled');
        } else if (err instanceof Error && err.name === 'AbortError') {
          setImportError('Import cancelled');
        } else {
          const message = err instanceof Error ? err.message : 'Import failed';
          setImportError(message);
        }
      } finally {
        abortRef.current = null;
        setIsImporting(false);
        setImportProgress(null);
      }
    },
    [finishImport],
  );

  const importFolder = useCallback(async () => {
    await runImport(async (lib, signal) => {
      const handle = await pickDirectoryHandle();
      const granted = await ensureDirectoryReadPermission(handle);
      if (!granted) {
        throw new Error('Read permission denied for the selected folder');
      }
      const result = await importDirectoryHandle(handle, lib, setImportProgress, signal);
      return result;
    });
  }, [runImport]);

  const importWebkitFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileArray = Array.from(files);
      await runImport(async (lib, signal) => {
        const result = await importWebkitFileList(fileArray, lib, setImportProgress, signal);
        return { ...result, webkitFiles: fileArray };
      });
    },
    [runImport],
  );

  const rescanRoot = useCallback(
    async (rootId: string) => {
      const root = roots.find((r) => r.id === rootId);
      if (!root?.directoryHandle) {
        setImportError('Re-scan requires a folder imported via Chrome/Edge File System Access');
        return;
      }

      setImportError(null);
      setIsImporting(true);
      setImportProgress({ phase: 'collecting', done: 0, total: 0, elapsedMs: 0 });

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const granted = await ensureDirectoryReadPermission(root.directoryHandle);
        if (!granted) {
          throw new Error('Read permission denied — click the folder permission prompt to re-connect');
        }
        const lib = await waitForLibOpenMPT();
        const result = await importDirectoryHandle(
          root.directoryHandle,
          lib,
          setImportProgress,
          controller.signal,
        );
        const updatedRoot: LibraryRoot = {
          ...result.root,
          id: rootId,
          label: root.label,
          importedAt: Date.now(),
          entryCount: result.entries.length,
          directoryHandle: root.directoryHandle,
        };
        const entriesWithRoot = result.entries.map((e) => ({ ...e, rootId, id: `${rootId}::${e.relativePath}` }));
        await replaceRoot(updatedRoot, entriesWithRoot);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Re-scan failed';
        setImportError(message);
      } finally {
        abortRef.current = null;
        setIsImporting(false);
        setImportProgress(null);
      }
    },
    [roots, replaceRoot],
  );

  const cancelImport = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const removeRoot = useCallback(
    async (rootId: string) => {
      await removeRootFromStore(rootId);
      for (const [id, _file] of sessionFilesRef.current) {
        if (id.startsWith(`${rootId}::`)) sessionFilesRef.current.delete(id);
      }
    },
    [removeRootFromStore],
  );

  const resolveEntryFile = useCallback(
    async (entry: LibraryEntry): Promise<File> => {
      const cached = sessionFilesRef.current.get(entry.id);
      if (cached) return cached;

      const root = roots.find((r) => r.id === entry.rootId);
      if (!root) {
        throw new Error('Library root not found');
      }
      if (root.source === 'fs-access' && root.directoryHandle) {
        const granted = await ensureDirectoryReadPermission(root.directoryHandle);
        if (!granted) {
          throw new Error('Folder access expired — re-import or grant permission when prompted');
        }
        return resolveFileFromDirectoryHandle(root, entry.relativePath);
      }

      throw new Error(
        'This track was imported via a one-time folder pick — re-import the folder to play it',
      );
    },
    [roots],
  );

  return {
    roots,
    entries,
    isLoading,
    isImporting,
    importProgress,
    importError,
    fsAccessSupported: isFileSystemAccessSupported(),
    importFolder,
    importWebkitFiles,
    rescanRoot,
    cancelImport,
    removeRoot,
    resolveEntryFile,
    reload,
    markPlayed,
  };
}
