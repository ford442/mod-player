/**
 * Derived player state for components (#492). Each hook selects only what it needs from the engine
 * snapshot or the UI stores, so a component re-renders when *its* inputs change — instead of every
 * consumer re-rendering on every row through one big context value built in App.
 */
import { useMemo } from 'react';
import type { ModuleMetadata } from '../components/MetadataPanel';
import { ALL_SHADER_IDS, LIGHT_THEMES } from '../appConfig';
import { NIGHT_PRESETS } from '../types/bloomPresets';
import { getLiteRecommendedShader } from '../utils/shaderRegistry';
import { isLiteRecommendedShader, supportsStepsLength, usesNightModeBezel } from '../utils/shaderVersion';
import { generateEmptyInstrumentPalette, generateInstrumentPalette } from '../utils/instrumentPalette';
import { preserveWindowScroll } from '../utils/scrollContainer';
import { usePlayerUiStore } from '../store/playerUiStore';
import { useShaderPrefsStore } from '../store/shaderPrefsStore';
import { shallowEqual, usePlayerEngine, usePlayerEngineInstance } from './usePlayerEngine';

/** Which channels are muted. Changes only when a mute does, not on every channel-state publish. */
export function useChannelMuteMask(): boolean[] {
  return usePlayerEngine((s) => s.channelStates.map((ch) => (ch?.isMuted ?? 0) > 0), shallowEqual);
}

export function useInstrumentPalette(): Uint8Array {
  const instrumentNames = usePlayerEngine((s) => s.instrumentNames);
  return useMemo(
    () => (instrumentNames.length === 0
      ? generateEmptyInstrumentPalette()
      : generateInstrumentPalette(instrumentNames.length, instrumentNames)),
    [instrumentNames],
  );
}

/** Comments + instrument names: the text the media matcher searches for a module's artwork. */
export function useModuleMediaHintText(): string {
  const { moduleComments, instrumentNames } = usePlayerEngine(
    (s) => ({ moduleComments: s.moduleComments, instrumentNames: s.instrumentNames }),
    shallowEqual,
  );
  return useMemo(
    () => [moduleComments, ...instrumentNames].map((value) => value.trim()).filter(Boolean).join('\n'),
    [moduleComments, instrumentNames],
  );
}

const TRACKER_LABEL = 'JS AudioWorklet';

export function useModuleMetadata(): ModuleMetadata | null {
  const m = usePlayerEngine(
    (s) => ({
      isModuleLoaded: s.isModuleLoaded,
      title: s.moduleInfo.title,
      hasMatrix: s.sequencerMatrix !== null,
      numChannels: s.sequencerMatrix?.numChannels ?? 0,
      rowsPerPattern: s.sequencerMatrix?.numRows || 64,
      totalPatternRows: s.totalPatternRows,
      instrumentNames: s.instrumentNames,
      sampleNames: s.sampleNames,
      moduleFormat: s.moduleFormat,
      moduleComments: s.moduleComments,
      moduleDurationSeconds: s.moduleDurationSeconds,
    }),
    shallowEqual,
  );
  return useMemo((): ModuleMetadata | null => {
    if (!m.isModuleLoaded || !m.hasMatrix) return null;
    return {
      // The module's own title (or file name) — it used to be parsed out of the status line, which
      // read "Playing..." as the title as soon as playback started.
      title: m.title || 'Unknown',
      artist: '',
      tracker: TRACKER_LABEL,
      numChannels: m.numChannels,
      numOrders: m.totalPatternRows > 0 ? Math.ceil(m.totalPatternRows / m.rowsPerPattern) : 0,
      numPatterns: 0,
      numInstruments: m.instrumentNames.length,
      instruments: m.instrumentNames,
      numSamples: m.sampleNames.length,
      samples: m.sampleNames,
      format: m.moduleFormat,
      durationSeconds: m.moduleDurationSeconds,
      currentBpm: 125,
      comments: m.moduleComments,
    };
  }, [m]);
}

/** Shader / theme presentation state the stage, the transport bar and the 3D shell share. */
export function useDisplayShader() {
  const theme = usePlayerUiStore((s) => s.theme);
  const liteMode = usePlayerUiStore((s) => s.liteMode);
  const shaderFile = useShaderPrefsStore((s) => s.storedShader);
  const nightModeEnabled = useShaderPrefsStore((s) => s.nightModeEnabled);
  const nightModePreset = useShaderPrefsStore((s) => s.nightModePreset);

  return useMemo(() => {
    const isDarkMode = !LIGHT_THEMES.has(theme);
    const isNightShader = usesNightModeBezel(shaderFile);
    const nightConfig = NIGHT_PRESETS[nightModePreset];
    return {
      isDarkMode,
      shaderFile,
      displayShaderFile:
        liteMode && !isLiteRecommendedShader(shaderFile) ? getLiteRecommendedShader() : shaderFile,
      isNightShader,
      isStepsShader: supportsStepsLength(shaderFile),
      nightConfig,
      dimFactor: isNightShader && nightModeEnabled ? nightConfig.dimFactor : isDarkMode ? 0.3 : 1.0,
    };
  }, [theme, liteMode, shaderFile, nightModeEnabled, nightModePreset]);
}

/** Favourite / recent shaders that still exist in this build (stored ids can outlive a shader). */
export function useValidShaderLists(): { favorites: string[]; recents: string[] } {
  const shaderFavorites = useShaderPrefsStore((s) => s.shaderFavorites);
  const shaderRecents = useShaderPrefsStore((s) => s.shaderRecents);
  return useMemo(() => ({
    favorites: shaderFavorites.filter((shader) => ALL_SHADER_IDS.has(shader)),
    recents: shaderRecents.filter((shader) => ALL_SHADER_IDS.has(shader)).slice(0, 5),
  }), [shaderFavorites, shaderRecents]);
}

export interface PlayerActions {
  /** Start from the beginning when stopped; resume when paused. Guards the window scroll. */
  play: () => void;
  /** Pause in place (keeps the position); a no-op unless playing. */
  pause: () => void;
  stopMusic: (destroy?: boolean) => void;
  seekToStep: (step: number) => void;
  setIsLooping: (v: boolean | ((prev: boolean) => boolean)) => void;
  setVolume: (v: number | ((prev: number) => number)) => void;
  setPan: (v: number) => void;
  toggleChannelMute: (channel: number) => void;
  /** Route playback to an output device ('' = system default) on the same AudioContext. */
  setOutputDevice: (deviceId: string, label?: string) => Promise<boolean>;
}

/** Stable engine actions for buttons, sliders and the canvas hit-test. */
export function usePlayerActions(): PlayerActions {
  const engine = usePlayerEngineInstance();
  return useMemo(() => ({
    play: () => preserveWindowScroll(() => { void engine.play(); }),
    pause: () => engine.pause(),
    stopMusic: (destroy?: boolean) => engine.stop(destroy),
    seekToStep: (step: number) => engine.seekToStep(step),
    setIsLooping: (v: boolean | ((prev: boolean) => boolean)) => engine.setLooping(v),
    setVolume: (v: number | ((prev: number) => number)) => engine.setMasterVolume(v),
    setPan: (v: number) => engine.setMasterPan(v),
    toggleChannelMute: (channel: number) => engine.toggleChannelMute(channel),
    setOutputDevice: (deviceId: string, label?: string) => engine.setOutputDevice(deviceId, label),
  }), [engine]);
}
