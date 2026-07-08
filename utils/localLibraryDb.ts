import type { LibraryEntry, LibraryRoot } from '../types/localLibrary';

const DB_NAME = 'xasm1-local-library';
const DB_VERSION = 2;
const ROOTS_STORE = 'roots';
const ENTRIES_STORE = 'entries';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ROOTS_STORE)) {
        db.createObjectStore(ROOTS_STORE, { keyPath: 'id' });
      }
      const entriesStore = db.objectStoreNames.contains(ENTRIES_STORE)
        ? (request.transaction as IDBTransaction).objectStore(ENTRIES_STORE)
        : db.createObjectStore(ENTRIES_STORE, { keyPath: 'id' });
      if (!entriesStore.indexNames.contains('rootId')) {
        entriesStore.createIndex('rootId', 'rootId', { unique: false });
      }
      if (!entriesStore.indexNames.contains('title')) {
        entriesStore.createIndex('title', 'title', { unique: false });
      }
      if (!entriesStore.indexNames.contains('favorite')) {
        entriesStore.createIndex('favorite', 'favorite', { unique: false });
      }
      if (!entriesStore.indexNames.contains('lastPlayed')) {
        entriesStore.createIndex('lastPlayed', 'lastPlayed', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  stores: string[],
  fn: (tx: IDBTransaction) => IDBRequest<T> | void,
): Promise<T | void> {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(stores, mode);
        let request: IDBRequest<T> | undefined;
        tx.oncomplete = () => resolve(request?.result);
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
        const result = fn(tx);
        if (result) request = result;
      }),
  );
}

export async function loadLibraryRoots(): Promise<LibraryRoot[]> {
  const result = await runTransaction<LibraryRoot[]>('readonly', [ROOTS_STORE], (tx) =>
    tx.objectStore(ROOTS_STORE).getAll(),
  );
  return (result as LibraryRoot[] | void) ?? [];
}

export async function loadLibraryEntries(): Promise<LibraryEntry[]> {
  const result = await runTransaction<LibraryEntry[]>('readonly', [ENTRIES_STORE], (tx) =>
    tx.objectStore(ENTRIES_STORE).getAll(),
  );
  return (result as LibraryEntry[] | void) ?? [];
}

export async function saveLibraryRoot(root: LibraryRoot): Promise<void> {
  await runTransaction('readwrite', [ROOTS_STORE], (tx) => {
    tx.objectStore(ROOTS_STORE).put(root);
  });
}

export async function saveLibraryEntries(entries: LibraryEntry[]): Promise<void> {
  if (entries.length === 0) return;
  await openDatabase().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(ENTRIES_STORE, 'readwrite');
        const store = tx.objectStore(ENTRIES_STORE);
        for (const entry of entries) {
          store.put(entry);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('Failed to save entries'));
      }),
  );
}

export async function deleteLibraryRoot(rootId: string): Promise<void> {
  await openDatabase().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction([ROOTS_STORE, ENTRIES_STORE], 'readwrite');
        tx.objectStore(ROOTS_STORE).delete(rootId);
        const index = tx.objectStore(ENTRIES_STORE).index('rootId');
        const cursorReq = index.openCursor(IDBKeyRange.only(rootId));
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('Failed to delete root'));
      }),
  );
}

export async function deleteEntriesForRoot(rootId: string): Promise<void> {
  await openDatabase().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(ENTRIES_STORE, 'readwrite');
        const index = tx.objectStore(ENTRIES_STORE).index('rootId');
        const cursorReq = index.openCursor(IDBKeyRange.only(rootId));
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('Failed to delete entries'));
      }),
  );
}

export async function replaceRootEntries(
  root: LibraryRoot,
  entries: LibraryEntry[],
): Promise<void> {
  await openDatabase().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction([ROOTS_STORE, ENTRIES_STORE], 'readwrite');
        tx.objectStore(ROOTS_STORE).put(root);

        const index = tx.objectStore(ENTRIES_STORE).index('rootId');
        const cursorReq = index.openCursor(IDBKeyRange.only(root.id));
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          }
        };

        const store = tx.objectStore(ENTRIES_STORE);
        for (const entry of entries) {
          store.put(entry);
        }

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('Failed to replace root entries'));
      }),
  );
}

export async function mergeLibraryScan(
  root: LibraryRoot,
  entries: LibraryEntry[],
): Promise<void> {
  await openDatabase().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction([ROOTS_STORE, ENTRIES_STORE], 'readwrite');
        tx.objectStore(ROOTS_STORE).put(root);
        const store = tx.objectStore(ENTRIES_STORE);
        for (const entry of entries) {
          store.put(entry);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('Failed to merge library scan'));
      }),
  );
}

export function makeEntryId(rootId: string, relativePath: string): string {
  return `${rootId}::${relativePath}`;
}

export async function saveLibraryEntry(entry: LibraryEntry): Promise<void> {
  await runTransaction('readwrite', [ENTRIES_STORE], (tx) => {
    tx.objectStore(ENTRIES_STORE).put(entry);
  });
}

export async function deleteLibraryEntry(entryId: string): Promise<void> {
  await runTransaction('readwrite', [ENTRIES_STORE], (tx) => {
    tx.objectStore(ENTRIES_STORE).delete(entryId);
  });
}
