/**
 * The one list of tracker-module file types the app accepts: every extension the shipped
 * libopenmpt loads (`utils/moduleFormats.generated.ts`, read from the committed wasm by
 * scripts/gen-module-formats.mjs). File pickers, drop targets, folder import and remote-URL
 * checks all go through these helpers — do not hand-type an extension list elsewhere.
 */
import { LIBOPENMPT_MODULE_EXTENSIONS } from './moduleFormats.generated';

/** Lower-case extensions without the dot (`'mod'`, `'xm'`, …), sorted. */
export const MODULE_FILE_EXTENSIONS: readonly string[] = LIBOPENMPT_MODULE_EXTENSIONS;

const EXTENSION_SET: ReadonlySet<string> = new Set(MODULE_FILE_EXTENSIONS);

/** `accept` for an `<input type="file">` that picks modules: `.667,.669,.amf,…`. */
export const MODULE_FILE_ACCEPT = MODULE_FILE_EXTENSIONS.map((ext) => `.${ext}`).join(',');

/** The formats people look for first, for help text; the rest are counted. */
const HEADLINE_FORMATS = ['mod', 'xm', 's3m', 'it', 'mptm', 'mo3'] as const;

/** e.g. "Supports .mod, .xm, .s3m, .it, .mptm, .mo3 and 62 more tracker formats." */
export function moduleFormatsSummary(): string {
  const headline = HEADLINE_FORMATS.filter((ext) => EXTENSION_SET.has(ext));
  const more = MODULE_FILE_EXTENSIONS.length - headline.length;
  const list = headline.map((ext) => `.${ext}`).join(', ');
  return more > 0 ? `Supports ${list} and ${more} more tracker formats.` : `Supports ${list}.`;
}

/** Lower-case extension of a file name or path (no dot); '' if none. `#` / `?` are part of a file name. */
export function moduleFileExtension(fileName: string): string {
  const slash = Math.max(fileName.lastIndexOf('/'), fileName.lastIndexOf('\\'));
  const base = fileName.slice(slash + 1);
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** Whether a file name (or path) ends in an extension libopenmpt loads. */
export function isSupportedModuleFileName(fileName: string): boolean {
  return EXTENSION_SET.has(moduleFileExtension(fileName));
}

/** Whether a URL's path ends in a module extension (query string and hash ignored). */
export function isSupportedModuleUrl(url: string): boolean {
  return isSupportedModuleFileName(url.replace(/[?#].*$/s, ''));
}

/** The module files among `files` (a drop's `FileList`, an input's selection). */
export function filterSupportedModuleFiles(files: Iterable<File> | ArrayLike<File>): File[] {
  return Array.from(files).filter((file) => isSupportedModuleFileName(file.name));
}

/**
 * `files` narrowed to modules, still as a `FileList` (what the playlist's `addFiles` takes): the
 * input itself when every file is a module, else a new list built through `DataTransfer`. Where
 * `DataTransfer` cannot be constructed the input is returned unfiltered (the loader rejects the rest).
 */
export function supportedModuleFileList(files: FileList): FileList {
  const modules = filterSupportedModuleFiles(files);
  if (modules.length === files.length) return files;
  try {
    const transfer = new DataTransfer();
    for (const file of modules) transfer.items.add(file);
    return transfer.files;
  } catch {
    return files;
  }
}
