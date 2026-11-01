/**
 * A minimal external store for `useSyncExternalStore` (#492): an immutable snapshot, replaced on
 * every change, plus change notification.
 *
 * Writes replace the snapshot synchronously — `getSnapshot()` right after a write sees it — but
 * listeners run once per microtask, however many fields changed in between. The UI loop writes
 * several fields per row change (row, seconds, fraction, module info); React would batch the
 * re-render anyway, and this keeps non-React subscribers (mediaSession, test hooks) from seeing
 * the intermediate states one field at a time.
 */

/** A value or an updater from the previous value — React's `SetStateAction`, without React. */
export type SetStateAction<T> = T | ((previous: T) => T);
export type StateSetter<T> = (action: SetStateAction<T>) => void;

/** The `{ current }` shape the engine start paths share (structurally React's `MutableRefObject`). */
export interface Ref<T> {
  current: T;
}

export class SnapshotStore<S extends object> {
  private snapshot: S;
  private readonly listeners = new Set<() => void>();
  private notifyScheduled = false;

  constructor(initial: S) {
    this.snapshot = initial;
  }

  readonly getSnapshot = (): S => this.snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Merge `partial` into the snapshot; a no-op (same snapshot object) when nothing changed. */
  patch(partial: Partial<S>): void {
    const current = this.snapshot;
    let changed = false;
    for (const key of Object.keys(partial) as (keyof S)[]) {
      if (!Object.is(current[key], partial[key])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.snapshot = { ...current, ...partial };
    this.scheduleNotify();
  }

  /** A React-style setter for one field (value or updater). */
  setter<K extends keyof S>(key: K): StateSetter<S[K]> {
    return (action) => {
      const previous = this.snapshot[key];
      const next =
        typeof action === 'function' ? (action as (previous: S[K]) => S[K])(previous) : action;
      this.patch({ [key]: next } as unknown as Partial<S>);
    };
  }

  private scheduleNotify(): void {
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    queueMicrotask(() => {
      this.notifyScheduled = false;
      for (const listener of this.listeners) listener();
    });
  }
}
