/**
 * A minimal in-memory IndexedDB: just the surface utils/faultReport.ts uses (open with an upgrade,
 * one auto-increment object store, add / getAll / getAllKeys / delete / clear in a transaction).
 * Values are structured-cloned like the real thing, request events fire asynchronously, and a
 * transaction completes once no request is pending after a macrotask — so code that awaits one
 * request and then issues another in the same transaction behaves as it does in a browser.
 *
 * Not a general IndexedDB: no indexes, cursors, key paths, versions beyond the first upgrade.
 */

type Listener = (() => void) | null;

class FakeRequest<T> {
  result!: T;
  error: DOMException | null = null;
  onsuccess: Listener = null;
  onerror: Listener = null;
  onupgradeneeded: Listener = null;
}

class FakeObjectStore {
  constructor(
    private readonly rows: Map<number, unknown>,
    private readonly meta: { nextKey: number },
    private readonly tx: FakeTransaction,
  ) {}

  private request<T>(run: () => T): FakeRequest<T> {
    const req = new FakeRequest<T>();
    this.tx.pending += 1;
    queueMicrotask(() => {
      try {
        req.result = run();
        req.onsuccess?.();
      } catch (e) {
        req.error = e as DOMException;
        req.onerror?.();
        this.tx.fail(req.error);
      } finally {
        this.tx.pending -= 1;
        this.tx.scheduleComplete();
      }
    });
    return req;
  }

  private write<T>(run: () => T): FakeRequest<T> {
    if (this.tx.mode !== 'readwrite') throw new DOMException('Transaction is read-only', 'ReadOnlyError');
    return this.request(run);
  }

  add(value: unknown): FakeRequest<number> {
    return this.write(() => {
      const key = this.meta.nextKey++;
      this.rows.set(key, structuredClone(value));
      return key;
    });
  }

  getAll(): FakeRequest<unknown[]> {
    return this.request(() => [...this.rows.keys()].sort((a, b) => a - b).map((k) => structuredClone(this.rows.get(k))));
  }

  getAllKeys(): FakeRequest<number[]> {
    return this.request(() => [...this.rows.keys()].sort((a, b) => a - b));
  }

  delete(key: number): FakeRequest<undefined> {
    return this.write(() => {
      this.rows.delete(key);
      return undefined;
    });
  }

  clear(): FakeRequest<undefined> {
    return this.write(() => {
      this.rows.clear();
      return undefined;
    });
  }
}

class FakeTransaction {
  pending = 0;
  error: DOMException | null = null;
  oncomplete: Listener = null;
  onerror: Listener = null;
  onabort: Listener = null;
  private finished = false;

  constructor(
    private readonly db: FakeDatabase,
    private readonly storeName: string,
    readonly mode: IDBTransactionMode,
  ) {
    this.scheduleComplete();
  }

  objectStore(name: string): FakeObjectStore {
    if (this.finished) throw new DOMException('Transaction has finished', 'TransactionInactiveError');
    if (name !== this.storeName) throw new DOMException(`No store ${name} in this transaction`, 'NotFoundError');
    const store = this.db.stores.get(name);
    if (!store) throw new DOMException(`No store ${name}`, 'NotFoundError');
    return new FakeObjectStore(store.rows, store.meta, this);
  }

  scheduleComplete(): void {
    setTimeout(() => {
      if (this.finished || this.pending > 0) return;
      this.finished = true;
      this.oncomplete?.();
    }, 0);
  }

  fail(error: DOMException): void {
    if (this.finished) return;
    this.finished = true;
    this.error = error;
    this.onerror?.();
    this.onabort?.();
  }
}

interface StoreData {
  rows: Map<number, unknown>;
  meta: { nextKey: number };
}

class FakeDatabase {
  readonly stores = new Map<string, StoreData>();
  version = 0;

  createObjectStore(name: string, options?: { autoIncrement?: boolean }): void {
    if (!options?.autoIncrement) throw new Error('fakeIndexedDb: only autoIncrement stores are supported');
    this.stores.set(name, { rows: new Map(), meta: { nextKey: 1 } });
  }

  transaction(name: string, mode: IDBTransactionMode = 'readonly'): FakeTransaction {
    if (!this.stores.has(name)) throw new DOMException(`No store ${name}`, 'NotFoundError');
    return new FakeTransaction(this, name, mode);
  }

  close(): void {}
}

export interface FakeIndexedDb {
  /** Pass to code that takes an `IDBFactory`. */
  factory: IDBFactory;
  /** Rows of `store` in `db`, oldest first (what a browser's devtools would show). */
  rows(db: string, store: string): unknown[];
}

export function createFakeIndexedDb(options: { failOpen?: boolean } = {}): FakeIndexedDb {
  const databases = new Map<string, FakeDatabase>();
  const factory = {
    open(name: string, version = 1) {
      const req = new FakeRequest<FakeDatabase>();
      setTimeout(() => {
        if (options.failOpen) {
          req.error = new DOMException('The user denied permission to access the database.', 'UnknownError');
          req.onerror?.();
          return;
        }
        let db = databases.get(name);
        if (!db) {
          db = new FakeDatabase();
          databases.set(name, db);
        }
        req.result = db;
        if (db.version < version) {
          db.version = version;
          req.onupgradeneeded?.();
        }
        req.onsuccess?.();
      }, 0);
      return req;
    },
  };
  return {
    factory: factory as unknown as IDBFactory,
    rows(db, store) {
      const rows = databases.get(db)?.stores.get(store)?.rows;
      if (!rows) return [];
      return [...rows.keys()].sort((a, b) => a - b).map((k) => rows.get(k));
    },
  };
}
