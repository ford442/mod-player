/** IndexedDB adapter for SongSession records (#511): one object store, key = fingerprint. */
import { createSessionListeners, type SongSession, type SongSessionStore } from './songSession';

export const SONG_SESSION_DB = 'xasm1-song-sessions';
export const SONG_SESSION_OBJECT_STORE = 'sessions';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function createIndexedDbSongSessionStore(dbName = SONG_SESSION_DB): SongSessionStore {
  const listeners = createSessionListeners();
  let db: Promise<IDBDatabase> | null = null;
  const open = () => {
    db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(SONG_SESSION_OBJECT_STORE, { keyPath: 'fingerprint' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch((e: unknown) => {
      db = null; // retry on the next call (private mode, blocked upgrade, …)
      throw e;
    });
    return db;
  };
  return {
    async get(fingerprint) {
      const tx = (await open()).transaction(SONG_SESSION_OBJECT_STORE, 'readonly');
      const found = await request<SongSession | undefined>(tx.objectStore(SONG_SESSION_OBJECT_STORE).get(fingerprint));
      return found ?? null;
    },
    async put(session) {
      const tx = (await open()).transaction(SONG_SESSION_OBJECT_STORE, 'readwrite');
      await request(tx.objectStore(SONG_SESSION_OBJECT_STORE).put(session));
      listeners.emit(session);
    },
    subscribe: listeners.subscribe,
  };
}
