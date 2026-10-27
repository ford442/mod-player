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
import { getLegacyModuleKey, getSongFingerprint, subscribeSongFingerprint } from '../utils/songIdentity';
import { readSongSession, updateSongSession, type SongSession } from '../utils/songSession';

const LEGACY_MODULE_SHADER_PREFIX = 'xasm1_module_shader_';

/**
 * One-time migration (#511) of the pre-fingerprint per-module shader memory,
 * `localStorage['xasm1_module_shader_' + first16BytesHex]`, into the song's
 * SongSession record. Copied only when the record has no shader yet, and the
 * record is marked migrated either way, so a later load never clobbers a
 * shader picked under the fingerprint. The legacy entry is left in place:
 * other songs with the same prefix may still need to migrate from it.
 *
 * What this cannot recover: every XM starts with "Extended Module: ", and
 * many MODs/S3Ms share their first 16 bytes too, so all of those shared one
 * legacy entry. Each such song inherits whatever shader was picked last for
 * any of them, until the user picks a new one for it. Those historical
 * collisions cannot be unpicked.
 */
async function migrateLegacyShader(fingerprint: string, legacyKey: string | null, session: SongSession | null) {
  if (session?.legacyShaderMigrated) return session;
  let legacy: string | null = null;
  if (legacyKey) {
    try {
      legacy = window.localStorage.getItem(LEGACY_MODULE_SHADER_PREFIX + legacyKey);
    } catch {
      /* storage unavailable */
    }
  }
  const copy = session?.shader == null && legacy !== null && ALL_SHADER_IDS.has(legacy);
  return updateSongSession(fingerprint, copy ? { shader: legacy, legacyShaderMigrated: true } : { legacyShaderMigrated: true });
}

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
  /** Fingerprint of the loaded song (utils/songIdentity.ts); null while hashing / unloaded. */
  songFingerprint: string | null;
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
  /** Fed by subscribeSongFingerprint; restores the song's shader from its SongSession. */
  setSongFingerprint: (fingerprint: string | null) => Promise<void>;
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

/** Bumped by every pick and song change: a restore that finishes late must not undo either. */
let shaderEpoch = 0;
/** A shader picked while the new song was still hashing; saved to it once the fingerprint lands. */
let pickedWhileHashing: string | null = null;

export const useShaderPrefsStore = create<ShaderPrefsState>((set, get) => ({
  storedShader: initialStoredShader(),
  shaderFavorites: readLocalStorage<string[]>('xasm1-shader-favorites', []),
  shaderRecents: readLocalStorage<string[]>('xasm1-shader-recents', []),
  shaderThumbnails: readLocalStorage<Record<string, string>>('xasm1-shader-thumbnails', {}),
  songFingerprint: getSongFingerprint(),
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
  setSongFingerprint: async (songFingerprint) => {
    if (songFingerprint === get().songFingerprint) return;
    const epoch = ++shaderEpoch;
    set({ songFingerprint });
    if (songFingerprint === null) {
      pickedWhileHashing = null;
      return;
    }
    const picked = pickedWhileHashing;
    pickedWhileHashing = null;
    const skip = get().skipNextModuleShaderRestore || (IS_PUBLIC_MODE && !IS_SHADER_DEBUG);
    if (skip) set({ skipNextModuleShaderRestore: false });
    const legacyKey = getLegacyModuleKey();
    try {
      const session = await migrateLegacyShader(songFingerprint, legacyKey, await readSongSession(songFingerprint));
      if (picked !== null) {
        await updateSongSession(songFingerprint, { shader: picked });
        return;
      }
      if (skip || epoch !== shaderEpoch) return;
      const saved = session.shader;
      if (saved !== null && ALL_SHADER_IDS.has(saved) && saved !== get().storedShader) {
        writeLocalStorage('xasm1_last_shader', saved);
        set({ storedShader: saved });
      }
    } catch (e) {
      console.warn('[xasm1] Failed to read the song session', e);
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
      shaderEpoch++;
      const { songFingerprint } = state;
      if (songFingerprint) {
        updateSongSession(songFingerprint, { shader: validated }).catch((e: unknown) => {
          console.warn('[xasm1] Failed to save the song shader', e);
        });
      } else {
        pickedWhileHashing = validated;
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

subscribeSongFingerprint((fingerprint) => {
  void useShaderPrefsStore.getState().setSongFingerprint(fingerprint);
});
