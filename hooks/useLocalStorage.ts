import { useCallback, useSyncExternalStore } from 'react';

export function useLocalStorage<T>(key: string, defaultValue: T): [T, (value: T) => void] {
  const subscribe = useCallback((callback: () => void) => {
    window.addEventListener('storage', callback);
    return () => window.removeEventListener('storage', callback);
  }, []);

  const getSnapshot = useCallback(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw !== null ? (JSON.parse(raw) as T) : defaultValue;
    } catch {
      return defaultValue;
    }
  }, [defaultValue, key]);

  const value = useSyncExternalStore(subscribe, getSnapshot, () => defaultValue);

  const setValue = useCallback((nextValue: T) => {
    try {
      window.localStorage.setItem(key, JSON.stringify(nextValue));
    } catch {
      // Ignore localStorage write errors (e.g. quota exceeded)
    }
    window.dispatchEvent(new StorageEvent('storage', { key }));
  }, [key]);

  return [value, setValue];
}
