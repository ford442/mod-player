import { withBase } from '../../lib/paths';
import { resolveShaderMeta, usesVideoPatternTexture } from '../../../utils/shaderVersion';
import { preferredSampledImageFormat } from '../../../utils/webgpuDevice';
import type { GpuResourcePool } from '../../../utils/gpuResourcePool';
import type { BindGroupTextureResources } from './bindGroup';
import { createLogger } from '../../../utils/log';

const log = createLogger('WebGPU');

export async function loadBezelTexture(
  device: GPUDevice,
  pool: GpuResourcePool | null,
  shaderFile: string,
): Promise<BindGroupTextureResources> {
  const textureName =
    resolveShaderMeta(shaderFile).bezelTexture === 'square'
      ? './bezel-square.png'
      : './bezel.png';
  let bitmap: ImageBitmap;
  try {
    const img = new Image();
    img.src = textureName;
    await img.decode();
    bitmap = await createImageBitmap(img);
  } catch (e) {
    console.warn(`Failed to load ${textureName}, using fallback.`, e);
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = 'rgba(0,0,0,0)';
      ctx.fillRect(0, 0, 1, 1);
    }
    bitmap = await createImageBitmap(canvas);
  }
  const format = preferredSampledImageFormat(device);
  const texture = pool?.track(
    device.createTexture({
      size: [bitmap.width, bitmap.height, 1],
      format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    }),
    'shader',
  ) ?? device.createTexture({
    size: [bitmap.width, bitmap.height, 1],
    format,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture({ source: bitmap, flipY: true }, { texture }, [bitmap.width, bitmap.height, 1]);
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  return { sampler, view: texture.createView() };
}

export async function ensureButtonTexture(
  device: GPUDevice,
  pool: GpuResourcePool | null,
  shaderFile: string,
): Promise<BindGroupTextureResources> {
  const textureUrl =
    resolveShaderMeta(shaderFile).patternTexture === 'button-v30'
      ? withBase('unlit-button-2.png')
      : withBase('unlit-button.png');
  if (import.meta.env.DEV) {
    log.log('Loading button texture:', textureUrl);
  }
  let bitmap: ImageBitmap;
  try {
    const img = new Image();
    img.src = textureUrl;
    img.crossOrigin = 'anonymous';
    await img.decode();
    bitmap = await createImageBitmap(img);
  } catch (e) {
    console.warn(`Failed to load button texture (${textureUrl}), using fallback.`, e);
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#222';
      ctx.fillRect(0, 0, 128, 128);
      ctx.strokeStyle = '#444';
      ctx.strokeRect(10, 10, 108, 108);
    }
    bitmap = await createImageBitmap(canvas);
  }
  const format = preferredSampledImageFormat(device);
  const texture = pool?.track(
    device.createTexture({
      size: [bitmap.width, bitmap.height, 1],
      format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    }),
    'shader',
  ) ?? device.createTexture({
    size: [bitmap.width, bitmap.height, 1],
    format,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture({ source: bitmap, flipY: true }, { texture }, [bitmap.width, bitmap.height, 1]);
  const sampler = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' });
  return { sampler, view: texture.createView() };
}

export function ensureVideoPlaceholder(
  device: GPUDevice,
  pool: GpuResourcePool | null,
): { texture: GPUTexture; resources: BindGroupTextureResources } {
  const fmt = preferredSampledImageFormat(device);
  const texture = pool?.track(
    device.createTexture({
      size: [1, 1, 1],
      format: fmt,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    }),
    'shader',
  ) ?? device.createTexture({
    size: [1, 1, 1],
    format: fmt,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  if (fmt === 'rgba32float') {
    device.queue.writeTexture(
      { texture },
      new Float32Array([100 / 255, 100 / 255, 100 / 255, 1.0]),
      { bytesPerRow: 16 },
      { width: 1, height: 1 },
    );
  } else {
    device.queue.writeTexture(
      { texture },
      new Uint8Array([100, 100, 100, 255]),
      { bytesPerRow: 4 },
      { width: 1, height: 1 },
    );
  }
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  return { texture, resources: { sampler, view: texture.createView() } };
}

export interface VideoTextureState {
  videoTexture: GPUTexture | null;
  textureResources: BindGroupTextureResources | null;
}

/**
 * What was last copied into a pattern texture. Keyed by the GPUTexture, so a
 * recreated texture (resize, shader re-init) starts with no record and is
 * filled on its first frame.
 */
interface UploadRecord {
  source: HTMLVideoElement | HTMLImageElement;
  /** Image: the URL it showed. Video: the URL it was playing. */
  src: string;
  /** Video only: `currentTime` at the upload (catches seeks while paused). */
  time: number;
}

const lastUpload = new WeakMap<GPUTexture, UploadRecord>();

/**
 * Per-video `requestVideoFrameCallback` bookkeeping: at most one callback is
 * outstanding per element (re-armed from the render loop), and `fresh` says a
 * frame was presented since the last upload.
 */
interface VideoFrameWatch {
  pending: boolean;
  fresh: boolean;
}

const videoFrameWatches = new WeakMap<HTMLVideoElement, VideoFrameWatch>();

type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
};

function isVideoSource(source: HTMLVideoElement | HTMLImageElement): source is HTMLVideoElement {
  return typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement;
}

function isImageSource(source: HTMLVideoElement | HTMLImageElement): source is HTMLImageElement {
  return typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement;
}

function mediaSrc(source: HTMLVideoElement | HTMLImageElement): string {
  return source.currentSrc || source.src || '';
}

/**
 * Arms one `requestVideoFrameCallback` for `video` (if supported and none is
 * outstanding) and reports whether a frame was presented since the last call
 * that consumed it. Returns `null` when the browser has no rVFC.
 */
function consumeVideoFrame(video: HTMLVideoElement): boolean | null {
  const rvfc = (video as FrameCallbackVideo).requestVideoFrameCallback;
  if (typeof rvfc !== 'function') return null;
  let watch = videoFrameWatches.get(video);
  if (!watch) {
    watch = { pending: false, fresh: false };
    videoFrameWatches.set(video, watch);
  }
  const fresh = watch.fresh;
  watch.fresh = false;
  if (!watch.pending) {
    watch.pending = true;
    const w = watch;
    rvfc.call(video, () => {
      w.pending = false;
      w.fresh = true;
    });
  }
  return fresh;
}

/**
 * Whether `source` must be copied into `texture` this frame. Images upload
 * once per (texture, element, URL); videos upload when a new frame was
 * presented (`requestVideoFrameCallback`), or — without rVFC — while playing,
 * plus whenever `currentTime` moved (a seek or loop while paused).
 */
export function needsTextureUpload(
  texture: GPUTexture,
  source: HTMLVideoElement | HTMLImageElement,
): boolean {
  const prev = lastUpload.get(texture);
  const src = mediaSrc(source);
  const sameSource = prev !== undefined && prev.source === source && prev.src === src;
  if (!isVideoSource(source)) return !sameSource;

  // Always arm / drain the frame callback so `fresh` reflects frames since the last check.
  const freshFrame = consumeVideoFrame(source);
  if (!sameSource) return true;
  // Mid-seek the element still shows the old frame; the moved currentTime uploads it once settled.
  if (source.seeking) return false;
  if (source.currentTime !== prev.time && (source.paused || freshFrame === null)) return true;
  if (freshFrame === null) return !source.paused;
  return freshFrame;
}

function recordUpload(texture: GPUTexture, source: HTMLVideoElement | HTMLImageElement): void {
  lastUpload.set(texture, {
    source,
    src: mediaSrc(source),
    time: isVideoSource(source) ? source.currentTime : 0,
  });
}

export function updateVideoTexture(
  device: GPUDevice,
  pool: GpuResourcePool,
  shaderFile: string,
  source: HTMLVideoElement | HTMLImageElement | null,
  state: VideoTextureState,
  onResourcesChanged: () => void,
): void {
  if (!usesVideoPatternTexture(shaderFile) || !source) return;

  let sourceWidth = 0;
  let sourceHeight = 0;
  let sourceReady = false;
  if (isVideoSource(source) && source.readyState >= 2) {
    sourceWidth = source.videoWidth;
    sourceHeight = source.videoHeight;
    sourceReady = true;
  } else if (isImageSource(source) && source.complete) {
    sourceWidth = source.naturalWidth;
    sourceHeight = source.naturalHeight;
    sourceReady = true;
  }

  if (!sourceReady || sourceWidth <= 0 || sourceHeight <= 0) return;

  const format = preferredSampledImageFormat(device);
  if (!state.videoTexture || state.videoTexture.width !== sourceWidth || state.videoTexture.height !== sourceHeight) {
    if (state.videoTexture) {
      pool.destroyTracked(state.videoTexture);
    }
    state.videoTexture = pool.track(
      device.createTexture({
        size: [sourceWidth, sourceHeight, 1],
        format,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      }),
      'shader',
    );
    state.textureResources = {
      sampler: device.createSampler({ magFilter: 'linear', minFilter: 'linear' }),
      view: state.videoTexture.createView(),
    };
    onResourcesChanged();
  }

  const texture = state.videoTexture;
  if (!texture || !needsTextureUpload(texture, source)) return;
  try {
    device.queue.copyExternalImageToTexture(
      { source, flipY: true },
      { texture },
      [sourceWidth, sourceHeight, 1],
    );
    recordUpload(texture, source);
  } catch {
    /* ignore — retried next frame (no upload recorded) */
  }
}
