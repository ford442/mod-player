import { withBase } from '../src/lib/paths';
import type { MediaItem } from '../types';

/** Default MP4 for video-pattern shaders (v0.23 Clouds, v0.24 Tunnel). */
export const DEFAULT_VIDEO_PATTERN_ASSET = 'clouds.mp4';

export function defaultVideoPatternUrl(): string {
  return withBase(DEFAULT_VIDEO_PATTERN_ASSET);
}

/** The dev surface's "remote media" picker list (TransportBar, 3D view): the bundled demo clip. */
export const DEMO_REMOTE_MEDIA_LIST: MediaItem[] = [
  { id: '1', kind: 'video', url: DEFAULT_VIDEO_PATTERN_ASSET, fileName: 'Clouds Demo (MP4)', mimeType: 'video/mp4' },
];
