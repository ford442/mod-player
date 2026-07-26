import { withBase } from '../src/lib/paths';

/** Default MP4 for video-pattern shaders (v0.23 Clouds, v0.24 Tunnel). */
export const DEFAULT_VIDEO_PATTERN_ASSET = 'clouds.mp4';

export function defaultVideoPatternUrl(): string {
  return withBase(DEFAULT_VIDEO_PATTERN_ASSET);
}
