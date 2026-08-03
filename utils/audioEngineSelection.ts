/**
 * Audio engine selection — URL / localStorage / auto-probe precedence.
 *
 * Precedence (high → low):
 * 1. `?engine=js|native` (session; does not auto-persist)
 * 2. `localStorage.xasm1_audio_engine` = `js` | `native` | `auto`
 * 3. Auto: probe native glue for UI toggle availability, but stay on JS
 * 4. Promote native only when override is `native` / `?engine=native` and probe OK
 * 5. Else JS worklet → ScriptProcessor on failure
 *
 * Production default: `auto` → **JS worklet**. Native is opt-in until it
 * clears reliability bars (`?engine=native` or localStorage `native`).
 */

export const AUDIO_ENGINE_STORAGE_KEY = 'xasm1_audio_engine';

export type AudioEngineOverride = 'js' | 'native' | 'auto';

export type ResolvedAudioEnginePreference =
  | { mode: 'force-js' }
  | { mode: 'prefer-native' }
  | { mode: 'auto' };

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
    if (override === 'auto') {
      localStorage.removeItem(AUDIO_ENGINE_STORAGE_KEY);
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
 */
export function resolveAudioEnginePreference(
  search?: string | URLSearchParams | null,
): ResolvedAudioEnginePreference {
  const fromUrl = parseEngineQueryParam(
    search ?? (typeof window !== 'undefined' ? window.location.search : null),
  );
  const override = fromUrl ?? readStoredAudioEngineOverride();

  if (override === 'js') return { mode: 'force-js' };
  if (override === 'native') return { mode: 'prefer-native' };
  return { mode: 'auto' };
}

/**
 * Whether init should promote the native engine as the active engine.
 * Glue may still be probed/initialized for UI toggle when not promoted.
 * `prefer-native` soft-fails when glue is missing (caller falls back to JS).
 * `auto` stays on JS (native is opt-in for now).
 */
export function shouldPromoteNativeEngine(
  preference: ResolvedAudioEnginePreference,
  glueAvailable: boolean,
): boolean {
  if (preference.mode !== 'prefer-native') return false;
  if (!glueAvailable) return false;
  return true;
}

/** Map UI/active engine id to durable storage override. */
export function overrideFromActiveEngine(
  engine: 'worklet' | 'native-worklet',
): AudioEngineOverride {
  return engine === 'native-worklet' ? 'native' : 'js';
}
