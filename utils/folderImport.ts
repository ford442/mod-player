import type { LibOpenMPT } from '../types';
import type { LibraryEntry, LibraryImportProgress, LibraryRoot, LibraryScanResult } from '../types/localLibrary';
import { extractModuleMetadataWithLib } from './modMetadata';
import { makeEntryId } from './localLibraryDb';

/** Tracker module extensions accepted by the local library importer. */
export const MODULE_EXTENSIONS = new Set([
  '.mod',
  '.xm',
  '.it',
  '.s3m',
  '.mptm',
  '.669',
  '.amf',
  '.stm',
  '.mtm',
]);

export function isModuleFileName(fileName: string): boolean {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return false;
  return MODULE_EXTENSIONS.has(fileName.slice(dot).toLowerCase());
}

export function formatFromFileName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : '';
}

export interface ScannedFileRef {
  relativePath: string;
  fileName: string;
  size: number;
  lastModified: number;
  getArrayBuffer: () => Promise<ArrayBuffer>;
  /** WebKit fallback: retain File for same-session playback. */
  sessionFile?: File;
}

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export async function pickDirectoryHandle(): Promise<FileSystemDirectoryHandle> {
  if (!isFileSystemAccessSupported()) {
    throw new Error('File System Access API is not available in this browser');
  }
  return window.showDirectoryPicker({ mode: 'read' });
}

async function walkDirectoryHandle(
  dir: FileSystemDirectoryHandle,
  basePath: string,
  out: ScannedFileRef[],
): Promise<void> {
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'file') {
      if (!isModuleFileName(name)) continue;
      const fileHandle = handle as FileSystemFileHandle;
      const file = await fileHandle.getFile();
      const relativePath = basePath ? `${basePath}/${name}` : name;
      out.push({
        relativePath,
        fileName: name,
        size: file.size,
        lastModified: file.lastModified,
        getArrayBuffer: () => file.arrayBuffer(),
      });
    } else if (handle.kind === 'directory') {
      await walkDirectoryHandle(
        handle as FileSystemDirectoryHandle,
        basePath ? `${basePath}/${name}` : name,
        out,
      );
    }
  }
}

export async function collectFilesFromDirectoryHandle(
  handle: FileSystemDirectoryHandle,
  onProgress?: (done: number, currentPath: string) => void,
  signal?: AbortSignal,
): Promise<ScannedFileRef[]> {
  const files: ScannedFileRef[] = [];
  let done = 0;

  async function walk(dir: FileSystemDirectoryHandle, basePath: string): Promise<void> {
    for await (const [name, entry] of dir.entries()) {
      if (signal?.aborted) throw new DOMException('Import cancelled', 'AbortError');
      if (entry.kind === 'file') {
        if (!isModuleFileName(name)) continue;
        const fileHandle = entry as FileSystemFileHandle;
        const file = await fileHandle.getFile();
        const relativePath = basePath ? `${basePath}/${name}` : name;
        files.push({
          relativePath,
          fileName: name,
          size: file.size,
          lastModified: file.lastModified,
          getArrayBuffer: () => file.arrayBuffer(),
        });
        done += 1;
        onProgress?.(done, relativePath);
      } else if (entry.kind === 'directory') {
        await walk(
          entry as FileSystemDirectoryHandle,
          basePath ? `${basePath}/${name}` : name,
        );
      }
    }
  }

  await walk(handle, '');
  return files;
}

export function collectFilesFromWebkitFileList(fileList: FileList | File[]): ScannedFileRef[] {
  const files = Array.from(fileList).filter((file) => isModuleFileName(file.name));
  return files.map((file) => ({
    relativePath: file.webkitRelativePath || file.name,
    fileName: file.name,
    size: file.size,
    lastModified: file.lastModified,
    getArrayBuffer: () => file.arrayBuffer(),
    sessionFile: file,
  }));
}

export function inferWebkitRootLabel(files: ScannedFileRef[]): string {
  const first = files[0];
  if (!first) return 'Imported Folder';
  const path = first.relativePath;
  const slash = path.indexOf('/');
  return slash >= 0 ? path.slice(0, slash) : 'Imported Folder';
}

function buildEntryFromMetadata(
  rootId: string,
  file: ScannedFileRef,
  importedAt: number,
): LibraryEntry {
  const format = formatFromFileName(file.fileName);
  const entry: LibraryEntry = {
    id: makeEntryId(rootId, file.relativePath),
    rootId,
    relativePath: file.relativePath,
    fileName: file.fileName,
    title: file.fileName,
    format,
    size: file.size,
    lastModified: file.lastModified,
    importedAt,
  };
  return entry;
}

function applyMetadataToEntry(entry: LibraryEntry, meta: ReturnType<typeof extractModuleMetadataWithLib>): void {
  entry.title = meta.title;
  if (meta.artist) entry.artist = meta.artist;
  if (meta.type) entry.type = meta.type;
  if (meta.container) entry.container = meta.container;
  if (meta.message) entry.message = meta.message;
  if (meta.parseError) entry.parseError = meta.parseError;
}

