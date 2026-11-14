/**
 * The video-pattern texture copies its source only when the pixels can have
 * changed: an image once per (texture, URL), a video once per presented frame
 * (requestVideoFrameCallback) or per moved currentTime while paused — never
 * every frame (a 1080p copy at 60 fps is ~500 MB/s of upload bandwidth).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.GPUTextureUsage ??= { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 };
});

class FakeImage {
  complete = true;
  naturalWidth = 64;
  naturalHeight = 32;
  src = 'https://example.test/a.png';
  currentSrc = '';
}

class FakeVideo {
  readyState = 4;
  videoWidth = 64;
  videoHeight = 32;
  src = 'https://example.test/a.mp4';
  currentSrc = '';
  currentTime = 0;
  paused = false;
  seeking = false;
  frameCallbacks: Array<() => void> = [];
  requestVideoFrameCallback?: (cb: () => void) => number = (cb) => {
    this.frameCallbacks.push(cb);
    return this.frameCallbacks.length;
  };
  /** Present a frame: fire every outstanding callback. */
  present(): void {
    const cbs = this.frameCallbacks;
    this.frameCallbacks = [];
    for (const cb of cbs) cb();
  }
}

import { updateVideoTexture, type VideoTextureState } from '../../src/renderers/webgpu/textures';
import type { GpuResourcePool } from '../../utils/gpuResourcePool';

const SHADER = 'patternv0.23.wgsl';

function makeHarness() {
  const uploads: unknown[] = [];
  let created = 0;
  const device = {
    features: new Set<string>(),
    queue: {
      copyExternalImageToTexture: (src: { source: unknown }) => { uploads.push(src.source); },
    },
    createTexture: (desc: { size: number[] }) => {
      created += 1;
      return { width: desc.size[0], height: desc.size[1], createView: () => ({}) };
    },
    createSampler: () => ({}),
  } as unknown as GPUDevice;
  const pool = {
    track: <T>(r: T) => r,
    destroyTracked: () => {},
  } as unknown as GpuResourcePool;
  const state: VideoTextureState = { videoTexture: null, textureResources: null };
  const frame = (source: FakeImage | FakeVideo) =>
    updateVideoTexture(device, pool, SHADER, source as unknown as HTMLVideoElement, state, () => {});
  return { uploads, frame, state, created: () => created };
}

describe('updateVideoTexture upload gating', () => {
  beforeEach(() => {
    vi.stubGlobal('HTMLImageElement', FakeImage);
    vi.stubGlobal('HTMLVideoElement', FakeVideo);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uploads a static image once, not every frame', () => {
    const h = makeHarness();
    const img = new FakeImage();
    for (let i = 0; i < 120; i++) h.frame(img);
    expect(h.uploads).toHaveLength(1);
  });

  it('re-uploads an image when its URL changes at the same size', () => {
    const h = makeHarness();
    const img = new FakeImage();
    h.frame(img);
    h.frame(img);
    img.src = 'https://example.test/b.png';
    h.frame(img);
    h.frame(img);
    expect(h.uploads).toHaveLength(2);
  });

  it('re-uploads when a different element (or a resize) replaces the source', () => {
    const h = makeHarness();
    h.frame(new FakeImage());
    h.frame(new FakeImage());
    const big = new FakeImage();
    big.naturalWidth = 128;
    h.frame(big);
    h.frame(big);
    expect(h.uploads).toHaveLength(3);
    expect(h.created()).toBe(2);
  });

  it('uploads a playing video once per presented frame (requestVideoFrameCallback)', () => {
    const h = makeHarness();
    const video = new FakeVideo();
    h.frame(video); // first frame: fills the new texture
    for (let i = 0; i < 10; i++) {
      video.currentTime += 1 / 60;
      h.frame(video); // render ticks without a new video frame
    }
    expect(h.uploads).toHaveLength(1);
    video.present();
    h.frame(video);
    h.frame(video);
    expect(h.uploads).toHaveLength(2);
    // Only one callback outstanding at a time, however many render ticks ran.
    expect(video.frameCallbacks).toHaveLength(1);
  });

  it('does not upload a paused video until it seeks', () => {
    const h = makeHarness();
    const video = new FakeVideo();
    video.paused = true;
    for (let i = 0; i < 30; i++) h.frame(video);
    expect(h.uploads).toHaveLength(1);
    video.currentTime = 2;
    video.seeking = true;
    h.frame(video);
    expect(h.uploads).toHaveLength(1); // still showing the old frame
    video.seeking = false;
    h.frame(video);
    h.frame(video);
    expect(h.uploads).toHaveLength(2);
  });

  it('without requestVideoFrameCallback: uploads while playing, not while paused', () => {
    const h = makeHarness();
    const video = new FakeVideo();
    video.requestVideoFrameCallback = undefined;
    for (let i = 0; i < 5; i++) h.frame(video);
    expect(h.uploads).toHaveLength(5);
    video.paused = true;
    for (let i = 0; i < 5; i++) h.frame(video);
    expect(h.uploads).toHaveLength(5);
    video.currentTime = 3;
    h.frame(video);
    expect(h.uploads).toHaveLength(6);
  });

  it('re-uploads a video whose src changed', () => {
    const h = makeHarness();
    const video = new FakeVideo();
    video.paused = true;
    h.frame(video);
    video.src = 'https://example.test/b.mp4';
    h.frame(video);
    expect(h.uploads).toHaveLength(2);
  });
});
