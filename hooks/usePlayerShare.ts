import { useCallback, useEffect, useRef } from 'react';
import type { PatternMatrix } from '../types';
import type { MediaItem } from '../types';
import { createRemoteMediaItem } from '../utils/remoteMedia';
import {
  buildShareUrl,
  computeSeekStep,
  createShareCode,
  fetchShareModule,
  paletteModeFromShare,
  parseShareParams,
  resolveShareCode,
  sharePaletteFromMode,
  type PlayerShareState,
} from '../utils/shareState';
import type { ToastKind } from './useToast';

export interface UsePlayerShareOptions {
  isReady: boolean;
  isModuleLoaded: boolean;
  sequencerMatrix: PatternMatrix | null;
  shaderFile: string;
  paletteMode: number;
  liteMode: boolean;
  colorPalette: number;
  moduleSourceUrl: string | null;
  moduleOrder: number;
  moduleRow: number;
  mediaItem: MediaItem | null;
  setShaderFile: (shader: string) => void;
  setPaletteMode: (mode: number) => void;
  setColorPalette: (palette: number) => void;
  setLiteMode: (lite: boolean) => void;
  setModuleSourceUrl: (url: string | null) => void;
  loadFileWithHash: (data: Uint8Array, fileName: string) => void;
  seekToStep: (step: number) => void;
  setMediaItem: (item: MediaItem | null) => void;
  setMediaVisible: (visible: boolean) => void;
  showToast: (text: string, kind?: ToastKind) => void;
  skipModuleShaderRestoreRef: React.MutableRefObject<boolean>;
}

