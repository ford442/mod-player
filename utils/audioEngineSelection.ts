/**
 * Audio engine selection — URL / localStorage / auto-probe precedence.
 *
 * Precedence (high → low):
 * 1. `?engine=js|native|auto` (session; does not auto-persist)
 * 2. Public builds (`VITE_PUBLIC_MODE=1`): always **JS** unless URL asks for native
 *    (ignores sticky localStorage so demos never land on native by accident)
 * 3. `localStorage.xasm1_audio_engine` = `js` | `native` | `auto` (dev / non-public)
 * 4. Default: **JS worklet** (`force-js` or `auto` without parity gate)
 * 5. Promote native when override is `native` / `?engine=native` and probe OK
 * 6. `auto` + parity gate open + glue → prefer-native (see `shouldAutoPreferNative`)
 *
 * Production default: **JS worklet**. Native auto-prefer requires parity gate
 * (`VITE_NATIVE_PARITY_GATE=1` or local smoke marker). Explicit `?engine=native`
 * always works when artifacts are present.
 */

import { shouldAutoPreferNative } from './nativeParityGate';

export const AUDIO_ENGINE_STORAGE_KEY = 'xasm1_audio_engine';

export type AudioEngineOverride = 'js' | 'native' | 'auto';

export type ResolvedAudioEnginePreference =
  | { mode: 'force-js' }
  | { mode: 'prefer-native' }
  | { mode: 'auto' };

/** True when built with `VITE_PUBLIC_MODE=1` (xm-player production profile). */
export function isPublicModeAudioBuild(): boolean {
  try {
    return (
      typeof import.meta !== 'undefined' &&
      !!import.meta.env &&
      import.meta.env.VITE_PUBLIC_MODE === '1'
    );
  } catch {
    return false;
  }
}

function parseOverride(raw: string | null | undefined): AudioEngineOverride | null {
  if (raw == null) return null;
  const v = raw.trim().toLowerCase();
  if (v === 'js' || v === 'worklet') return 'js';
  if (v === 'native' || v === 'native-worklet') return 'native';
  if (v === 'auto') return 'auto';
  return null;
}

/** Read durable override from localStorage (plain string, not JSON). */
export function readStoredAudioEngineOverride(): AudioEngineOverride {
  if (typeof localStorage === 'undefined') return 'auto';
  try {
    return parseOverride(localStorage.getItem(AUDIO_ENGINE_STORAGE_KEY)) ?? 'auto';
  } catch {
    return 'auto';
  }
}

/** Persist override (`js` | `native` | `auto`). */
export function writeStoredAudioEngineOverride(override: AudioEngineOverride): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (override === 'auto' || override === 'js') {
      // Default is JS — store explicitly as `js` so old sticky `native` is overwritten
      // when the user (or public default path) chooses the JS engine.
      if (override === 'auto') {
        localStorage.removeItem(AUDIO_ENGINE_STORAGE_KEY);
      } else {
        localStorage.setItem(AUDIO_ENGINE_STORAGE_KEY, 'js');
      }
    } else {
      localStorage.setItem(AUDIO_ENGINE_STORAGE_KEY, override);
    }
  } catch {
    // quota / private mode
  }
}

/** Parse `?engine=` from a URLSearchParams / location search string. */
export function parseEngineQueryParam(
  search: string | URLSearchParams | null | undefined,
): AudioEngineOverride | null {
  if (search == null) return null;
  const params = typeof search === 'string'
    ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
    : search;
  return parseOverride(params.get('engine'));
}

/**
 * Resolve effective preference for init / probe gating.
 * URL wins over localStorage for the session (does not write storage).
 * Unset / `auto` resolve to **force-js** (native is opt-in only).
 */
export function resolveAudioEnginePreference(
  search?: string | URLSearchParams | null,
): ResolvedAudioEnginePreference {
  const fromUrl = parseEngineQueryParam(
    search ?? (typeof window !== 'undefined' ? window.location.search : null),
  );

  // URL always wins for the session
  if (fromUrl === 'js') return { mode: 'force-js' };
  if (fromUrl === 'auto') return { mode: 'auto' };
  if (fromUrl === 'native') return { mode: 'prefer-native' };

  // Public / xm-player deploy: ignore sticky localStorage so native is never the
  // accidental default (toggle is hidden; only ?engine=native can opt in).
  if (isPublicModeAudioBuild()) {
    return { mode: 'force-js' };
  }

  const override = readStoredAudioEngineOverride();
  if (override === 'native') return { mode: 'prefer-native' };
  if (override === 'js') return { mode: 'force-js' };
  return { mode: 'auto' };
}

/**
 * Whether init should promote the native engine as the active engine.
 * Glue may still be probed/initialized for UI toggle when not promoted.
 * `prefer-native` soft-fails when glue is missing (caller falls back to JS).
 * Default / force-js never promotes.
 */
export function shouldPromoteNativeEngine(
  preference: ResolvedAudioEnginePreference,
  glueAvailable: boolean,
): boolean {
  if (!glueAvailable) return false;
  if (preference.mode === 'prefer-native') return true;
  if (preference.mode === 'auto') return shouldAutoPreferNative(true);
  return false;
}

/** Map UI/active engine id to durable storage override. */
export function overrideFromActiveEngine(
  engine: 'worklet' | 'native-worklet',
): AudioEngineOverride {
  return engine === 'native-worklet' ? 'native' : 'js';
}
