/**
 * The fingerprint of the song currently loaded (#453), published by the
 * module loader and read by the FX store (per-song presets). Null while a
 * load is hashing or when nothing is loaded.
 */
import { computeSongFingerprint } from './songFingerprint';

type Listener = (fingerprint: string | null) => void;

let current: string | null = null;
let loadToken = 0;
const listeners = new Set<Listener>();

export function getSongFingerprint(): string | null {
  return current;
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
  return computeSongFingerprint(bytes).then(
    (fingerprint) => {
      if (token === loadToken) setSongFingerprint(fingerprint);
    },
    () => {
      /* leave it null: per-song presets are simply unavailable for this load */
    },
  );
}