export async function scanFilesForMetadata(
  rootId: string,
  files: ScannedFileRef[],
  lib: LibOpenMPT,
  onProgress?: (progress: LibraryImportProgress) => void,
  signal?: AbortSignal,
): Promise<LibraryEntry[]> {
  const importedAt = Date.now();
  const startMs = importedAt;
  const entries: LibraryEntry[] = [];
  const total = files.length;

  onProgress?.({
    phase: 'scanning',
    done: 0,
    total,
    elapsedMs: 0,
  });

  for (let i = 0; i < files.length; i++) {
    if (signal?.aborted) throw new DOMException('Import cancelled', 'AbortError');

    const file = files[i];
    if (!file) continue;

    const elapsedMs = Date.now() - startMs;
    const done = i;
    const rate = done > 0 ? elapsedMs / done : 0;
    const estimatedRemainingMs = rate > 0 ? Math.round(rate * (total - done)) : undefined;

    onProgress?.({
      phase: 'scanning',
      done,
      total,
      currentFile: file.relativePath,
      elapsedMs,
      ...(estimatedRemainingMs !== undefined ? { estimatedRemainingMs } : {}),
    });

    const entry = buildEntryFromMetadata(rootId, file, importedAt);
    try {
      const buffer = await file.getArrayBuffer();
      const meta = extractModuleMetadataWithLib(lib, new Uint8Array(buffer), {
        fileName: file.fileName,
      });
      applyMetadataToEntry(entry, meta);
    } catch (err) {
      entry.parseError = err instanceof Error ? err.message : 'Metadata read failed';
    }
    entries.push(entry);

    // Yield so progress UI can paint during large imports.
    if (i % 8 === 7) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  onProgress?.({
    phase: 'scanning',
    done: total,
    total,
    elapsedMs: Date.now() - startMs,
    estimatedRemainingMs: 0,
  });

  return entries;
}

export async function importDirectoryHandle(
  handle: FileSystemDirectoryHandle,
  lib: LibOpenMPT,
  onProgress?: (progress: LibraryImportProgress) => void,
  signal?: AbortSignal,
): Promise<LibraryScanResult> {
  const rootId = crypto.randomUUID();
  const importedAt = Date.now();
  const startMs = importedAt;

  onProgress?.({ phase: 'collecting', done: 0, total: 0, elapsedMs: 0 });

  const files = await collectFilesFromDirectoryHandle(
    handle,
    (_done, currentPath) => {
      onProgress?.({
        phase: 'collecting',
        done: _done,
        total: _done,
        currentFile: currentPath,
        elapsedMs: Date.now() - startMs,
      });
    },
    signal,
  );

  onProgress?.({
    phase: 'collecting',
    done: files.length,
    total: files.length,
    elapsedMs: Date.now() - startMs,
  });

  const entries = await scanFilesForMetadata(rootId, files, lib, onProgress, signal);

  const root: LibraryRoot = {
    id: rootId,
    label: handle.name,
    source: 'fs-access',
    importedAt,
    entryCount: entries.length,
    directoryHandle: handle,
  };

  return { root, entries };
}

export async function importWebkitFileList(
  fileList: FileList | File[],
  lib: LibOpenMPT,
  onProgress?: (progress: LibraryImportProgress) => void,
  signal?: AbortSignal,
): Promise<LibraryScanResult> {
  const files = collectFilesFromWebkitFileList(fileList);
  const rootId = crypto.randomUUID();
  const importedAt = Date.now();

  onProgress?.({
    phase: 'collecting',
    done: files.length,
    total: files.length,
    elapsedMs: 0,
  });

  const entries = await scanFilesForMetadata(rootId, files, lib, onProgress, signal);

  const root: LibraryRoot = {
    id: rootId,
    label: inferWebkitRootLabel(files),
    source: 'webkit-directory',
    importedAt,
    entryCount: entries.length,
  };

  return { root, entries };
}

export async function resolveFileFromDirectoryHandle(
  root: LibraryRoot,
  relativePath: string,
): Promise<File> {
  if (!root.directoryHandle) {
    throw new Error('No directory handle stored for this library root');
  }

  const parts = relativePath.split('/').filter(Boolean);
  if (parts.length === 0) {
    throw new Error('Invalid relative path');
  }

  let dir = root.directoryHandle;
  for (let i = 0; i < parts.length - 1; i++) {
    const segment = parts[i];
    if (!segment) throw new Error('Invalid path segment');
    dir = await dir.getDirectoryHandle(segment);
  }

  const fileName = parts[parts.length - 1];
  if (!fileName) throw new Error('Invalid file name in path');
  const fileHandle = await dir.getFileHandle(fileName);
  return fileHandle.getFile();
}

export async function ensureDirectoryReadPermission(
  handle: FileSystemDirectoryHandle,
): Promise<boolean> {
  const opts: FileSystemHandlePermissionDescriptor = { mode: 'read' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  if ((await handle.requestPermission(opts)) === 'granted') return true;
  return false;
}

/** @deprecated Use collectFilesFromDirectoryHandle — kept for tests */
export { walkDirectoryHandle };
