/**
 * Checked WASM heap access (utils/wasmHeap.ts): a `_malloc` that returns 0 must never turn into
 * `HEAPU8.set(bytes, 0)`, and every temporary allocation (file copy, C string) is freed on every
 * path — including the libopenmpt metadata keys the parser used to leak.
 */
import { describe, expect, it, vi } from 'vitest';
import type { LibOpenMPT } from '../../types';
import {
  copyToHeap,
  createModuleFromBytes,
  mallocOrThrow,
  readMetadataString,
  withCString,
} from '../../utils/wasmHeap';

/** A bump-allocating fake heap that tracks live blocks; `failAfter` makes later mallocs return 0. */
function fakeHeap(size = 4096, failAfter = Infinity) {
  const HEAPU8 = new Uint8Array(size);
  let next = 64;
  let calls = 0;
  const live = new Set<number>();
  const lib = {
    HEAPU8,
    _malloc: vi.fn((n: number) => {
      if (++calls > failAfter || next + n > size) return 0;
      const ptr = next;
      next += Math.max(n, 1);
      live.add(ptr);
      return ptr;
    }),
    _free: vi.fn((ptr: number) => {
      if (!live.delete(ptr)) throw new Error(`free of a pointer not allocated: ${ptr}`);
    }),
    stringToUTF8: (s: string) => {
      const bytes = new TextEncoder().encode(s + '\0');
      const ptr = lib._malloc(bytes.length);
      if (ptr) HEAPU8.set(bytes, ptr);
      return ptr;
    },
    UTF8ToString: (ptr: number) => {
      let end = ptr;
      while (HEAPU8[end]) end++;
      return new TextDecoder().decode(HEAPU8.subarray(ptr, end));
    },
  };
  return { lib, live, HEAPU8 };
}

describe('mallocOrThrow', () => {
  it('returns the pointer', () => {
    const { lib } = fakeHeap();
    expect(mallocOrThrow(lib, 16)).toBe(64);
  });

  it('throws instead of returning 0', () => {
    const { lib } = fakeHeap(4096, 0);
    expect(() => mallocOrThrow(lib, 16, 'render buffer')).toThrow(/_malloc\(16\) returned 0 for render buffer/);
  });
});

describe('copyToHeap', () => {
  it('copies the bytes at the returned pointer', () => {
    const { lib, HEAPU8 } = fakeHeap();
    const ptr = copyToHeap(lib, new Uint8Array([1, 2, 3]));
    expect(Array.from(HEAPU8.subarray(ptr, ptr + 3))).toEqual([1, 2, 3]);
  });

  it('on OOM throws and never writes to address 0', () => {
    const { lib, HEAPU8 } = fakeHeap(4096, 0);
    expect(() => copyToHeap(lib, new Uint8Array([9, 9, 9, 9]))).toThrow(/out of WASM heap memory/);
    expect(Array.from(HEAPU8.subarray(0, 8))).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('createModuleFromBytes', () => {
  const withCreate = (create: (ptr: number, size: number) => number) => {
    const heap = fakeHeap();
    const lib = { ...heap.lib, _openmpt_module_create_from_memory2: vi.fn(create) };
    return { lib, live: heap.live };
  };

  it('frees the file copy after a successful create', () => {
    const { lib, live } = withCreate(() => 1234);
    expect(createModuleFromBytes(lib, new Uint8Array(10))).toBe(1234);
    expect(lib._openmpt_module_create_from_memory2).toHaveBeenCalledWith(64, 10, 0, 0, 0, 0, 0, 0, 0);
    expect(live.size).toBe(0);
  });

  it('returns 0 for a rejected file, still freeing the copy', () => {
    const { lib, live } = withCreate(() => 0);
    expect(createModuleFromBytes(lib, new Uint8Array(10))).toBe(0);
    expect(live.size).toBe(0);
  });

  it('frees the copy when create traps', () => {
    const { lib, live } = withCreate(() => { throw new Error('RuntimeError: unreachable'); });
    expect(() => createModuleFromBytes(lib, new Uint8Array(10))).toThrow(/unreachable/);
    expect(live.size).toBe(0);
  });

  it('throws before create when the heap is full', () => {
    const heap = fakeHeap(4096, 0);
    const create = vi.fn(() => 1);
    expect(() => createModuleFromBytes({ ...heap.lib, _openmpt_module_create_from_memory2: create }, new Uint8Array(4))).toThrow();
    expect(create).not.toHaveBeenCalled();
  });
});

describe('withCString / readMetadataString', () => {
  it('frees the C string when the callback throws', () => {
    const { lib, live } = fakeHeap();
    expect(() => withCString(lib, 'title', () => { throw new Error('boom'); })).toThrow('boom');
    expect(live.size).toBe(0);
  });

  it('throws when the string cannot be allocated', () => {
    const { lib } = fakeHeap(4096, 0);
    expect(() => withCString(lib, 'title', () => 1)).toThrow(/out of WASM heap memory/);
  });

  it('reads a metadata value and frees both the key and the value', () => {
    const { lib, live, HEAPU8 } = fakeHeap();
    const freeString = vi.fn();
    const meta = {
      ...lib,
      _openmpt_free_string: freeString,
      _openmpt_module_get_metadata: vi.fn((_mod: number, keyPtr: number) => {
        expect(lib.UTF8ToString(keyPtr)).toBe('title');
        HEAPU8.set(new TextEncoder().encode('Song\0'), 2048);
        return 2048;
      }),
    } as unknown as LibOpenMPT;
    expect(readMetadataString(meta, 7, 'title')).toBe('Song');
    expect(freeString).toHaveBeenCalledWith(2048);
    expect(live.size).toBe(0);
  });

  it('a missing value reads as empty and is not freed', () => {
    const { lib, live } = fakeHeap();
    const freeString = vi.fn();
    const meta = { ...lib, _openmpt_free_string: freeString, _openmpt_module_get_metadata: () => 0 } as unknown as LibOpenMPT;
    expect(readMetadataString(meta, 7, 'artist')).toBe('');
    expect(freeString).not.toHaveBeenCalled();
    expect(live.size).toBe(0);
  });
});
