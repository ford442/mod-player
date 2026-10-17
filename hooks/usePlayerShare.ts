import { useCallback, useEffect, useRef } from 'react';
import type { MediaItem } from '../types';
import { createRemoteMediaItem } from '../utils/remoteMedia';
import {
  buildShareUrl,
  createShareCode,
  fetchShareModule,
  paletteModeFromShare,
  parseShareParams,
  resolveShareCode,
  sharePaletteFromMode,
  type PlayerShareState,
} from '../utils/shareState';
import type { ToastKind } from './useToast';
import { usePlayerEngine, usePlayerEngineInstance } from './usePlayerEngine';
import { usePlayerUiStore } from '../store/playerUiStore';
import { useShaderPrefsStore } from '../store/shaderPrefsStore';

export interface UsePlayerShareOptions {
  moduleSourceUrl: string | null;
  mediaItem: MediaItem | null;
  setModuleSourceUrl: (url: string | null) => void;
  loadFileWithHash: (data: Uint8Array, fileName: string) => void;
  setMediaItem: (item: MediaItem | null) => void;
  setMediaVisible: (visible: boolean) => void;
  showToast: (text: string, kind?: ToastKind) => void;
}

export function usePlayerShare({
  moduleSourceUrl,
  mediaItem,
  setModuleSourceUrl,
  loadFileWithHash,
  setMediaItem,
  setMediaVisible,
  showToast,
}: UsePlayerShareOptions) {
  const engine = usePlayerEngineInstance();
  const isReady = usePlayerEngine((s) => s.isReady);
  const isModuleLoaded = usePlayerEngine((s) => s.isModuleLoaded);
  const sequencerMatrix = usePlayerEngine((s) => s.sequencerMatrix);
  const setShaderFile = useShaderPrefsStore((s) => s.selectShader);
  const setPaletteMode = useShaderPrefsStore((s) => s.setPaletteMode);
  const setColorPalette = useShaderPrefsStore((s) => s.setColorPalette);
  /** Skip per-module shader restore on the next load (share URL / deep link). */
  const onShareShaderApplied = useShaderPrefsStore((s) => s.markSkipModuleShaderRestore);
  const setLiteMode = usePlayerUiStore((s) => s.setLiteMode);
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
      onShareShaderApplied();
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
    onShareShaderApplied,
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
            onShareShaderApplied();
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
    onShareShaderApplied,
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
    // Global step from the real pattern lengths (orders need not all have the same row count).
    engine.seekToStep(Math.max(0, engine.stepOfOrder(order) + row));
  }, [isModuleLoaded, sequencerMatrix, engine]);

  // Read at click time: the position changes every row, and nothing else needs to re-render for it.
  const copyShareLink = useCallback(async () => {
    const prefs = useShaderPrefsStore.getState();
    const { moduleInfo } = engine.getSnapshot();
    const state: PlayerShareState = {
      shader: prefs.storedShader,
      palette: sharePaletteFromMode(prefs.paletteMode),
      lite: usePlayerUiStore.getState().liteMode ? 1 : 0,
      colorPalette: prefs.colorPalette,
      order: moduleInfo.order,
      row: moduleInfo.row,
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
  }, [engine, moduleSourceUrl, mediaItem, showToast]);

  return { copyShareLink };
}
