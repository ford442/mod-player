import type { SongSession } from './songSession';

/** Subscriber set shared by the memory and IndexedDB session stores (own module: no import cycle). */
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
