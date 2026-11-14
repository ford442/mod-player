/**
 * Shader thumbnails no longer live in localStorage (full-size PNG data URLs filled the quota and
 * then every other preference write failed silently): ≤160 px captures, blobs in IndexedDB,
 * object URLs in the store, and the old localStorage key is cleared.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LEGACY_THUMBNAIL_STORAGE_KEY,
  THUMBNAIL_MAX_EDGE,
  clearLegacyThumbnailStorage,
  thumbnailSize,
} from '../../utils/shaderThumbnails';
import { useShaderPrefsStore } from '../../store/shaderPrefsStore';

// shaderPrefsStore reads matchMedia / localStorage when it is created.
vi.hoisted(() => {
  const w = globalThis.window as unknown as Record<string, unknown>;
  Object.defineProperty(w, 'matchMedia', { value: () => ({ matches: false }), configurable: true, writable: true });
  Object.defineProperty(w, 'localStorage', {
    value: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('thumbnailSize', () => {
  it('caps the longest edge and keeps the aspect ratio', () => {
    expect(thumbnailSize(2048, 2048)).toEqual({ width: THUMBNAIL_MAX_EDGE, height: THUMBNAIL_MAX_EDGE });
    expect(thumbnailSize(1920, 1080)).toEqual({ width: 160, height: 90 });
    expect(thumbnailSize(1080, 1920)).toEqual({ width: 90, height: 160 });
  });

  it('never upscales and handles empty canvases', () => {
    expect(thumbnailSize(100, 50)).toEqual({ width: 100, height: 50 });
    expect(thumbnailSize(0, 0)).toEqual({ width: 0, height: 0 });
  });
});

describe('shader thumbnail store', () => {
  it('keeps an object URL in the store and writes nothing to localStorage', () => {
    const setItem = vi.spyOn(window.localStorage, 'setItem');
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' });
    useShaderPrefsStore.getState().addShaderThumbnail('patternv0.57.wgsl', blob);
    const url = useShaderPrefsStore.getState().shaderThumbnails['patternv0.57.wgsl'];
    expect(url?.startsWith('blob:')).toBe(true);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('revokes the previous object URL when a shader is captured again', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const store = useShaderPrefsStore.getState();
    store.addShaderThumbnail('a.wgsl', new Blob([new Uint8Array([1])]));
    const first = useShaderPrefsStore.getState().shaderThumbnails['a.wgsl'];
    store.addShaderThumbnail('a.wgsl', new Blob([new Uint8Array([2])]));
    expect(revoke).toHaveBeenCalledWith(first);
    revoke.mockRestore();
  });

  it('clears the legacy localStorage map', () => {
    const removeItem = vi.spyOn(window.localStorage, 'removeItem');
    clearLegacyThumbnailStorage();
    expect(removeItem).toHaveBeenCalledWith(LEGACY_THUMBNAIL_STORAGE_KEY);
  });
});
