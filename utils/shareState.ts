import { z } from 'zod';
import { ALL_SHADER_IDS } from '../appConfig';
import { detectRuntimeBase } from '../src/lib/paths';
import { toApiUrl } from './storageApi';
import {
  assertAllowedModuleUrl,
  isAllowedModuleHost,
  sanitizeRemoteUrl,
} from './remoteModuleSecurity';

export interface PlayerShareState {
  mod?: string;
  shader?: string;
  order?: number;
  row?: number;
  /** Per-instrument vs pitch-hue palette mode */
  palette?: 'instrument' | 'pitch';
  lite?: 0 | 1;
  media?: string;
  colorPalette?: number;
}

export interface ShareParseResult {
  state: PlayerShareState;
  warnings: string[];
  /** True when URL requests a remote module or short code */
  hasModuleIntent: boolean;
}

const ShareStateSchema = z.object({
  mod: z.string().url().optional(),
  shader: z.string().optional(),
  order: z.number().int().nonnegative().optional(),
  row: z.number().int().nonnegative().optional(),
  palette: z.enum(['instrument', 'pitch']).optional(),
  lite: z.union([z.literal(0), z.literal(1)]).optional(),
  media: z.string().url().optional(),
  colorPalette: z.number().int().min(0).max(5).optional(),
});

const ShareCodeResponseSchema = z.union([
  ShareStateSchema,
  z.object({ state: ShareStateSchema }),
  z.object({ payload: ShareStateSchema }),
]);

function normalizeShaderId(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  return trimmed.endsWith('.wgsl') ? trimmed : `${trimmed}.wgsl`;
}

function parsePalette(raw: string | null): 'instrument' | 'pitch' | undefined {
  if (!raw) return undefined;
  const lower = raw.trim().toLowerCase();
  if (lower === 'instrument' || lower === 'inst' || lower === '1') return 'instrument';
  if (lower === 'pitch' || lower === 'hue' || lower === '0') return 'pitch';
  return undefined;
}

function parseLite(raw: string | null): 0 | 1 | undefined {
  if (raw === '0') return 0;
  if (raw === '1') return 1;
  return undefined;
}

function parseNonNegativeInt(raw: string | null, label: string, warnings: string[]): number | undefined {
  if (raw === null || raw === '') return undefined;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 0) {
    warnings.push(`Invalid ${label} "${raw}" — ignored`);
    return undefined;
  }
  return value;
}

/** Parse share params from a query string (defaults to current location). */
export function parseShareParams(search?: string): ShareParseResult {
  const params = new URLSearchParams(search ?? window.location.search);
  const warnings: string[] = [];
  const state: PlayerShareState = {};

  const code = params.get('code')?.trim();
  const mod = params.get('mod')?.trim();
  const hasModuleIntent = Boolean(code || mod);

  if (mod) {
    const sanitized = sanitizeRemoteUrl(mod);
    if (!sanitized) {
      warnings.push('Module URL is invalid — using default module');
    } else if (!isAllowedModuleHost(sanitized)) {
      warnings.push('Module host is not allowed — using default module');
    } else {
      state.mod = sanitized;
    }
  }

  const shaderRaw = params.get('shader');
  if (shaderRaw) {
    const shader = normalizeShaderId(shaderRaw);
    if (ALL_SHADER_IDS.has(shader)) {
      state.shader = shader;
    } else {
      warnings.push(`Unknown shader "${shaderRaw}" — using your saved shader`);
    }
  }

  const order = parseNonNegativeInt(params.get('order'), 'order', warnings);
  if (order !== undefined) state.order = order;

  const row = parseNonNegativeInt(params.get('row'), 'row', warnings);
  if (row !== undefined) state.row = row;

  const palette = parsePalette(params.get('palette'));
  if (palette) {
    state.palette = palette;
  } else if (params.get('palette')) {
    warnings.push(`Unknown palette "${params.get('palette')}" — ignored`);
  }

  const lite = parseLite(params.get('lite'));
  if (lite !== undefined) state.lite = lite;

  const colorPalette = parseNonNegativeInt(params.get('colorPalette'), 'colorPalette', warnings);
  if (colorPalette !== undefined && colorPalette <= 5) {
    state.colorPalette = colorPalette;
  } else if (params.get('colorPalette')) {
    warnings.push(`Invalid color palette "${params.get('colorPalette')}" — ignored`);
  }

  const mediaRaw = params.get('media');
  if (mediaRaw) {
    const media = sanitizeRemoteUrl(mediaRaw);
    if (!media) {
      warnings.push('Media URL is invalid — overlay skipped');
    } else if (!isAllowedModuleHost(media) && !isSameOriginMedia(media)) {
      warnings.push('Media host is not allowed — overlay skipped');
    } else {
      state.media = media;
    }
  }

  if (code) {
    // Short code resolved asynchronously — no mod URL yet
    return { state, warnings, hasModuleIntent: true };
  }

  return { state, warnings, hasModuleIntent };
}

