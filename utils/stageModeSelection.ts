/**
 * Stage-mode selection — URL / localStorage / default precedence.
 *
 * Precedence (high → low):
 * 1. `?stage=1|0|true|false|on|off` (session; does not auto-persist)
 * 2. `localStorage.xasm1_stage_mode` (JSON boolean via readLocalStorage)
 * 3. Default: false
 */

import { readLocalStorage } from './localStorageIO';

export const STAGE_MODE_STORAGE_KEY = 'xasm1_stage_mode';

function parseStageFlag(raw: string | null | undefined): boolean | null {
  if (raw == null) return null;
  const v = raw.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'on' || v === 'yes') return true;
  if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
  return null;
}

/** Parse `?stage=` from a URLSearchParams / location search string. */
export function parseStageQueryParam(
  search: string | URLSearchParams | null | undefined,
): boolean | null {
  if (search == null) return null;
  const params = typeof search === 'string'
    ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
    : search;
  return parseStageFlag(params.get('stage'));
}

/**
 * Resolve stage mode at init.
 * URL wins for the session (does not write storage). Malformed values fall through.
 */
export function resolveStageModePreference(
  search?: string | URLSearchParams | null,
): boolean {
  const fromUrl = parseStageQueryParam(
    search ?? (typeof window !== 'undefined' ? window.location.search : null),
  );
  if (fromUrl !== null) return fromUrl;
  return readLocalStorage<boolean>(STAGE_MODE_STORAGE_KEY, false);
}
