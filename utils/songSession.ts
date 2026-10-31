/**
 * Per-song memory (#511): one `SongSession` record per song fingerprint
 * (`utils/songFingerprint.ts`, published by `utils/songIdentity.ts`).
 *
 * Global preferences stay in localStorage (theme, last shader, favorites).
 * Everything that belongs to one song lives in this record, backed by
 * IndexedDB in the browser (`utils/songSessionIdb.ts`) and by memory in tests
 * or where IndexedDB is missing. FX song overrides are *not* here: fxStore
 * already keys them on the same fingerprint and keeps its own format.
 *
 * Main thread only, from load / user-action handlers: never from the
 * AudioWorklet and never from a requestAnimationFrame callback
 * (tests/songSessionGuards.test.ts).
 */
import { createIndexedDbSongSessionStore } from './songSessionIdb';

export interface SongPosition {
  order: number;
  row: number;
  seconds: number;
}

export interface SongSession {
  fingerprint: string;
  /** Shader picked while this song was loaded; null = none remembered. */
  shader: string | null;
  /** Reserved for the mixer's mute / solo mask (#512). Nothing writes it yet. */
  channelMask?: number[];
  /** Last known transport position ("resume this song"). */
  lastPosition: SongPosition | null;
  /** The one-time copy from the legacy 16-byte-prefix localStorage key has run. */
  legacyShaderMigrated: boolean;
}

export type SongSessionPatch = Partial<Omit<SongSession, 'fingerprint'>>;

export interface SongSessionStore {
  get(fingerprint: string): Promise<SongSession | null>;
  put(session: SongSession): Promise<void>;
  /** Called after every successful put, with the record as stored. */
  subscribe(listener: (session: SongSession) => void): () => void;
}

export function emptySongSession(fingerprint: string): SongSession {
  return { fingerprint, shader: null, lastPosition: null, legacyShaderMigrated: false };
}

/** Shared listener set for the adapters. */
export function createSessionListeners() {
  const listeners = new Set<(session: SongSession) => void>();
  return {
    subscribe(listener: (session: SongSession) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(session: SongSession) {
      for (const listener of [...listeners]) listener(session);
    },
  };
}

export function createMemorySongSessionStore(): SongSessionStore {
  const records = new Map<string, SongSession>();
  const listeners = createSessionListeners();
  return {
    get: (fingerprint) => Promise.resolve(records.has(fingerprint) ? structuredClone(records.get(fingerprint)!) : null),
    put: (session) => {
      records.set(session.fingerprint, structuredClone(session));
      listeners.emit(structuredClone(session));
      return Promise.resolve();
    },
    subscribe: listeners.subscribe,
  };
}

let store: SongSessionStore | null = null;
let queue: Promise<unknown> = Promise.resolve();

export function getSongSessionStore(): SongSessionStore {
  if (!store) {
    store = typeof indexedDB !== 'undefined' ? createIndexedDbSongSessionStore() : createMemorySongSessionStore();
  }
  return store;
}

/** Swap the backing store (tests). */
export function setSongSessionStore(next: SongSessionStore): void {
  store = next;
  queue = Promise.resolve();
}

/**
 * Read-modify-write one record. Updates run one at a time, so two patches to
 * the same song never lose each other's fields.
 */
export function updateSongSession(fingerprint: string, patch: SongSessionPatch): Promise<SongSession> {
  const target = getSongSessionStore();
  const run = queue.then(async () => {
    const next = { ...((await target.get(fingerprint)) ?? emptySongSession(fingerprint)), ...patch, fingerprint };
    await target.put(next);
    return next;
  });
  queue = run.catch(() => undefined);
  return run;
}

/** Reads wait for queued writes, so they see the latest record. */
export function readSongSession(fingerprint: string): Promise<SongSession | null> {
  const target = getSongSessionStore();
  return queue.then(() => target.get(fingerprint));
}

export function recordSongPosition(fingerprint: string, position: SongPosition): Promise<SongSession> {
  return updateSongSession(fingerprint, { lastPosition: { ...position } });
}
