import { useMemo, useEffect } from 'react';
import type { MediaItem } from '../types';
import { SchemaMismatchError } from '../utils/storageApi';
import { buildShareUrl } from '../utils/shareState';
import { usePlayerEngine } from '../hooks/usePlayerEngine';
import { usePlayerUiStore } from '../store/playerUiStore';
import { useShaderPrefsStore } from '../store/shaderPrefsStore';

export interface UseAppDerivedStateParams {
  songsQueryError: unknown;
  shadersQueryError: unknown;
  saveSongMutationError: unknown;
  syncLibraryMutationError: unknown;
  moduleSourceUrl: string | null;
  mediaItem: MediaItem | null;
}

/**
 * App-level derived values and effects. Player-derived values (module metadata, channel VU, palette,
 * display shader…) live in hooks/usePlayerView.ts, selected by the components that show them (#492).
 */
export function useAppDerivedState(params: UseAppDerivedStateParams) {
  const {
    songsQueryError,
    shadersQueryError,
    saveSongMutationError,
    syncLibraryMutationError,
    moduleSourceUrl,
    mediaItem,
  } = params;

  const shaderFile = useShaderPrefsStore((s) => s.storedShader);
  const shaderThumbnails = useShaderPrefsStore((s) => s.shaderThumbnails);
  const setShaderThumbnails = useShaderPrefsStore((s) => s.setShaderThumbnails);
  const paletteMode = useShaderPrefsStore((s) => s.paletteMode);
  const colorPalette = useShaderPrefsStore((s) => s.colorPalette);
  const liteMode = usePlayerUiStore((s) => s.liteMode);
  const clearInstrumentSelection = usePlayerUiStore((s) => s.clearInstrumentSelection);
  const isModuleLoaded = usePlayerEngine((s) => s.isModuleLoaded);
  const moduleFileName = usePlayerEngine((s) => s.moduleFileName);
  // Order, not row: the share page URL (og:url) needs no per-row update. copyShareLink reads the exact
  // row when the link is copied.
  const moduleOrder = usePlayerEngine((s) => s.moduleInfo.order);

  // Clear instrument/sample selection when a new module is loaded.
  useEffect(() => {
    clearInstrumentSelection();
  }, [moduleFileName, clearInstrumentSelection]);

  useEffect(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-shader-preview-source="true"]');
    if (!canvas) return;
    if (shaderThumbnails[shaderFile]) return;
    const timer = window.setTimeout(() => {
      try {
        const dataUrl = canvas.toDataURL('image/png');
        if (dataUrl.startsWith('data:image/png')) {
          setShaderThumbnails(previous => ({ ...previous, [shaderFile]: dataUrl }));
        }
      } catch {
        // Ignore capture/security errors
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [setShaderThumbnails, shaderFile, shaderThumbnails]);

  const libraryErrorMessage = useMemo(() => {
    const error = songsQueryError;
    if (!error) return null;
    if (error instanceof SchemaMismatchError) {
      return error.message;
    }
    return 'Cloud library unavailable. Check storage_manager connectivity.';
  }, [songsQueryError]);
  const shaderCatalogErrorMessage = useMemo(() => {
    const error = shadersQueryError;
    if (!error) return null;
    if (error instanceof SchemaMismatchError) {
      return error.message;
    }
    return 'Shader catalog unavailable. Ratings are temporarily offline.';
  }, [shadersQueryError]);
  const saveSongErrorMessage = useMemo(() => {
    const error = saveSongMutationError;
    if (!error) return null;
    return error instanceof Error ? error.message : 'Failed to save module to library.';
  }, [saveSongMutationError]);
  const syncLibraryErrorMessage = useMemo(() => {
    const error = syncLibraryMutationError;
    if (!error) return null;
    return error instanceof Error ? error.message : 'Library sync failed.';
  }, [syncLibraryMutationError]);

  const sharePageUrl = useMemo(() => {
    if (!isModuleLoaded) return window.location.href;
    const shareState: Parameters<typeof buildShareUrl>[0] = {
      shader: shaderFile,
      order: moduleOrder,
      palette: paletteMode === 1 ? 'instrument' : 'pitch',
      lite: liteMode ? 1 : 0,
      colorPalette,
    };
    if (moduleSourceUrl) shareState.mod = moduleSourceUrl;
    if (mediaItem && !mediaItem.isObjectUrl) shareState.media = mediaItem.url;
    return buildShareUrl(shareState);
  }, [isModuleLoaded, moduleSourceUrl, shaderFile, moduleOrder, paletteMode, liteMode, colorPalette, mediaItem]);

  return {
    libraryErrorMessage,
    shaderCatalogErrorMessage,
    saveSongErrorMessage,
    syncLibraryErrorMessage,
    sharePageUrl,
  };
}
