/**
 * Checked access to the libopenmpt WASM heap for the main thread and the workers.
 *
 * `_malloc` returns 0 when the heap cannot grow, and `HEAPU8.set(bytes, 0)` then silently
 * overwrites low memory (the C runtime's static data). Every main-thread / worker allocation goes
 * through `mallocOrThrow` instead, so an OOM is an ordinary, catchable error.
 *
 * Not for the AudioWorklet bundle (audio-worklet/js/**): the processor has its own checked
 * allocations and must not pull main-thread modules in.
 */
import type { LibOpenMPT } from '../types';

type MallocLib = Pick<LibOpenMPT, '_malloc'>;
type CopyLib = Pick<LibOpenMPT, '_malloc' | '_free' | 'HEAPU8'>;
type StringLib = Pick<LibOpenMPT, 'stringToUTF8' | '_free'>;

/** `_malloc(size)`, or throw when it returns 0 (out of WASM heap memory). */
export function mallocOrThrow(lib: MallocLib, size: number, what = 'buffer'): number {
  const ptr = lib._malloc(size);
  if (!ptr) throw new Error(`_malloc(${size}) returned 0 for ${what} – out of WASM heap memory`);
  return ptr;
}

/** Copy `bytes` into a fresh heap block. The caller frees the returned pointer. */
export function copyToHeap(lib: CopyLib, bytes: Uint8Array, what = 'module data'): number {
  // malloc(0) may legitimately return 0; a 1-byte block keeps "0 means failure" unambiguous.
  const ptr = mallocOrThrow(lib, Math.max(1, bytes.byteLength), what);
  lib.HEAPU8.set(bytes, ptr);
  return ptr;
}

/**
 * Create a libopenmpt module from in-memory file bytes. The heap copy of the file is freed on
 * every path (libopenmpt copies what it keeps). Returns 0 when libopenmpt rejects the file;
 * throws when the heap cannot hold the copy.
 */
export function createModuleFromBytes(
  lib: CopyLib & Pick<LibOpenMPT, '_openmpt_module_create_from_memory2'>,
  bytes: Uint8Array,
): number {
  const ptr = copyToHeap(lib, bytes);
  try {
    return lib._openmpt_module_create_from_memory2(ptr, bytes.byteLength, 0, 0, 0, 0, 0, 0, 0);
  } finally {
    lib._free(ptr);
  }
}

/** Run `fn` with `str` as a NUL-terminated C string on the heap, freed when `fn` returns or throws. */
export function withCString<T>(lib: StringLib, str: string, fn: (ptr: number) => T): T {
  const ptr = lib.stringToUTF8(str);
  if (!ptr) throw new Error(`could not allocate the C string "${str}" – out of WASM heap memory`);
  try {
    return fn(ptr);
  } finally {
    lib._free(ptr);
  }
}

/** `openmpt_module_get_metadata(key)` as a JS string ('' when absent). Frees the key and the value. */
export function readMetadataString(
  lib: StringLib & Pick<LibOpenMPT, '_openmpt_module_get_metadata' | 'UTF8ToString' | '_openmpt_free_string'>,
  modPtr: number,
  key: string,
): string {
  return withCString(lib, key, (keyPtr) => {
    const valuePtr = lib._openmpt_module_get_metadata(modPtr, keyPtr);
    if (!valuePtr) return '';
    try {
      return lib.UTF8ToString(valuePtr);
    } finally {
      lib._openmpt_free_string(valuePtr);
    }
  });
}
