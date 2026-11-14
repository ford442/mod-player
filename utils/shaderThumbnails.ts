/**
 * Live shader thumbnails: a small WebP of the pattern canvas per shader, kept in IndexedDB.
 *
 * They used to be full-size PNG data URLs (1024² × DPR) in one localStorage key. A few shaders
 * filled the origin's quota, `writeLocalStorage` swallowed the error, and every other preference
 * write started failing silently too. Now: capped at THUMBNAIL_MAX_EDGE px, WebP where the
 * browser encodes it (PNG otherwise, still a few KB at this size), one IndexedDB record each.
 */

/** Longest edge of a stored thumbnail, in px. */
export const THUMBNAIL_MAX_EDGE = 160;
export const THUMBNAIL_MIME = 'image/webp';
const THUMBNAIL_QUALITY = 0.8;

/** The localStorage key the old data-URL map lived under; cleared on startup to free the quota. */
export const LEGACY_THUMBNAIL_STORAGE_KEY = 'xasm1-shader-thumbnails';

const DB_NAME = 'xasm1-shader-thumbnails';
const DB_VERSION = 1;
const STORE = 'thumbnails';

export interface ShaderThumbnailRecord {
  id: string;
  blob: Blob;
  capturedAt: number;
}

/** Thumbnail size for a `width` × `height` source: aspect kept, longest edge ≤ `maxEdge`, never upscaled. */
export function thumbnailSize(width: number, height: number, maxEdge = THUMBNAIL_MAX_EDGE): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Downscales `source` and encodes it; `null` when the canvas is empty, tainted or encoding fails. */
export async function captureShaderThumbnail(source: HTMLCanvasElement): Promise<Blob | null> {
  const { width, height } = thumbnailSize(source.width, source.height);
  if (width === 0) return null;
  const target = document.createElement('canvas');
  target.width = width;
  target.height = height;
  const ctx = target.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  return new Promise<Blob | null>((resolve) => {
    try {
      target.toBlob((blob) => resolve(blob && blob.size > 0 ? blob : null), THUMBNAIL_MIME, THUMBNAIL_QUALITY);
    } catch {
      resolve(null); // SecurityError on a tainted canvas
    }
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
  });
}

export async function loadShaderThumbnailRecords(): Promise<ShaderThumbnailRecord[]> {
  if (typeof indexedDB === 'undefined') return [];
  const db = await openDatabase();
  try {
    return await new Promise<ShaderThumbnailRecord[]>((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      request.onsuccess = () => resolve((request.result as ShaderThumbnailRecord[] | undefined) ?? []);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB read failed'));
    });
  } finally {
    db.close();
  }
}

export async function saveShaderThumbnailRecord(record: ShaderThumbnailRecord): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'));
    });
  } finally {
    db.close();
  }
}

/** Removes the old localStorage data-URL map (it is what filled the quota). */
export function clearLegacyThumbnailStorage(): void {
  try {
    window.localStorage.removeItem(LEGACY_THUMBNAIL_STORAGE_KEY);
  } catch {
    // private mode / no storage
  }
}
