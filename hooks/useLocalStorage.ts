import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

type Setter<T> = T | ((previousValue: T) => T);

export function useLocalStorage<T>(key: string, defaultValue: T): [T, (value: Setter<T>) => void] {
  // Stabilize defaultValue across renders. Callers commonly pass an inline literal
  // (e.g. `{}` or `[]`), which would otherwise be a fresh reference every render and
  // break useSyncExternalStore's referential-equality contract.
  const defaultValueRef = useRef<T>(defaultValue);

  const subscribe = useCallback((callback: () => void) => {
    window.addEventListener('storage', callback);
    return () => window.removeEventListener('storage', callback);
  }, []);

  // Cache the parsed snapshot keyed by the raw string from localStorage so repeated
  // getSnapshot() calls return the SAME reference until the stored value actually changes.
  const cachedRawRef = useRef<string | null | undefined>(undefined);
  const cachedValueRef = useRef<T>(defaultValue);

  const getSnapshot = useCallback((): T => {
    let raw: string | null;
    try {
      raw = window.localStorage.getItem(key);
    } catch {
      return defaultValueRef.current;
    }
    if (raw === null) {
      if (cachedRawRef.current !== null) {
        cachedRawRef.current = null;
        cachedValueRef.current = defaultValueRef.current;
      }
      return cachedValueRef.current;
    }
    if (raw !== cachedRawRef.current) {
      try {
        cachedValueRef.current = JSON.parse(raw) as T;
      } catch {
        cachedValueRef.current = defaultValueRef.current;
      }
      cachedRawRef.current = raw;
    }
    return cachedValueRef.current;
  }, [key]);

  const getServerSnapshot = useCallback((): T => defaultValueRef.current, []);

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
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
