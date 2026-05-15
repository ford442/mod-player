import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

type Setter<T> = T | ((previousValue: T) => T);

export function useLocalStorage<T>(key: string, defaultValue: T): [T, (value: Setter<T>) => void] {
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
  const valueRef = useRef<T>(value);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const setValue = useCallback((nextValue: Setter<T>) => {
    try {
      const resolvedValue =
        typeof nextValue === 'function'
          ? (nextValue as (previousValue: T) => T)(valueRef.current)
          : nextValue;
      window.localStorage.setItem(key, JSON.stringify(resolvedValue));
    } catch {
      // Ignore localStorage write errors (e.g. quota exceeded)
    }
    window.dispatchEvent(new StorageEvent('storage', { key }));
  }, [key]);

  return [value, setValue];
}
