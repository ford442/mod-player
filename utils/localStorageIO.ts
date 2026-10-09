/** Read/write localStorage as JSON (the format the former hooks/useLocalStorage.ts used, so stored values still parse) */

export function readLocalStorage<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeLocalStorage<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota / private mode
  }
  window.dispatchEvent(new StorageEvent('storage', { key }));
}
