import type { LibOpenMPT } from '../types';

/** Standard libopenmpt metadata keys probed on every module. */
const METADATA_KEYS = ['title', 'artist', 'type', 'container', 'message'] as const;

export type ModuleMetadataKey = (typeof METADATA_KEYS)[number];

export interface ModuleMetadata {
  /** Always present — module title or a filename / "Unknown" fallback. */
  title: string;
  artist?: string;
  type?: string;
  container?: string;
  message?: string;
  /** Set when the file could not be parsed; other fields may be absent. */
  parseError?: string;
}

export interface GetModuleMetadataOptions {
  /** Used for title fallback when the module has no embedded title. */
  fileName?: string;
}

const LIB_INIT_TIMEOUT_MS = 30_000;

function emptyToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Derive a display title from a filename when module metadata is empty. */
export function titleFromFileName(fileName: string): string {
  const base = fileName.replace(/^.*[/\\]/, '').replace(/\.[^.]+$/, '');
  return base.length > 0 ? base : 'Unknown';
}

export function resolveModuleTitle(rawTitle: string, fileName?: string): string {
  return emptyToUndefined(rawTitle) ?? (fileName ? titleFromFileName(fileName) : 'Unknown');
}

function readMetadataKey(lib: LibOpenMPT, modPtr: number, key: string): string {
  const keyPtr = lib.stringToUTF8(key);
  const valPtr = lib._openmpt_module_get_metadata(modPtr, keyPtr);
  const value = valPtr ? lib.UTF8ToString(valPtr) : '';
  if (valPtr) {
    lib._openmpt_free_string(valPtr);
  }
  return value;
}

function buildMetadataRecord(
  raw: Partial<Record<ModuleMetadataKey, string>>,
  fileName?: string,
): ModuleMetadata {
  const title = resolveModuleTitle(raw.title ?? '', fileName);
  const metadata: ModuleMetadata = { title };

  const artist = emptyToUndefined(raw.artist ?? '');
  if (artist) metadata.artist = artist;

  const type = emptyToUndefined(raw.type ?? '');
  if (type) metadata.type = type;

  const container = emptyToUndefined(raw.container ?? '');
  if (container) metadata.container = container;

  const message = emptyToUndefined(raw.message ?? '');
  if (message) metadata.message = message;

  return metadata;
}

function fallbackMetadata(fileName: string | undefined, error: string): ModuleMetadata {
  return {
    title: fileName ? titleFromFileName(fileName) : 'Unknown',
    parseError: error,
  };
}

/**
 * Lightweight metadata probe using an already-initialized libopenmpt instance.
 * Creates a temporary module, reads metadata keys, and destroys it immediately.
 * Does not extract patterns or start playback.
 */
export function extractModuleMetadataWithLib(
  lib: LibOpenMPT,
  fileData: Uint8Array,
  options: GetModuleMetadataOptions = {},
): ModuleMetadata {
  if (fileData.byteLength === 0) {
    return fallbackMetadata(options.fileName, 'Empty file');
  }

  if (typeof lib._openmpt_module_create_from_memory2 !== 'function') {
    return fallbackMetadata(options.fileName, 'libopenmpt module API not ready');
  }

  const bufferSize = fileData.byteLength;
  const bufferPtr = lib._malloc(bufferSize);
  lib.HEAPU8.set(fileData, bufferPtr);

  const modPtr = lib._openmpt_module_create_from_memory2(
    bufferPtr,
    bufferSize,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
  );
  lib._free(bufferPtr);

  if (modPtr === 0) {
    return fallbackMetadata(options.fileName, 'Failed to load module (invalid or unsupported format)');
  }

  try {
    const raw: Partial<Record<ModuleMetadataKey, string>> = {};
    for (const key of METADATA_KEYS) {
      raw[key] = readMetadataKey(lib, modPtr, key);
    }
    return buildMetadataRecord(raw, options.fileName);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown metadata extraction error';
    return fallbackMetadata(options.fileName, message);
  } finally {
    lib._openmpt_module_destroy(modPtr);
  }
}

async function waitForLibOpenMPT(): Promise<LibOpenMPT> {
  if (typeof window === 'undefined' || !window.libopenmptReady) {
    throw new Error('libopenmpt is not available (window.libopenmptReady missing)');
  }

  const timeout = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error(`libopenmpt init timeout after ${LIB_INIT_TIMEOUT_MS}ms`)),
      LIB_INIT_TIMEOUT_MS,
    );
  });

  return Promise.race([window.libopenmptReady, timeout]);
}

/**
 * Probe tracker module metadata from raw file bytes.
 * Waits for libopenmpt WASM init, creates a short-lived module handle, and returns
 * title/artist/type/container/message without pattern extraction or playback.
 */
export async function getModuleMetadata(
  arrayBuffer: ArrayBuffer,
  options: GetModuleMetadataOptions = {},
): Promise<ModuleMetadata> {
  try {
    const lib = await waitForLibOpenMPT();
    return extractModuleMetadataWithLib(lib, new Uint8Array(arrayBuffer), options);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'libopenmpt unavailable';
    return fallbackMetadata(options.fileName, message);
  }
}
