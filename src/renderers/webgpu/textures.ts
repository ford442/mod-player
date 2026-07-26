import { withBase } from '../../lib/paths';
import { resolveShaderMeta, usesVideoPatternTexture } from '../../../utils/shaderVersion';
import { preferredSampledImageFormat } from '../../../utils/webgpuDevice';
import type { GpuResourcePool } from '../../../utils/gpuResourcePool';
import type { BindGroupTextureResources } from './bindGroup';

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
  console.log('[WebGPU] Loading button texture:', textureUrl);
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
  if (source instanceof HTMLVideoElement && source.readyState >= 2) {
    sourceWidth = source.videoWidth;
    sourceHeight = source.videoHeight;
    sourceReady = true;
  } else if (source instanceof HTMLImageElement && source.complete) {
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

  try {
    if (state.videoTexture) {
      device.queue.copyExternalImageToTexture(
        { source, flipY: true },
        { texture: state.videoTexture },
        [sourceWidth, sourceHeight, 1],
      );
    }
  } catch {
    /* ignore */
  }
}
