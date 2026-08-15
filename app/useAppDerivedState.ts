import { useMemo, useEffect } from 'react';
import type { ModuleMetadata } from '../components/MetadataPanel';
import type { MediaItem, PatternMatrix } from '../types';
import type { ChannelShadowState } from '../types';
import { SchemaMismatchError } from '../utils/storageApi';
import { ALL_SHADER_IDS } from '../appConfig';
import {
  isLiteRecommendedShader,
  usesNightModeBezel,
} from '../utils/shaderVersion';
import { getLiteRecommendedShader } from '../utils/shaderRegistry';
import { generateInstrumentPalette, generateEmptyInstrumentPalette } from '../utils/instrumentPalette';
import { NIGHT_PRESETS, type NightPreset } from '../types/bloomPresets';
import { buildShareUrl } from '../utils/shareState';

export interface UseAppDerivedStateParams {
  channelStates: ChannelShadowState[];
  isModuleLoaded: boolean;
  sequencerMatrix: PatternMatrix | null;
  status: string;
  activeEngine: string;
  totalPatternRows: number;
  instrumentNames: string[];
  sampleNames: string[];
  moduleFormat: string;
  moduleComments: string;
  moduleDurationSeconds: number;
  moduleFileName: string;
  clearInstrumentSelection: () => void;
  shaderFile: string;
  shaderFavorites: string[];
  shaderRecents: string[];
  shaderThumbnails: Record<string, string>;
  setShaderThumbnails: (updater: (prev: Record<string, string>) => Record<string, string>) => void;
  songsQueryError: unknown;
  shadersQueryError: unknown;
  saveSongMutationError: unknown;
  syncLibraryMutationError: unknown;
  liteMode: boolean;
  isDarkMode: boolean;
  nightModeEnabled: boolean;
  nightModePreset: NightPreset;
  moduleSourceUrl: string | null;
  moduleInfoOrder: number;
  moduleInfoRow: number;
  paletteMode: number;
  colorPalette: number;
  mediaItem: MediaItem | null;
}

export function useAppDerivedState(params: UseAppDerivedStateParams) {
  const {
    channelStates,
    isModuleLoaded,
    sequencerMatrix,
    status,
    activeEngine,
    totalPatternRows,
    instrumentNames,
    sampleNames,
    moduleFormat,
    moduleComments,
    moduleDurationSeconds,
    moduleFileName,
    clearInstrumentSelection,
    shaderFile,
    shaderFavorites,
    shaderRecents,
    shaderThumbnails,
    setShaderThumbnails,
    songsQueryError,
    shadersQueryError,
    saveSongMutationError,
    syncLibraryMutationError,
    liteMode,
    isDarkMode,
    nightModeEnabled,
    nightModePreset,
    moduleSourceUrl,
    moduleInfoOrder,
    moduleInfoRow,
    paletteMode,
    colorPalette,
    mediaItem,
  } = params;

  const channelVU = useMemo(() => {
    if (!channelStates || channelStates.length === 0) return null;
    const vu = new Float32Array(channelStates.length);
    for (let i = 0; i < channelStates.length; i++) {
      vu[i] = channelStates[i]?.volume ?? 0;
    }
    return vu;
  }, [channelStates]);

  const moduleMetadata = useMemo((): ModuleMetadata | null => {
    if (!isModuleLoaded || !sequencerMatrix) return null;
    return {
      title: status.replace(/^Loaded "/, '').replace(/"$/, '') || 'Unknown',
      artist: '',
      tracker: activeEngine === 'native-worklet' ? 'Native C++/Wasm' : activeEngine === 'worklet' ? 'JS AudioWorklet' : 'ScriptProcessor',
      numChannels: sequencerMatrix?.numChannels ?? 0,
      numOrders: totalPatternRows > 0 ? Math.ceil(totalPatternRows / (sequencerMatrix?.numRows || 64)) : 0,
      numPatterns: 0,
      numInstruments: instrumentNames.length,
      instruments: instrumentNames,
      numSamples: sampleNames.length,
      samples: sampleNames,
      format: moduleFormat,
      durationSeconds: moduleDurationSeconds,
      currentBpm: 125,
      comments: moduleComments,
    };
  }, [
    isModuleLoaded,
    sequencerMatrix,
    status,
    activeEngine,
    totalPatternRows,
    instrumentNames,
    sampleNames,
    moduleFormat,
    moduleComments,
    moduleDurationSeconds,
  ]);

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

  const validShaderFavorites = useMemo(
    () => shaderFavorites.filter(shader => ALL_SHADER_IDS.has(shader)),
    [shaderFavorites],
  );
  const validShaderRecents = useMemo(
    () => shaderRecents.filter(shader => ALL_SHADER_IDS.has(shader)).slice(0, 5),
    [shaderRecents],
  );
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

  const moduleMediaHintText = useMemo(() => {
    const parts = [moduleComments, ...instrumentNames]
      .map(value => value.trim())
      .filter(Boolean);
    return parts.join('\n');
  }, [moduleComments, instrumentNames]);

  const isNightShader = usesNightModeBezel(shaderFile);
  const nightConfig = NIGHT_PRESETS[nightModePreset];
  const effectiveDimFactor = (isNightShader && nightModeEnabled)
    ? nightConfig.dimFactor
    : (isDarkMode ? 0.3 : 1.0);
  const dimFactor = effectiveDimFactor;

  const displayShaderFile = useMemo(() => {
    if (liteMode && !isLiteRecommendedShader(shaderFile)) {
      return getLiteRecommendedShader();
    }
    return shaderFile;
  }, [liteMode, shaderFile]);

  const instrumentPalette = useMemo(() => {
    if (!instrumentNames || instrumentNames.length === 0) return generateEmptyInstrumentPalette();
    return generateInstrumentPalette(instrumentNames.length, instrumentNames);
  }, [instrumentNames]);

  const sharePageUrl = useMemo(() => {
    if (!isModuleLoaded) return window.location.href;
    const shareState: Parameters<typeof buildShareUrl>[0] = {
      shader: shaderFile,
      order: moduleInfoOrder,
      row: moduleInfoRow,
      palette: paletteMode === 1 ? 'instrument' : 'pitch',
      lite: liteMode ? 1 : 0,
      colorPalette,
    };
    if (moduleSourceUrl) shareState.mod = moduleSourceUrl;
    if (mediaItem && !mediaItem.isObjectUrl) shareState.media = mediaItem.url;
    return buildShareUrl(shareState);
  }, [
    isModuleLoaded,
    moduleSourceUrl,
    shaderFile,
    moduleInfoOrder,
    moduleInfoRow,
    paletteMode,
    liteMode,
    colorPalette,
    mediaItem,
  ]);

  return {
    channelVU,
    moduleMetadata,
    validShaderFavorites,
    validShaderRecents,
    libraryErrorMessage,
    shaderCatalogErrorMessage,
    saveSongErrorMessage,
    syncLibraryErrorMessage,
    moduleMediaHintText,
    isNightShader,
    nightConfig,
    dimFactor,
    displayShaderFile,
    instrumentPalette,
    sharePageUrl,
  };
}
