/**
 * The fingerprint of the song currently loaded (#453), published by the
 * module loader and read by the FX store (per-song presets) and the shader
 * store's SongSession record (#511). The only song-identity publisher. Null
 * while a load is hashing or when nothing is loaded.
 */
import { computeSongFingerprint } from './songFingerprint';

type Listener = (fingerprint: string | null) => void;

let current: string | null = null;
let currentLegacyKey: string | null = null;
let loadToken = 0;
const listeners = new Set<Listener>();

export function getSongFingerprint(): string | null {
  return current;
}

/**
 * The pre-#511 per-module localStorage key of the current song: hex of its
 * first 16 bytes (what `computeModuleHash` returned). Only the one-time shader
 * migration reads it; it collides for every XM, so never key anything new on it.
 */
export function getLegacyModuleKey(): string | null {
  return current === null ? null : currentLegacyKey;
}

export function legacyModuleKey(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes.subarray(0, 16)) out += b.toString(16).padStart(2, '0');
  return out;
}

export function setSongFingerprint(fingerprint: string | null): void {
  if (fingerprint === current) return;
  current = fingerprint;
  for (const listener of [...listeners]) listener(fingerprint);
}

export function subscribeSongFingerprint(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Called by the module loader for every new file: clears the fingerprint at
 * once, then publishes the new one — unless another file was loaded meanwhile.
 */
export function publishSongBytes(bytes: Uint8Array): Promise<void> {
  const token = ++loadToken;
  setSongFingerprint(null);
  currentLegacyKey = legacyModuleKey(bytes);
  return computeSongFingerprint(bytes).then(
    (fingerprint) => {
      if (token === loadToken) setSongFingerprint(fingerprint);
    },
    () => {
      /* leave it null: per-song presets are simply unavailable for this load */
    },
  );
}
