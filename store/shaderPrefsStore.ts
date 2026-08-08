import { create } from 'zustand';
import {
  ALL_SHADER_IDS,
  AVAILABLE_SHADERS,
  DEFAULT_SHADER,
  IS_PUBLIC_MODE,
  IS_SHADER_DEBUG,
  PICKER_SHADER_IDS,
  PUBLIC_DEFAULT_SHADER,
} from '../appConfig';
import { usesInstrumentPalette } from '../utils/shaderVersion';
import {
  DEFAULT_BLOOM_PRESET,
  DEFAULT_COLOR_SCHEME,
  DEFAULT_NIGHT_PRESET,
  type BloomPreset,
  type ColorScheme,
  type NightPreset,
} from '../types/bloomPresets';
import { readLocalStorage, writeLocalStorage } from '../utils/localStorageIO';

function validateShader(shader: string): string {
  if (IS_PUBLIC_MODE && !IS_SHADER_DEBUG) {
    return PUBLIC_DEFAULT_SHADER;
  }
  if (PICKER_SHADER_IDS.has(shader)) {
    return shader;
  }
  return ALL_SHADER_IDS.has(shader) ? shader : DEFAULT_SHADER;
}

function initialStoredShader(): string {
  if (IS_PUBLIC_MODE && !IS_SHADER_DEBUG) {
    return PUBLIC_DEFAULT_SHADER;
  }
  return validateShader(readLocalStorage<string>('xasm1_last_shader', DEFAULT_SHADER));
}

