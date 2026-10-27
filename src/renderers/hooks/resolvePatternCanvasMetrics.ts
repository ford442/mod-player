import { getShaderMeta } from '../../../utils/shaderRegistry';
import {
  getShaderCanvasSize,
  isHorizontalLayoutShader,
} from '../../../utils/shaderVersion';

export interface PatternCanvasMetrics {
  width: number;
  height: number;
}

export function resolvePatternCanvasMetrics(
  shaderFile: string,
  numChannels: number,
  cellWidth: number,
  liteMode: boolean,
): PatternCanvasMetrics {
  if (liteMode) return { width: 512, height: 512 };
  if (getShaderMeta(shaderFile)) {
    return getShaderCanvasSize(shaderFile);
  }
  const isHorizontal = isHorizontalLayoutShader(shaderFile);
  if (isHorizontal) return { width: 1024, height: 1024 };
  return { width: Math.max(800, numChannels * cellWidth), height: 600 };
}

/**
 * Largest canvas backing store, in pixels: one 4K UHD frame (3840×2160 ≈ 8.3 MP).
 *
 * Bloom keeps a full-size rgba16float scene target (8 B/px) and, layered, nine
 * half-size rgba16float targets (≈ 18 B/px of canvas) beside the swapchain —
 * ≈ 300 MB of render targets at this cap. It still fits the largest canvas the
 * old `min(devicePixelRatio, 2)` clamp produced on common hardware (DPR 2 on a
 * 5K display: ≈ 7.8 MP for the square canvas) and a native 4K canvas; a 6K/8K
 * panel is scaled down uniformly instead of allocating 2–4× that (#492).
 */
export const MAX_CANVAS_PIXELS = 3840 * 2160;

/** WebGPU's default `maxTextureDimension2D` (core). Compatibility devices default to 4096. */
export const DEFAULT_MAX_TEXTURE_DIMENSION_2D = 8192;

/** A container measurement: CSS content box, plus the exact device-pixel box when the browser reports one. */
export interface ContainerBox {
  cssWidth: number;
  cssHeight: number;
  /** From `ResizeObserverEntry.devicePixelContentBoxSize`; absent without `device-pixel-content-box` support. */
  deviceWidth?: number;
  deviceHeight?: number;
}

export function containerBoxFromEntry(entry: ResizeObserverEntry): ContainerBox {
  // Typed as always present, but missing in browsers without the box option (Safari).
  const device = (entry.devicePixelContentBoxSize as readonly ResizeObserverSize[] | undefined)?.[0];
  return {
    cssWidth: entry.contentRect.width,
    cssHeight: entry.contentRect.height,
    ...(device ? { deviceWidth: device.inlineSize, deviceHeight: device.blockSize } : {}),
  };
}

/** Scale (uniformly) so neither side exceeds `maxDimension` and the area stays ≤ `maxPixels`. */
export function clampCanvasPixels(
  width: number,
  height: number,
  maxDimension: number,
  maxPixels: number,
): PatternCanvasMetrics {
  const scale = Math.min(1, maxDimension / width, maxDimension / height, Math.sqrt(maxPixels / (width * height)));
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

/**
 * Backing-store size for the pattern canvas: the shader's aspect fitted into
 * the container, in device pixels.
 *
 * - With `devicePixelContentBoxSize` the fit is done on the exact device-pixel
 *   box, so the canvas maps 1:1 onto physical pixels at any zoom / DPR.
 * - Without it, CSS box × `devicePixelRatio` (no longer clamped to 2 — the
 *   clamp now applies to the resulting size instead).
 * - Lite mode renders at CSS resolution (power budget), as before.
 *
 * The result is capped by the device's `maxTextureDimension2D` and by
 * `MAX_CANVAS_PIXELS`. Returns null while the container has no area.
 */
export function resolveCanvasBufferSize({
  box,
  aspect,
  devicePixelRatio,
  liteMode,
  maxTextureDimension2D = DEFAULT_MAX_TEXTURE_DIMENSION_2D,
  maxPixels = MAX_CANVAS_PIXELS,
}: {
  box: ContainerBox;
  /** canvasMetrics.width / canvasMetrics.height */
  aspect: number;
  devicePixelRatio: number;
  liteMode: boolean;
  maxTextureDimension2D?: number | undefined;
  maxPixels?: number;
}): PatternCanvasMetrics | null {
  if (!(box.cssWidth > 0 && box.cssHeight > 0 && aspect > 0)) return null;
  const device = !liteMode && box.deviceWidth && box.deviceHeight;
  const scale = device || liteMode || !(devicePixelRatio > 0) ? 1 : devicePixelRatio;
  const width = (device ? box.deviceWidth! : box.cssWidth) * scale;
  const height = (device ? box.deviceHeight! : box.cssHeight) * scale;
  // Fit the aspect inside the box, whole pixels.
  return width / height > aspect
    ? clampCanvasPixels(Math.floor(height * aspect), Math.floor(height), maxTextureDimension2D, maxPixels)
    : clampCanvasPixels(Math.floor(width), Math.floor(width / aspect), maxTextureDimension2D, maxPixels);
}
