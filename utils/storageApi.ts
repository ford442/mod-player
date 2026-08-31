import { z } from 'zod';
import { detectRuntimeBase } from '../src/lib/paths';
import { getLocalCatalogSongs, getLocalShaderCatalog } from './localCatalog';

/** Production library API (storage_manager on Contabo). Dev uses Vite proxy when unset. */
const PRODUCTION_STORAGE_API = 'https://storage.noahcohn.com';

const storageBaseUrl = (() => {
  const fromEnv = (import.meta.env.VITE_STORAGE_API_URL ?? '').trim().replace(/\/+$/, '');
  if (fromEnv) return fromEnv;
  if (import.meta.env.PROD) return PRODUCTION_STORAGE_API;
  return '';
})();

const SongSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  fileName: z.string().optional(),
  filename: z.string().optional(),
  title: z.string().optional(),
  artist: z.string().optional(),
  author: z.string().optional(),
  duration: z.number().optional(),
  durationSeconds: z.number().optional(),
  downloadUrl: z.string().optional(),
  download_url: z.string().optional(),
  url: z.string().optional(),
}).passthrough();

const ShaderSchema = z.object({
  id: z.union([z.string(), z.number()]),
  name: z.string().optional(),
  shader_name: z.string().optional(),
  rating: z.number().optional(),
  averageRating: z.number().optional(),
  average_rating: z.number().optional(),
  score: z.number().optional(),
  votes: z.number().optional(),
  voteCount: z.number().optional(),
  vote_count: z.number().optional(),
  userRating: z.number().optional(),
  user_rating: z.number().optional(),
}).passthrough();

const SongListSchema = z.union([
  z.array(SongSchema),
  z.object({ songs: z.array(SongSchema) }),
  z.object({ items: z.array(SongSchema) }),
  z.object({ results: z.array(SongSchema) }),
]);

const ShaderListSchema = z.union([
  z.array(ShaderSchema),
  z.object({ shaders: z.array(ShaderSchema) }),
  z.object({ items: z.array(ShaderSchema) }),
  z.object({ results: z.array(ShaderSchema) }),
]);

const SongSaveResponseSchema = z.union([
  SongSchema,
  z.object({ song: SongSchema }),
  z.object({ item: SongSchema }),
  z.object({ result: SongSchema }),
]);

const ShaderRateResponseSchema = z.union([
  z.null(),
  ShaderSchema,
  z.object({ shader: ShaderSchema }),
  z.object({ item: ShaderSchema }),
  z.object({ result: ShaderSchema }),
]);

const SyncResponseSchema = z.union([
  z.null(),
  z.object({
    ok: z.boolean().optional(),
    synced: z.number().int().nonnegative().optional(),
    message: z.string().optional(),
  }).passthrough(),
]);

export class SchemaMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaMismatchError';
  }
}

export interface RemoteSong {
  id: string;
  fileName: string;
  title: string;
  artist: string;
  durationSeconds?: number;
  downloadUrl: string;
}

export interface ShaderMeta {
  id: string;
  name: string;
  averageRating: number | null;
  voteCount: number | null;
  userRating: number | null;
}

export interface SyncLibraryResult {
  synced: number | null;
  message: string | null;
}

/** Resolve API path with subdirectory base (e.g. /xm-player/api/songs). */
export function toApiUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (storageBaseUrl) {
    return `${storageBaseUrl}${normalized}`;
  }
  const base = detectRuntimeBase().replace(/\/$/, '');
  return `${base}${normalized}`;
}

function normalizeSong(raw: z.infer<typeof SongSchema>): RemoteSong {
  const rawDownloadUrl = raw.downloadUrl ?? raw.download_url ?? raw.url;
  if (!rawDownloadUrl) {
    throw new SchemaMismatchError('library format outdated: song is missing download URL');
  }
  let downloadUrl = rawDownloadUrl;
  if (storageBaseUrl) {
    try {
      downloadUrl = new URL(rawDownloadUrl, `${storageBaseUrl}/`).toString();
    } catch {
      downloadUrl = rawDownloadUrl;
    }
  }

  const fileName = raw.fileName ?? raw.filename ?? decodeURIComponent(downloadUrl.split('/').pop() || 'remote.mod');
  const durationSeconds = raw.durationSeconds ?? raw.duration;

  const song: RemoteSong = {
    id: String(raw.id ?? downloadUrl),
    fileName,
    title: raw.title ?? fileName,
    artist: raw.artist ?? raw.author ?? '',
    downloadUrl,
  };
  if (durationSeconds !== undefined) {
    song.durationSeconds = durationSeconds;
  }
  return song;
}

