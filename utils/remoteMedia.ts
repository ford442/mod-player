import type { MediaItem } from '../types';
import { withBase } from '../src/lib/paths';

// Adjust this path to match where you drop your files on the FTP
const REMOTE_MEDIA_BASE_URL = withBase('media/');
const moduleFetchCache = new Map<string, Promise<Uint8Array>>();
const MAX_MODULE_CACHE_ENTRIES = 64;

// Parallel LRU cache for media availability probes (mirrors moduleFetchCache).
const mediaAvailabilityCache = new Map<string, Promise<boolean>>();
const MAX_MEDIA_CACHE_ENTRIES = 64;

const MEDIA_EXTENSIONS = ['jpg', 'png', 'gif', 'webp', 'mp4', 'webm'] as const;
const EXPLICIT_MEDIA_URL_RE = /\bhttps?:\/\/\S+\.(?:jpe?g|png|gif|webp|mp4|webm)\b/i;
const EXPLICIT_MEDIA_FILE_RE = /\b([^\s"'`<>]+\.(?:jpe?g|png|gif|webp|mp4|webm))\b/i;
const MEDIA_HINT_PREFIX_RE = /^(?:MEDIA|ART|VIDEO|VISUAL):\s*(\S+)/i;

function buildCandidateUrl(modFilename: string, candidate: string): string {
  if (/^https?:\/\//i.test(candidate)) {
    return candidate;
  }
  const normalized = candidate.replace(/^\.?\//, '');
  if (normalized.includes('/')) {
    return `${REMOTE_MEDIA_BASE_URL}${normalized}`;
  }
  const lastSlash = modFilename.lastIndexOf('/');
  const dir = lastSlash >= 0 ? modFilename.slice(0, lastSlash + 1) : '';
  return `${REMOTE_MEDIA_BASE_URL}${dir}${encodeURIComponent(normalized)}`;
}

/**
 * Derive candidate media URLs for a given module filename.
 *
 * Primary (deterministic): swap the module extension for each known media
 * extension, preserving subpath and URL-encoding unsafe characters.
 * Strict opt-in fallback: scan an optional comment for an explicit `MEDIA:`
 * token or a bare media URL. Anything else (homepages, sample names) is ignored.
 */
export function deriveMediaCandidates(modFilename: string, hintText?: string): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const push = (url: string) => {
    if (url && !seen.has(url)) {
      seen.add(url);
      candidates.push(url);
    }
  };

  if (modFilename) {
    const lastSlash = modFilename.lastIndexOf('/');
    const dir = lastSlash >= 0 ? modFilename.slice(0, lastSlash + 1) : '';
    const base = lastSlash >= 0 ? modFilename.slice(lastSlash + 1) : modFilename;
    const dot = base.lastIndexOf('.');
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const encodedStem = encodeURIComponent(stem);
    for (const ext of MEDIA_EXTENSIONS) {
      push(`${REMOTE_MEDIA_BASE_URL}${dir}${encodedStem}.${ext}`);
    }
  }

  if (hintText) {
    for (const line of hintText.split(/\r?\n/)) {
      const trimmed = line.trim();
      const mediaPrefix = trimmed.match(MEDIA_HINT_PREFIX_RE);
      if (mediaPrefix?.[1]) push(buildCandidateUrl(modFilename, mediaPrefix[1]));
      const fileMatch = trimmed.match(EXPLICIT_MEDIA_FILE_RE);
      if (fileMatch?.[1]) push(buildCandidateUrl(modFilename, fileMatch[1]));
    }
    const urlMatch = hintText.match(EXPLICIT_MEDIA_URL_RE);
    if (urlMatch?.[0]) push(urlMatch[0]);
  }

  return candidates;
}

/**
 * Probe whether a media URL is reachable. Caches the result (cache checked
 * before any network request). Uses a lightweight HEAD, falling back to an
 * aborted GET if HEAD is rejected. Never throws — a failed probe resolves false.
 */
export function checkMediaAvailability(url: string): Promise<boolean> {
  const cached = mediaAvailabilityCache.get(url);
  if (cached) return cached;

  if (mediaAvailabilityCache.size >= MAX_MEDIA_CACHE_ENTRIES) {
    const oldestKey = mediaAvailabilityCache.keys().next().value;
    if (oldestKey) mediaAvailabilityCache.delete(oldestKey);
  }

  const pending = (async (): Promise<boolean> => {
    try {
      const head = await fetch(url, { method: 'HEAD' });
      return head.ok;
    } catch {
      // HEAD may be rejected (CORS/method); fall back to a GET aborted at headers.
      try {
        const controller = new AbortController();
        const res = await fetch(url, { method: 'GET', signal: controller.signal });
        controller.abort();
        return res.ok;
      } catch {
        return false;
      }
    }
  })().catch(() => false);

  mediaAvailabilityCache.set(url, pending);
  return pending;
}

export function inferMediaKind(url: string): MediaItem['kind'] {
  const lower = url.toLowerCase();
  if (/\.(mp4|webm|mkv|mov)(?:[?#].*)?$/.test(lower)) return 'video';
  if (/\.gif(?:[?#].*)?$/.test(lower)) return 'gif';
  return 'image';
}

export function createRemoteMediaItem(url: string): MediaItem {
  const kind = inferMediaKind(url);
  return {
    id: `remote-media-${url}`,
    url,
    fileName: inferFileNameFromUrl(url),
    kind,
    mimeType: kind === 'video' ? 'video/mp4' : kind === 'gif' ? 'image/gif' : 'image/jpeg',
    muted: kind === 'video',
    loop: kind !== 'image',
    fit: 'contain',
    isObjectUrl: false,
  };
}

export const fetchRemoteMedia = async (): Promise<MediaItem[]> => {
  try {
    const response = await fetch(REMOTE_MEDIA_BASE_URL);
    if (!response.ok) throw new Error('Failed to access media folder');
    
    const text = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'text/html');
    
    const mediaItems: MediaItem[] = [];
    const mediaRegex = /\.(mp4|webm|mkv|mov|gif|png|jpg|jpeg)$/i;
    const videoRegex = /\.(mp4|webm|mkv|mov)$/i;
    const gifRegex = /\.gif$/i;

    const anchors = doc.querySelectorAll('a');
    for (const a of anchors) {
      const href = a.getAttribute('href');
      
      if (href && mediaRegex.test(href)) {
        // Handle Nginx/Apache differences where href might include the path
        const cleanName = href.split('/').pop() || href;
        const isVideo = videoRegex.test(cleanName);
        const isGif = gifRegex.test(cleanName);

        mediaItems.push({
          id: `remote-${cleanName}`,
          url: `${REMOTE_MEDIA_BASE_URL}${cleanName}`, // Construct full URL
          fileName: decodeURIComponent(cleanName),
          kind: isVideo ? 'video' : (isGif ? 'gif' : 'image'),
          mimeType: isVideo ? 'video/mp4' : 'image/jpeg', // Approximation
          muted: true,
          loop: isGif,
          fit: 'contain',
          isObjectUrl: false
        });
      }
    }

    return mediaItems;
  } catch (e) {
    console.error("Could not fetch remote media:", e);
    return [];
  }
};

export function inferFileNameFromUrl(downloadUrl: string): string {
  try {
    const parsed = new URL(downloadUrl, window.location.href);
    return decodeURIComponent(parsed.pathname.split('/').pop() || 'remote.mod');
  } catch {
    return decodeURIComponent(downloadUrl.split('?')[0]?.split('/').pop() || 'remote.mod');
  }
}

export async function fetchRemoteModule(downloadUrl: string): Promise<Uint8Array> {
  const cached = moduleFetchCache.get(downloadUrl);
  if (cached) {
    return cached;
  }

  if (moduleFetchCache.size >= MAX_MODULE_CACHE_ENTRIES) {
    const oldestKey = moduleFetchCache.keys().next().value;
    if (oldestKey) {
      moduleFetchCache.delete(oldestKey);
    }
  }

  const pending = fetch(downloadUrl).then(async response => {
    if (!response.ok) {
      throw new Error(`failed to download remote module (${response.status})`);
    }
    const data = await response.arrayBuffer();
    return new Uint8Array(data);
  }).catch(error => {
    moduleFetchCache.delete(downloadUrl);
    throw error;
  });

  moduleFetchCache.set(downloadUrl, pending);
  return pending;
}
