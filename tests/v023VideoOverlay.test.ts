/**
 * v0.23 Clouds — full-canvas video overlay regression (#350).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveShaderMeta } from '../utils/shaderRegistry';
import {
  DEFAULT_VIDEO_PATTERN_ASSET,
  defaultVideoPatternUrl,
} from '../utils/videoPatternSource';

describe('patternv0.23 video overlay', () => {
  it('registry uses video pattern texture', () => {
    const meta = resolveShaderMeta('patternv0.23.wgsl');
    expect(meta.patternTexture).toBe('video');
    expect(meta.background).toBe('chassis_video.wgsl');
  });

  it('default video asset resolves under app base', () => {
    expect(DEFAULT_VIDEO_PATTERN_ASSET).toBe('clouds.mp4');
    expect(defaultVideoPatternUrl()).toMatch(/clouds\.mp4$/);
  });

  it('shader samples full-canvas video with global scanlines (not centered charUV)', () => {
    const src = readFileSync(join(process.cwd(), 'shaders', 'patternv0.23.wgsl'), 'utf8');
    expect(src).toMatch(/fn videoCoverUv/);
    expect(src).toMatch(/globalScan/);
    expect(src).not.toMatch(/charUV/);
    expect(src).not.toMatch(/texScale/);
    expect(src).not.toMatch(/holoGrid/);
  });
});