function isSameOriginMedia(url: string): boolean {
  try {
    return new URL(url, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

export function hasShareModuleIntent(search?: string): boolean {
  const params = new URLSearchParams(search ?? window.location.search);
  return Boolean(params.get('mod')?.trim() || params.get('code')?.trim());
}

export function buildShareSearchParams(state: PlayerShareState & { code?: string }): URLSearchParams {
  const params = new URLSearchParams();
  if (state.code) {
    params.set('code', state.code);
    return params;
  }
  if (state.mod) params.set('mod', state.mod);
  if (state.shader) params.set('shader', state.shader);
  if (state.order !== undefined) params.set('order', String(state.order));
  if (state.row !== undefined) params.set('row', String(state.row));
  if (state.palette) params.set('palette', state.palette);
  if (state.lite !== undefined) params.set('lite', String(state.lite));
  if (state.media) params.set('media', state.media);
  if (state.colorPalette !== undefined) params.set('colorPalette', String(state.colorPalette));
  return params;
}

export function buildShareUrl(state: PlayerShareState & { code?: string }, origin = window.location.origin): string {
  const base = detectRuntimeBase();
  const path = base.endsWith('/') ? base : `${base}/`;
  const params = buildShareSearchParams(state);
  const query = params.toString();
  return `${origin}${path}${query ? `?${query}` : ''}`;
}

export function paletteModeFromShare(palette: PlayerShareState['palette']): number | undefined {
  if (palette === 'instrument') return 1;
  if (palette === 'pitch') return 0;
  return undefined;
}

export function sharePaletteFromMode(mode: number): 'instrument' | 'pitch' {
  return mode === 1 ? 'instrument' : 'pitch';
}

export function computeSeekStep(order: number, row: number, rowsPerPattern: number): number {
  return Math.max(0, order * rowsPerPattern + row);
}

/** Fetch a short code payload from the storage API. */
export async function resolveShareCode(code: string): Promise<PlayerShareState | null> {
  const trimmed = code.trim();
  if (!trimmed || !/^[a-zA-Z0-9_-]{4,64}$/.test(trimmed)) return null;

  try {
    const response = await fetch(toApiUrl(`/api/share/${encodeURIComponent(trimmed)}`), {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    const parsed = ShareCodeResponseSchema.safeParse(payload);
    if (!parsed.success) return null;
    const raw = parsed.data as Record<string, unknown>;
    const inner = ('state' in raw && raw.state)
      ? raw.state
      : ('payload' in raw && raw.payload)
        ? raw.payload
        : parsed.data;
    const normalized = ShareStateSchema.parse(inner);
    const result: PlayerShareState = {};
    if (normalized.mod !== undefined) result.mod = normalized.mod;
    if (normalized.shader !== undefined) result.shader = normalized.shader;
    if (normalized.order !== undefined) result.order = normalized.order;
    if (normalized.row !== undefined) result.row = normalized.row;
    if (normalized.palette !== undefined) result.palette = normalized.palette;
    if (normalized.lite !== undefined) result.lite = normalized.lite;
    if (normalized.media !== undefined) result.media = normalized.media;
    if (normalized.colorPalette !== undefined) result.colorPalette = normalized.colorPalette;
    return result;
  } catch {
    return null;
  }
}

/** Persist share state and return a short code (null when API unavailable). */
export async function createShareCode(state: PlayerShareState): Promise<string | null> {
  try {
    const response = await fetch(toApiUrl('/api/share'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(state),
    });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    const codeSchema = z.object({
      code: z.string().min(4).max(64),
    });
    const parsed = codeSchema.safeParse(payload);
    return parsed.success ? parsed.data.code : null;
  } catch {
    return null;
  }
}

export async function fetchShareModule(modUrl: string): Promise<Uint8Array> {
  const safeUrl = assertAllowedModuleUrl(modUrl);
  const response = await fetch(safeUrl);
  if (!response.ok) {
    throw new Error(`Failed to download module (${response.status})`);
  }
  return new Uint8Array(await response.arrayBuffer());
}
