// Generic, so it imports nothing from the session modules. Split out of songSession.ts so the IndexedDB
// adapter can use it without importing back into songSession (a runtime import cycle; `npm run check:cycles`, #535).
/** Shared listener set for the adapters. */
export function createSessionListeners<T>() {
  const listeners = new Set<(session: T) => void>();
  return {
    subscribe(listener: (session: T) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(session: T) {
      for (const listener of [...listeners]) listener(session);
    },
  };
}