function normalizeShader(raw: z.infer<typeof ShaderSchema>): ShaderMeta {
  const id = String(raw.id);
  return {
    id,
    name: raw.name ?? raw.shader_name ?? id,
    averageRating: raw.averageRating ?? raw.average_rating ?? raw.rating ?? raw.score ?? null,
    voteCount: raw.voteCount ?? raw.vote_count ?? raw.votes ?? null,
    userRating: raw.userRating ?? raw.user_rating ?? null,
  };
}

function unwrapSongSaveResponse(parsed: z.infer<typeof SongSaveResponseSchema>): z.infer<typeof SongSchema> {
  const wrapped = parsed as { song?: z.infer<typeof SongSchema>; item?: z.infer<typeof SongSchema>; result?: z.infer<typeof SongSchema> };
  return wrapped.song ?? wrapped.item ?? wrapped.result ?? (parsed as z.infer<typeof SongSchema>);
}

function unwrapShaderRateResponse(parsed: Exclude<z.infer<typeof ShaderRateResponseSchema>, null>): z.infer<typeof ShaderSchema> {
  const wrapped = parsed as { shader?: z.infer<typeof ShaderSchema>; item?: z.infer<typeof ShaderSchema>; result?: z.infer<typeof ShaderSchema> };
  return wrapped.shader ?? wrapped.item ?? wrapped.result ?? (parsed as z.infer<typeof ShaderSchema>);
}

/**
 * Fetch JSON from the storage API. Returns null on 404/network errors so callers
 * can degrade gracefully (empty playlist / shader catalog).
 */
async function fetchJsonGraceful(url: string, label: string): Promise<unknown | null> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      console.warn(`[storageApi] ${label} not reachable (${response.status}). Degraded mode active.`);
      return null;
    }
    return await response.json();
  } catch (error) {
    console.warn(`[storageApi] ${label} network error — degraded mode active:`, error);
    return null;
  }
}