export function usePlayerShare({
  isReady,
  isModuleLoaded,
  sequencerMatrix,
  shaderFile,
  paletteMode,
  liteMode,
  colorPalette,
  moduleSourceUrl,
  moduleOrder,
  moduleRow,
  mediaItem,
  setShaderFile,
  setPaletteMode,
  setColorPalette,
  setLiteMode,
  setModuleSourceUrl,
  loadFileWithHash,
  seekToStep,
  setMediaItem,
  setMediaVisible,
  showToast,
  skipModuleShaderRestoreRef,
}: UsePlayerShareOptions) {
  const hydratedRef = useRef(false);
  const pendingSeekRef = useRef<{ order: number; row: number } | null>(null);
  const shareWarningsShownRef = useRef(false);
  const shareLoadAttemptedRef = useRef(false);

  // Apply static URL params once on mount (shader, palette, lite)
  useEffect(() => {
    if (hydratedRef.current) return;
    const { state, warnings } = parseShareParams();
    if (warnings.length > 0 && !shareWarningsShownRef.current) {
      shareWarningsShownRef.current = true;
      for (const warning of warnings) {
        showToast(warning, 'warning');
      }
    }
    if (state.shader) {
      skipModuleShaderRestoreRef.current = true;
      setShaderFile(state.shader);
    }
    const paletteModeValue = paletteModeFromShare(state.palette);
    if (paletteModeValue !== undefined) setPaletteMode(paletteModeValue);
    if (state.colorPalette !== undefined) setColorPalette(state.colorPalette);
    if (state.lite !== undefined) setLiteMode(state.lite === 1);
    if (state.order !== undefined || state.row !== undefined) {
      pendingSeekRef.current = {
        order: state.order ?? 0,
        row: state.row ?? 0,
      };
    }
    hydratedRef.current = true;
  }, [
    setShaderFile,
    setPaletteMode,
    setColorPalette,
    setLiteMode,
    showToast,
    skipModuleShaderRestoreRef,
  ]);

  // Load remote module from share URL when audio engine is ready
  useEffect(() => {
    if (!isReady || shareLoadAttemptedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code')?.trim();
    const modParam = params.get('mod')?.trim();
    if (!code && !modParam) return;
    shareLoadAttemptedRef.current = true;

    let cancelled = false;

    const loadFromShare = async () => {
      try {
        let state: PlayerShareState | null = null;
        if (code) {
          state = await resolveShareCode(code);
          if (!state) {
            showToast('Share link code not found or expired', 'warning');
            return;
          }
          if (state.shader) {
            skipModuleShaderRestoreRef.current = true;
            setShaderFile(state.shader);
          }
          const paletteModeValue = paletteModeFromShare(state.palette);
          if (paletteModeValue !== undefined) setPaletteMode(paletteModeValue);
          if (state.colorPalette !== undefined) setColorPalette(state.colorPalette);
          if (state.lite !== undefined) setLiteMode(state.lite === 1);
          if (state.order !== undefined || state.row !== undefined) {
            pendingSeekRef.current = {
              order: state.order ?? 0,
              row: state.row ?? 0,
            };
          }
          if (state.media) {
            setMediaItem(createRemoteMediaItem(state.media));
            setMediaVisible(true);
          }
        }

        const modUrl = state?.mod ?? modParam;
        if (!modUrl) return;

        const fileData = await fetchShareModule(modUrl);
        if (cancelled) return;
        const fileName = decodeURIComponent(new URL(modUrl).pathname.split('/').pop() || 'remote.mod');
        setModuleSourceUrl(modUrl);
        loadFileWithHash(fileData, fileName);

        if (state?.media && !code) {
          setMediaItem(createRemoteMediaItem(state.media));
          setMediaVisible(true);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load shared module';
        showToast(message, 'warning');
      }
    };

    void loadFromShare();
    return () => { cancelled = true; };
  }, [
    isReady,
    loadFileWithHash,
    setShaderFile,
    setPaletteMode,
    setColorPalette,
    setLiteMode,
    setMediaItem,
    setMediaVisible,
    setModuleSourceUrl,
    showToast,
    skipModuleShaderRestoreRef,
  ]);

  // Hydrate media overlay from ?media= without a mod param
  useEffect(() => {
    const mediaParam = new URLSearchParams(window.location.search).get('media')?.trim();
    if (!mediaParam || mediaItem) return;
    const { state } = parseShareParams();
    if (!state.media) return;
    setMediaItem(createRemoteMediaItem(state.media));
    setMediaVisible(true);
  }, [mediaItem, setMediaItem, setMediaVisible]);

  // Seek once module matrices are available
  useEffect(() => {
    if (!isModuleLoaded || !sequencerMatrix || !pendingSeekRef.current) return;
    const { order, row } = pendingSeekRef.current;
    pendingSeekRef.current = null;
    const rowsPerPattern = sequencerMatrix.numRows || 64;
    const step = computeSeekStep(order, row, rowsPerPattern);
    seekToStep(step);
  }, [isModuleLoaded, sequencerMatrix, seekToStep]);

  const copyShareLink = useCallback(async () => {
    const state: PlayerShareState = {
      shader: shaderFile,
      palette: sharePaletteFromMode(paletteMode),
      lite: liteMode ? 1 : 0,
      colorPalette,
      order: moduleOrder,
      row: moduleRow,
    };
    if (moduleSourceUrl) {
      state.mod = moduleSourceUrl;
    } else if (mediaItem && !mediaItem.isObjectUrl) {
      state.media = mediaItem.url;
    }
    if (mediaItem && !mediaItem.isObjectUrl && moduleSourceUrl) {
      state.media = mediaItem.url;
    }

    let url = buildShareUrl(state);
    if (!state.mod) {
      const code = await createShareCode(state);
      if (code) {
        url = buildShareUrl({ code });
      } else if (!moduleSourceUrl) {
        showToast('Load a module from an allowed URL to include it in the share link', 'info');
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      showToast('Share link copied to clipboard', 'success');
    } catch {
      showToast('Could not copy link — copy from the address bar', 'warning');
    }
  }, [
    shaderFile,
    paletteMode,
    liteMode,
    colorPalette,
    moduleOrder,
    moduleRow,
    moduleSourceUrl,
    mediaItem,
    showToast,
  ]);

  return { copyShareLink };
}
