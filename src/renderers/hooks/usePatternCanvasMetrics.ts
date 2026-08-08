import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { BloomPostProcessor } from '../../../utils/bloomPostProcessor';
import { configureCanvasContext } from '../../../utils/webgpuDevice';
import {
  resolvePatternCanvasMetrics,
  resolvePatternDevicePixelRatio,
} from './resolvePatternCanvasMetrics';

export interface UsePatternCanvasMetricsParams {
  containerRef: React.RefObject<HTMLDivElement>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  glCanvasRef: React.RefObject<HTMLCanvasElement>;
  shaderFile: string;
  numChannels: number;
  cellWidth: number;
  liteMode: boolean;
  bloomRef: React.MutableRefObject<BloomPostProcessor | null>;
  gpuDeviceRef: React.MutableRefObject<GPUDevice | null>;
  gpuContextRef: React.MutableRefObject<GPUCanvasContext | null>;
}

export function usePatternCanvasMetrics(params: UsePatternCanvasMetricsParams) {
  const {
    containerRef,
    canvasRef,
    glCanvasRef,
    shaderFile,
    numChannels,
    cellWidth,
    liteMode,
    bloomRef,
    gpuDeviceRef,
    gpuContextRef,
  } = params;

  const canvasSizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  const resizeTimeoutRef = useRef<number | null>(null);

  const canvasMetrics = useMemo(
    () => resolvePatternCanvasMetrics(shaderFile, numChannels, cellWidth, liteMode),
    [shaderFile, numChannels, cellWidth, liteMode],
  );

  const syncCanvasSize = useCallback((canvas: HTMLCanvasElement, glCanvas: HTMLCanvasElement | null) => {
    const dpr = resolvePatternDevicePixelRatio(liteMode);
    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const containerWidth = containerRect.width;
    const containerHeight = containerRect.height;
    if (containerWidth <= 0 || containerHeight <= 0) return;
    const aspectRatio = canvasMetrics.width / canvasMetrics.height;
    let displayWidth = containerWidth;
    let displayHeight = containerHeight;
    const containerAspect = containerWidth / containerHeight;
    if (containerAspect > aspectRatio) {
      displayWidth = containerHeight * aspectRatio;
    } else {
      displayHeight = containerWidth / aspectRatio;
    }
    displayWidth = Math.floor(displayWidth);
    displayHeight = Math.floor(displayHeight);
    const bufferWidth = Math.max(1, Math.floor(displayWidth * dpr));
    const bufferHeight = Math.max(1, Math.floor(displayHeight * dpr));
    if (canvas.width !== bufferWidth || canvas.height !== bufferHeight) {
      canvas.width = bufferWidth;
      canvas.height = bufferHeight;
      canvasSizeRef.current = { width: bufferWidth, height: bufferHeight, dpr };
    }
    if (glCanvas) {
      if (glCanvas.width !== bufferWidth || glCanvas.height !== bufferHeight) {
        glCanvas.width = bufferWidth;
        glCanvas.height = bufferHeight;
      }
    }
  }, [canvasMetrics, liteMode, containerRef]);

  const handleResize = useCallback(() => {
    const canvas = canvasRef.current;
    const glCanvas = glCanvasRef.current;
    if (!canvas) return;
    if (resizeTimeoutRef.current !== null) window.clearTimeout(resizeTimeoutRef.current);
    resizeTimeoutRef.current = window.setTimeout(() => {
      syncCanvasSize(canvas, glCanvas);
      if (gpuContextRef.current && gpuDeviceRef.current) {
        try {
          configureCanvasContext({
            device: gpuDeviceRef.current,
            context: gpuContextRef.current,
          });
        } catch (e) {
          console.error('❌ WebGPU context reconfiguration failed:', e);
        }
      }
      bloomRef.current?.resize(canvas.width, canvas.height);
      resizeTimeoutRef.current = null;
    }, 100);
  }, [syncCanvasSize, canvasRef, glCanvasRef, bloomRef, gpuContextRef, gpuDeviceRef]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    syncCanvasSize(canvas, glCanvasRef.current);
  }, [syncCanvasSize, canvasRef, glCanvasRef]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => handleResize());
    });
    resizeObserver.observe(container);
    const handleWindowResize = () => handleResize();
    window.addEventListener('resize', handleWindowResize);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleWindowResize);
      if (resizeTimeoutRef.current !== null) window.clearTimeout(resizeTimeoutRef.current);
    };
  }, [handleResize, containerRef, canvasRef]);

  return {
    canvasMetrics,
    canvasSizeRef,
    syncCanvasSize,
    handleResize,
  };
}