export interface ShaderPrefsState {
  storedShader: string;
  shaderFavorites: string[];
  shaderRecents: string[];
  shaderThumbnails: Record<string, string>;
  moduleHash: string | null;
  skipNextModuleShaderRestore: boolean;
  bloomPreset: BloomPreset;
  colorScheme: ColorScheme;
  colorPalette: number;
  paletteMode: number;
  stepsLength: 32 | 64;
  nightModeEnabled: boolean;
  nightModePreset: NightPreset;
  crtEnabled: boolean;
  /** Honour prefers-reduced-motion: damps bloom pulse / playhead animation. */
  reducedMotion: boolean;
  /** Raise LED on/off contrast: brighter cores, darker chassis floor. */
  highContrast: boolean;
  /** CVD-safe palette id (0=default, 1=deutan/protan, 2=tritan, 3=mono). */
  cvdPalette: number;
  setModuleHash: (hash: string | null, options?: { skipShaderRestore?: boolean }) => void;
  restoreModuleShader: () => void;
  selectShader: (shader: string) => void;
  toggleShaderFavorite: (shader: string) => void;
  randomizeShader: () => void;
  setShaderThumbnails: (updater: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => void;
  setBloomPreset: (preset: BloomPreset) => void;
  setColorScheme: (scheme: ColorScheme) => void;
  setColorPalette: (palette: number) => void;
  setPaletteMode: (mode: number) => void;
  setStepsLength: (length: 32 | 64) => void;
  setNightModeEnabled: (enabled: boolean) => void;
  setNightModePreset: (preset: NightPreset) => void;
  setCrtEnabled: (enabled: boolean) => void;
  setReducedMotion: (enabled: boolean) => void;
  setHighContrast: (enabled: boolean) => void;
  setCvdPalette: (id: number) => void;
  markSkipModuleShaderRestore: () => void;
}

export const useShaderPrefsStore = create<ShaderPrefsState>((set, get) => ({
  storedShader: initialStoredShader(),
  shaderFavorites: readLocalStorage<string[]>('xasm1-shader-favorites', []),
  shaderRecents: readLocalStorage<string[]>('xasm1-shader-recents', []),
  shaderThumbnails: readLocalStorage<Record<string, string>>('xasm1-shader-thumbnails', {}),
  moduleHash: null,
  skipNextModuleShaderRestore: false,
  bloomPreset: DEFAULT_BLOOM_PRESET,
  colorScheme: DEFAULT_COLOR_SCHEME,
  colorPalette: readLocalStorage<number>('xasm1_colorPalette', 0),
  paletteMode: readLocalStorage<number>('xasm1_paletteMode', 0),
  stepsLength: readLocalStorage<32 | 64>('xasm1_stepsLength', 32),
  nightModeEnabled: readLocalStorage<boolean>('xasm1_nightMode_enabled', false),
  nightModePreset: readLocalStorage<NightPreset>('xasm1_nightMode_preset', DEFAULT_NIGHT_PRESET),
  crtEnabled: readLocalStorage<boolean>('xasm1-crt-enabled', false),
  reducedMotion: readLocalStorage<boolean>('xasm1-reduced-motion',
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  ),
  highContrast: readLocalStorage<boolean>('xasm1-high-contrast', false),
  cvdPalette: readLocalStorage<number>('xasm1-cvd-palette', 0),
  setModuleHash: (moduleHash, options) => {
    set({
      moduleHash,
      skipNextModuleShaderRestore: options?.skipShaderRestore === true,
    });
    if (!options?.skipShaderRestore) {
      get().restoreModuleShader();
    } else {
      set({ skipNextModuleShaderRestore: false });
    }
  },
  restoreModuleShader: () => {
    if (IS_PUBLIC_MODE && !IS_SHADER_DEBUG) {
      set({ storedShader: PUBLIC_DEFAULT_SHADER });
      return;
    }
    const { moduleHash, skipNextModuleShaderRestore } = get();
    if (!moduleHash || skipNextModuleShaderRestore) {
      set({ skipNextModuleShaderRestore: false });
      return;
    }
    try {
      const saved = window.localStorage.getItem(`xasm1_module_shader_${moduleHash}`);
      if (saved !== null && ALL_SHADER_IDS.has(saved)) {
        writeLocalStorage('xasm1_last_shader', saved);
        set({ storedShader: saved });
      }
    } catch (e) {
      console.warn('[xasm1] Failed to read per-module shader from localStorage', e);
    }
  },
  selectShader: (shader) => {
    const validated = validateShader(shader);
    writeLocalStorage('xasm1_last_shader', validated);
    set((state) => {
      const shaderRecents = [validated, ...state.shaderRecents.filter((s) => s !== validated)].slice(0, 5);
      writeLocalStorage('xasm1-shader-recents', shaderRecents);
      const paletteMode = usesInstrumentPalette(validated) ? state.paletteMode : 0;
      if (paletteMode !== state.paletteMode) {
        writeLocalStorage('xasm1_paletteMode', paletteMode);
      }
      const { moduleHash } = state;
      if (moduleHash) {
        try {
          window.localStorage.setItem(`xasm1_module_shader_${moduleHash}`, validated);
        } catch {
          // ignore quota
        }
      }
      return { storedShader: validated, shaderRecents, paletteMode };
    });
  },
  toggleShaderFavorite: (shader) => {
    set((state) => {
      const shaderFavorites = state.shaderFavorites.includes(shader)
        ? state.shaderFavorites.filter((s) => s !== shader)
        : [shader, ...state.shaderFavorites];
      writeLocalStorage('xasm1-shader-favorites', shaderFavorites);
      return { shaderFavorites };
    });
  },
  randomizeShader: () => {
    const current = get().storedShader;
    const others = AVAILABLE_SHADERS.filter((shader) => shader.id !== current);
    const pool = others.length > 0 ? others : AVAILABLE_SHADERS;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick) get().selectShader(pick.id);
  },
  setShaderThumbnails: (updater) => {
    set((state) => {
      const shaderThumbnails = typeof updater === 'function' ? updater(state.shaderThumbnails) : updater;
      writeLocalStorage('xasm1-shader-thumbnails', shaderThumbnails);
      return { shaderThumbnails };
    });
  },
  setBloomPreset: (bloomPreset) => set({ bloomPreset }),
  setColorScheme: (colorScheme) => set({ colorScheme }),
  setColorPalette: (colorPalette) => {
    writeLocalStorage('xasm1_colorPalette', colorPalette);
    set({ colorPalette });
  },
  setPaletteMode: (paletteMode) => {
    writeLocalStorage('xasm1_paletteMode', paletteMode);
    set({ paletteMode });
  },
  setStepsLength: (stepsLength) => {
    writeLocalStorage('xasm1_stepsLength', stepsLength);
    set({ stepsLength });
  },
  setNightModeEnabled: (nightModeEnabled) => {
    writeLocalStorage('xasm1_nightMode_enabled', nightModeEnabled);
    set({ nightModeEnabled });
  },
  setNightModePreset: (nightModePreset) => {
    writeLocalStorage('xasm1_nightMode_preset', nightModePreset);
    set({ nightModePreset });
  },
  setCrtEnabled: (crtEnabled) => {
    writeLocalStorage('xasm1-crt-enabled', crtEnabled);
    set({ crtEnabled });
  },
  setReducedMotion: (reducedMotion) => {
    writeLocalStorage('xasm1-reduced-motion', reducedMotion);
    set({ reducedMotion });
  },
  setHighContrast: (highContrast) => {
    writeLocalStorage('xasm1-high-contrast', highContrast);
    set({ highContrast });
  },
  setCvdPalette: (cvdPalette) => {
    writeLocalStorage('xasm1-cvd-palette', cvdPalette);
    set({ cvdPalette });
  },
  markSkipModuleShaderRestore: () => set({ skipNextModuleShaderRestore: true }),
}));