const TRACKER_EXT_RE =
  /\.(mod|xm|s3m|it|mptm|stm|669|amf|ams|dbm|dmf|dsm|far|gdm|j2b|mdl|med|mtm|okt|psm|ptm|ult|umx|mt2|mo3)(?:[?#].*)?$/i;

const MODS_DOWNLOAD_RE = /\/api\/mods\/[^/]+\/download(?:[?#]|$)/i;

/** Endpoints that list tracker modules. `/api/songs` (no type) is the flac_player library. */
const TRACKER_LIBRARY_PATHS = ['/api/mods', '/api/songs?type=mod'] as const;

function unwrapSongList(parsed: z.infer<typeof SongListSchema>): z.infer<typeof SongSchema>[] {
  if (Array.isArray(parsed)) return parsed;
  if ('songs' in parsed) return parsed.songs;
  if ('items' in parsed) return parsed.items;
  return parsed.results;
}

export function isTrackerLibrarySong(song: RemoteSong): boolean {
  if (TRACKER_EXT_RE.test(song.fileName) || TRACKER_EXT_RE.test(song.downloadUrl)) {
    return true;
  }
  return MODS_DOWNLOAD_RE.test(song.downloadUrl);
}

function parseRemoteSongList(payload: unknown, label: string): RemoteSong[] | null {
  const parsed = SongListSchema.safeParse(payload);
  if (!parsed.success) {
    console.warn(`[storageApi] invalid ${label} response — degraded mode active.`);
    return null;
  }
  try {
    return unwrapSongList(parsed.data).map(normalizeSong);
  } catch (error) {
    console.warn('[storageApi] song normalization failed — degraded mode active:', error);
    return null;
  }
}

export async function fetchRemoteSongs(): Promise<RemoteSong[]> {
  // Prefer /api/mods (full downloadUrl + fileName). Never fall back to bare
  // /api/songs — that is the FLAC/MP3 catalog and libopenmpt cannot load it.
  for (const path of TRACKER_LIBRARY_PATHS) {
    const payload = await fetchJsonGraceful(toApiUrl(path), path);
    if (payload === null) continue;
    const songs = parseRemoteSongList(payload, path);
    if (songs === null) continue;
    const tracker = songs.filter(isTrackerLibrarySong);
    if (tracker.length > 0) return tracker;
  }
  return getLocalCatalogSongs();
}

export async function fetchShaders(): Promise<ShaderMeta[]> {
  const url = toApiUrl('/api/shaders');
  const payload = await fetchJsonGraceful(url, '/api/shaders');
  if (payload === null) return getLocalShaderCatalog();

  const parsed = ShaderListSchema.safeParse(payload);
  if (!parsed.success) {
    console.warn('[storageApi] invalid /api/shaders response — degraded mode active.');
    return getLocalShaderCatalog();
  }
  const shaders = Array.isArray(parsed.data)
    ? parsed.data
    : 'shaders' in parsed.data
      ? parsed.data.shaders
      : 'items' in parsed.data
        ? parsed.data.items
        : parsed.data.results;
  const normalized = shaders.map(normalizeShader);
  return normalized.length > 0 ? normalized : getLocalShaderCatalog();
}

export async function rateShader(id: string, score: number): Promise<ShaderMeta | null> {
  const response = await fetch(toApiUrl(`/api/shaders/${encodeURIComponent(id)}/rate`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ score }),
  });
  if (!response.ok) {
    throw new Error(`failed to rate shader (${response.status})`);
  }
  if (response.status === 204) {
    return null;
  }
  const payload: unknown = await response.json();
  const parsed = ShaderRateResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SchemaMismatchError('library format outdated: invalid /api/shaders/{id}/rate response');
  }
  if (parsed.data === null) {
    return null;
  }
  return normalizeShader(unwrapShaderRateResponse(parsed.data));
}

// ─── Save Song ───────────────────────────────────────────────────────────────

const SongSaveRequestSchema = z.object({
  title: z.string().min(1),
  fileName: z.string().optional(),
  format: z.string().optional(),
  channelCount: z.number().int().positive().optional(),
  durationSeconds: z.number().nonnegative().optional(),
}).passthrough();

export type SongSaveRequest = z.infer<typeof SongSaveRequestSchema>;

export async function saveSong(req: SongSaveRequest): Promise<RemoteSong> {
  if (!navigator.onLine) {
    throw new Error('You are offline. Connect to the internet and try again.');
  }
  const validated = SongSaveRequestSchema.safeParse(req);
  if (!validated.success) {
    throw new Error('Invalid save request: title is required');
  }
  const response = await fetch(toApiUrl('/api/songs'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(validated.data),
  });
  if (response.status === 409) {
    throw new Error('This module is already in your library.');
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error('You do not have permission to save to the library.');
  }
  if (!response.ok) {
    throw new Error(`Failed to save module (${response.status})`);
  }
  const payload: unknown = await response.json();
  const parsed = SongSaveResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SchemaMismatchError('library format outdated: invalid /api/songs save response');
  }
  return normalizeSong(unwrapSongSaveResponse(parsed.data));
}

export async function syncLibrary(): Promise<SyncLibraryResult> {
  if (!navigator.onLine) {
    throw new Error('You are offline. Connect to the internet and try again.');
  }
  const response = await fetch(toApiUrl('/api/admin/sync'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error('Admin access required to trigger a library sync.');
  }
  if (!response.ok) {
    throw new Error(`Library sync failed (${response.status})`);
  }
  if (response.status === 204) {
    return { synced: null, message: null };
  }
  const payload: unknown = await response.json();
  const parsed = SyncResponseSchema.safeParse(payload);
  if (!parsed.success || parsed.data === null) {
    return { synced: null, message: null };
  }
  return {
    synced: parsed.data.synced ?? null,
    message: parsed.data.message ?? null,
  };
}
