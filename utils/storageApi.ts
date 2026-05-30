import { z } from 'zod';

const storageBaseUrl = (import.meta.env.VITE_STORAGE_API_URL ?? '').trim().replace(/\/+$/, '');

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

function toApiUrl(path: string): string {
  if (!storageBaseUrl) return path;
  return `${storageBaseUrl}${path}`;
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

  const fileName = raw.fileName ?? raw.filename ?? decodeURIComponent(downloadUrl.split('/').pop() ?? 'remote.mod');
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

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`storage manager request failed (${response.status})`);
  }
  return response.json();
}

export async function fetchRemoteSongs(): Promise<RemoteSong[]> {
  const payload = await fetchJson(toApiUrl('/api/songs'));
  const parsed = SongListSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SchemaMismatchError('library format outdated: invalid /api/songs response');
  }
  const songs = Array.isArray(parsed.data)
    ? parsed.data
    : 'songs' in parsed.data
      ? parsed.data.songs
      : 'items' in parsed.data
        ? parsed.data.items
        : parsed.data.results;
  return songs.map(normalizeSong);
}

export async function fetchShaders(): Promise<ShaderMeta[]> {
  const payload = await fetchJson(toApiUrl('/api/shaders'));
  const parsed = ShaderListSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SchemaMismatchError('library format outdated: invalid /api/shaders response');
  }
  const shaders = Array.isArray(parsed.data)
    ? parsed.data
    : 'shaders' in parsed.data
      ? parsed.data.shaders
      : 'items' in parsed.data
        ? parsed.data.items
        : parsed.data.results;
  return shaders.map(normalizeShader);
}

export async function rateShader(id: string, score: number): Promise<void> {
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
}
