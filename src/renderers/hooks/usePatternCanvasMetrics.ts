import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  containerBoxFromEntry,
  resolveCanvasBufferSize,
  resolvePatternCanvasMetrics,
  type ContainerBox,
} from './resolvePatternCanvasMetrics';

export interface UsePatternCanvasMetricsParams {
  containerRef: React.RefObject<HTMLDivElement>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  glCanvasRef: React.RefObject<HTMLCanvasElement>;
  shaderFile: string;
  numChannels: number;
  cellWidth: number;
  liteMode: boolean;
  /** Read for `limits.maxTextureDimension2D` (the canvas size cap). */
  gpuDeviceRef: React.MutableRefObject<GPUDevice | null>;
}

/** Resize bursts (window drag) settle for this long before the canvas is resized once. */
const RESIZE_SETTLE_MS = 100;

/**
 * Call `onChange` whenever `window.devicePixelRatio` changes. A
 * `(resolution: Ndppx)` media query only matches the current ratio, so the
 * listener re-arms itself on the new value after each change. Fallback for
 * browsers without ResizeObserver `device-pixel-content-box`.
 */
export function watchDevicePixelRatio(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  let query: MediaQueryList | null = null;
  const handler = () => {
    arm();
    onChange();
  };
  const arm = () => {
    query?.removeEventListener('change', handler);
    query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener('change', handler);
  };
  arm();
  return () => {
    query?.removeEventListener('change', handler);
    query = null;
  };
}

/**
 * Sizes the pattern canvas backing store (#492). One trigger: a ResizeObserver
 * on the container's `device-pixel-content-box`, which fires for layout
 * resizes *and* DPR-only changes (zoom, another monitor). Browsers without that
 * box fall back to `content-box` + a DPR watch. Resizing never reconfigures the
 * WebGPU context — the next `getCurrentTexture()` follows the new size, and the
 * frame loop resizes the bloom targets to match.
 */
export function usePatternCanvasMetrics(params: UsePatternCanvasMetricsParams) {
  const {
    containerRef,
    canvasRef,
    glCanvasRef,
    shaderFile,
    numChannels,
    cellWidth,
    liteMode,
    gpuDeviceRef,
  } = params;

  /** Latest ResizeObserver measurement; null until the first callback. */
  const containerBoxRef = useRef<ContainerBox | null>(null);
  const resizeTimeoutRef = useRef<number | null>(null);

  const { width: metricsWidth, height: metricsHeight } =
    resolvePatternCanvasMetrics(shaderFile, numChannels, cellWidth, liteMode);
  // Keyed on the numbers, not the inputs: a shader switch or a module with a
  // different channel count keeps the same object (and so the same
  // `syncCanvasSize`) whenever the size itself is unchanged.
  const canvasMetrics = useMemo(
    () => ({ width: metricsWidth, height: metricsHeight }),
    [metricsWidth, metricsHeight],
  );

  const syncCanvasSize = useCallback((canvas: HTMLCanvasElement, glCanvas: HTMLCanvasElement | null) => {
    let box = containerBoxRef.current;
    if (!box) {
      // Before the observer's first callback (which lands before anything is
      // drawn and replaces this estimate): the container's layout box.
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      box = { cssWidth: rect.width, cssHeight: rect.height };
    }
    const size = resolveCanvasBufferSize({
      box,
      aspect: canvasMetrics.width / canvasMetrics.height,
      devicePixelRatio: window.devicePixelRatio || 1,
      liteMode,
      maxTextureDimension2D: gpuDeviceRef.current?.limits.maxTextureDimension2D,
    });
    if (!size) return;
    for (const target of [canvas, glCanvas]) {
      if (target && (target.width !== size.width || target.height !== size.height)) {
        target.width = size.width;
        target.height = size.height;
      }
    }
  }, [canvasMetrics, liteMode, containerRef, gpuDeviceRef]);

  /** Re-size after the burst settles (also the renderer registry's `resize()`). */
  const handleResize = useCallback(() => {
    if (resizeTimeoutRef.current !== null) window.clearTimeout(resizeTimeoutRef.current);
    resizeTimeoutRef.current = window.setTimeout(() => {
      resizeTimeoutRef.current = null;
      const canvas = canvasRef.current;
      if (canvas) syncCanvasSize(canvas, glCanvasRef.current);
    }, RESIZE_SETTLE_MS);
  }, [syncCanvasSize, canvasRef, glCanvasRef]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    syncCanvasSize(canvas, glCanvasRef.current);
  }, [syncCanvasSize, canvasRef, glCanvasRef]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      const first = containerBoxRef.current === null;
      containerBoxRef.current = containerBoxFromEntry(entry);
      const canvas = canvasRef.current;
      // The initial observation lands before anything is drawn: apply it now.
      if (first && canvas) syncCanvasSize(canvas, glCanvasRef.current);
      else handleResize();
    });
    let stopDprWatch = () => {};
    try {
      resizeObserver.observe(container, { box: 'device-pixel-content-box' });
    } catch {
      // No device-pixel-content-box: content-box misses DPR-only changes.
      resizeObserver.observe(container);
      stopDprWatch = watchDevicePixelRatio(handleResize);
    }
    return () => {
      resizeObserver.disconnect();
      stopDprWatch();
      if (resizeTimeoutRef.current !== null) window.clearTimeout(resizeTimeoutRef.current);
    };
  }, [handleResize, syncCanvasSize, containerRef, canvasRef, glCanvasRef]);

  return {
    canvasMetrics,
    syncCanvasSize,
    handleResize,
  };
}
