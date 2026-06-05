import type { MediaItem } from '../types';
import { withBase } from '../src/lib/paths';

// Adjust this path to match where you drop your files on the FTP
const REMOTE_MEDIA_BASE_URL = withBase('media/');
const moduleFetchCache = new Map<string, Promise<Uint8Array>>();
const MAX_MODULE_CACHE_ENTRIES = 64;

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
