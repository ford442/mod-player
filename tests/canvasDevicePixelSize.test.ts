/** #492 — pattern canvas backing store from devicePixelContentBoxSize, clamped by pixel size. */
import { describe, expect, it } from 'vitest';
import {
  clampCanvasPixels,
  containerBoxFromEntry,
  DEFAULT_MAX_TEXTURE_DIMENSION_2D,
  MAX_CANVAS_PIXELS,
  resolveCanvasBufferSize,
} from '../src/renderers/hooks/resolvePatternCanvasMetrics';

const size = (box: Parameters<typeof resolveCanvasBufferSize>[0]['box'], dpr: number, extra: Partial<Parameters<typeof resolveCanvasBufferSize>[0]> = {}) =>
  resolveCanvasBufferSize({ box, aspect: 1, devicePixelRatio: dpr, liteMode: false, ...extra });

describe('containerBoxFromEntry', () => {
  it('reads the device-pixel content box when the browser reports it', () => {
    const entry = {
      contentRect: { width: 800.5, height: 600.25 },
      devicePixelContentBoxSize: [{ inlineSize: 1001, blockSize: 750 }],
    } as unknown as ResizeObserverEntry;
    expect(containerBoxFromEntry(entry)).toEqual({ cssWidth: 800.5, cssHeight: 600.25, deviceWidth: 1001, deviceHeight: 750 });
  });

  it('falls back to contentRect and omits the device box when absent (Safari)', () => {
    const entry = { contentRect: { width: 640, height: 480 } } as unknown as ResizeObserverEntry;
    expect(containerBoxFromEntry(entry)).toEqual({ cssWidth: 640, cssHeight: 480 });
  });
});

describe('resolveCanvasBufferSize', () => {
  it('uses the exact device-pixel box when present (no DPR multiply, no rounding drift)', () => {
    // 1.25× zoom: css 801×601 → device 1001×751 (snapped by the browser).
    expect(size({ cssWidth: 801, cssHeight: 601, deviceWidth: 1001, deviceHeight: 751 }, 1.25)).toEqual({ width: 751, height: 751 });
    // The device box wins over a stale devicePixelRatio.
    expect(size({ cssWidth: 500, cssHeight: 400, deviceWidth: 1500, deviceHeight: 1200 }, 1)).toEqual({ width: 1200, height: 1200 });
    // Aspect fit on the wide axis.
    expect(resolveCanvasBufferSize({
      box: { cssWidth: 1000, cssHeight: 1000, deviceWidth: 2000, deviceHeight: 2000 },
      aspect: 16 / 10, devicePixelRatio: 2, liteMode: false,
    })).toEqual({ width: 2000, height: 1250 });
  });

  it('falls back to CSS box × devicePixelRatio, no longer clamped to 2', () => {
    expect(size({ cssWidth: 800, cssHeight: 600 }, 1)).toEqual({ width: 600, height: 600 });
    expect(size({ cssWidth: 800, cssHeight: 600 }, 2)).toEqual({ width: 1200, height: 1200 });
    expect(size({ cssWidth: 800, cssHeight: 600 }, 3)).toEqual({ width: 1800, height: 1800 });
    expect(size({ cssWidth: 800, cssHeight: 600 }, 0)).toEqual({ width: 600, height: 600 });
  });

  it('renders lite mode at CSS resolution even with a device box', () => {
    expect(size({ cssWidth: 400, cssHeight: 300, deviceWidth: 1200, deviceHeight: 900 }, 3, { liteMode: true }))
      .toEqual({ width: 300, height: 300 });
  });

  it('caps the pixel count at MAX_CANVAS_PIXELS, keeping the aspect', () => {
    // 8K panel at DPR 2: a 4320² square would be 18.7 MP.
    const big = size({ cssWidth: 3840, cssHeight: 2160, deviceWidth: 7680, deviceHeight: 4320 }, 2)!;
    expect(big.width * big.height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
    expect(big).toEqual({ width: 2880, height: 2880 });
    const wide = resolveCanvasBufferSize({
      box: { cssWidth: 4000, cssHeight: 2000, deviceWidth: 8000, deviceHeight: 4000 },
      aspect: 2, devicePixelRatio: 2, liteMode: false,
    })!;
    expect(wide.width * wide.height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
    expect(wide.width / wide.height).toBeCloseTo(2, 2);
    // What the old DPR≤2 clamp allowed on a 5K display (≈ 2800² ≈ 7.8 MP) still fits.
    expect(size({ cssWidth: 1400, cssHeight: 1400, deviceWidth: 2800, deviceHeight: 2800 }, 2)).toEqual({ width: 2800, height: 2800 });
  });

  it("caps each side at the device's maxTextureDimension2D (compatibility devices report 4096)", () => {
    const tall = resolveCanvasBufferSize({
      box: { cssWidth: 1000, cssHeight: 3000, deviceWidth: 2000, deviceHeight: 6000 },
      aspect: 1 / 3, devicePixelRatio: 2, liteMode: false, maxTextureDimension2D: 4096,
    })!;
    expect(Math.max(tall.width, tall.height)).toBeLessThanOrEqual(4096);
    expect(tall).toEqual({ width: 1365, height: 4096 });
    expect(DEFAULT_MAX_TEXTURE_DIMENSION_2D).toBe(8192);
    expect(resolveCanvasBufferSize({
      box: { cssWidth: 9000, cssHeight: 100 }, aspect: 90, devicePixelRatio: 1, liteMode: false, maxPixels: Infinity,
    })).toEqual({ width: 8192, height: 91 });
  });

  it('returns null while the container has no area', () => {
    expect(size({ cssWidth: 0, cssHeight: 600 }, 2)).toBeNull();
    expect(size({ cssWidth: 800, cssHeight: 0, deviceWidth: 1600, deviceHeight: 0 }, 2)).toBeNull();
  });
});

describe('clampCanvasPixels', () => {
  it('is the identity inside the limits and never returns 0', () => {
    expect(clampCanvasPixels(1024, 768, 8192, MAX_CANVAS_PIXELS)).toEqual({ width: 1024, height: 768 });
    expect(clampCanvasPixels(0, 0, 8192, MAX_CANVAS_PIXELS)).toEqual({ width: 1, height: 1 });
  });
});
