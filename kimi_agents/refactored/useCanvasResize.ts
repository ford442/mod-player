/**
 * useCanvasResize - Optimized canvas resize handling using ResizeObserver
 * with requestAnimationFrame throttling for smooth performance.
 */

import { useEffect, useRef, useCallback, RefObject } from 'react';

export interface CanvasSize {
  width: number;
  height: number;
  pixelWidth: number;
  pixelHeight: number;
  dpr: number;
}

interface UseCanvasResizeOptions {
  /** Target DPR, or 'auto' for device pixel ratio */
  dpr?: number | 'auto';
  /** Minimum canvas dimensions */
  minSize?: { width: number; height: number };
  /** Maximum canvas dimensions */
  maxSize?: { width: number; height: number };
  /** Debounce delay in ms (0 for no debounce) */
  debounceMs?: number;
}

export function useCanvasResize(
  canvasRef: RefObject<HTMLCanvasElement>,
  onResize: (size: CanvasSize) => void,
  options: UseCanvasResizeOptions = {}
) {
  const {
    dpr = 'auto',
    minSize = { width: 1, height: 1 },
    maxSize = { width: 4096, height: 4096 },
    debounceMs = 0,
  } = options;

  const pendingSize = useRef<CanvasSize | null>(null);
  const rafId = useRef<number | null>(null);
  const debounceTimeout = useRef<number | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const lastSize = useRef<CanvasSize | null>(null);

  const applyResize = useCallback(() => {
    if (pendingSize.current) {
      const newSize = pendingSize.current;
      
      // Only trigger if size actually changed
      if (!lastSize.current ||
          lastSize.current.pixelWidth !== newSize.pixelWidth ||
          lastSize.current.pixelHeight !== newSize.pixelHeight) {
        
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.width = newSize.pixelWidth;
          canvas.height = newSize.pixelHeight;
        }
        
        onResize(newSize);
        lastSize.current = newSize;
      }
      
      pendingSize.current = null;
    }
    rafId.current = null;
  }, [canvasRef, onResize]);

  const scheduleResize = useCallback(() => {
    if (debounceMs > 0) {
      // Debounced mode
      if (debounceTimeout.current) {
        clearTimeout(debounceTimeout.current);
      }
      debounceTimeout.current = window.setTimeout(() => {
        if (!rafId.current) {
          rafId.current = requestAnimationFrame(applyResize);
        }
      }, debounceMs);
    } else {
      // RAF throttled mode (default, recommended)
      if (!rafId.current) {
        rafId.current = requestAnimationFrame(applyResize);
      }
    }
  }, [debounceMs, applyResize]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Get the actual DPR to use
    const getDpr = () => {
      if (dpr === 'auto') {
        return Math.min(window.devicePixelRatio, 2); // Cap at 2x for performance
      }
      return dpr;
    };

    // Calculate constrained size
    const constrainSize = (width: number, height: number) => {
      return {
        width: Math.max(minSize.width, Math.min(width, maxSize.width)),
        height: Math.max(minSize.height, Math.min(height, maxSize.height)),
      };
    };

    // Handle resize
    const handleResize = (entries: ResizeObserverEntry[]) => {
      const entry = entries[0];
      const { width, height } = entry.contentRect;
      
      const constrained = constrainSize(width, height);
      const actualDpr = getDpr();
      
      pendingSize.current = {
        width: constrained.width,
        height: constrained.height,
        pixelWidth: Math.floor(constrained.width * actualDpr),
        pixelHeight: Math.floor(constrained.height * actualDpr),
        dpr: actualDpr,
      };
      
      scheduleResize();
    };

    // Also handle DPR changes
    const handleDprChange = () => {
      const rect = canvas.getBoundingClientRect();
      const constrained = constrainSize(rect.width, rect.height);
      const actualDpr = getDpr();
      
      pendingSize.current = {
        width: constrained.width,
        height: constrained.height,
        pixelWidth: Math.floor(constrained.width * actualDpr),
        pixelHeight: Math.floor(constrained.height * actualDpr),
        dpr: actualDpr,
      };
      
      scheduleResize();
    };

    // Create ResizeObserver
    observerRef.current = new ResizeObserver(handleResize);
    observerRef.current.observe(canvas);

    // Listen for DPR changes
    const mediaQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mediaQuery.addEventListener('change', handleDprChange);

    // Initial size calculation
    const rect = canvas.getBoundingClientRect();
    const constrained = constrainSize(rect.width, rect.height);
    const actualDpr = getDpr();
    
    const initialSize: CanvasSize = {
      width: constrained.width,
      height: constrained.height,
      pixelWidth: Math.floor(constrained.width * actualDpr),
      pixelHeight: Math.floor(constrained.height * actualDpr),
      dpr: actualDpr,
    };
    
    canvas.width = initialSize.pixelWidth;
    canvas.height = initialSize.pixelHeight;
    onResize(initialSize);
    lastSize.current = initialSize;

    return () => {
      observerRef.current?.disconnect();
      mediaQuery.removeEventListener('change', handleDprChange);
      
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
      }
      if (debounceTimeout.current) {
        clearTimeout(debounceTimeout.current);
      }
    };
  }, [canvasRef, dpr, minSize, maxSize, onResize, scheduleResize]);

  // Method to manually trigger resize
  const triggerResize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const actualDpr = dpr === 'auto' ? window.devicePixelRatio : dpr;
    
    pendingSize.current = {
      width: rect.width,
      height: rect.height,
      pixelWidth: Math.floor(rect.width * actualDpr),
      pixelHeight: Math.floor(rect.height * actualDpr),
      dpr: actualDpr,
    };
    
    scheduleResize();
  }, [canvasRef, dpr, scheduleResize]);

  return { triggerResize, lastSize: lastSize.current };
}

/**
 * Hook for handling fullscreen canvas with proper resize handling
 */
export function useFullscreenCanvas(
  canvasRef: RefObject<HTMLCanvasElement>,
  onResize: (size: CanvasSize) => void
) {
  const handleFullscreenChange = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (document.fullscreenElement === canvas) {
      // Entered fullscreen
      canvas.style.width = '100vw';
      canvas.style.height = '100vh';
    } else {
      // Exited fullscreen
      canvas.style.width = '';
      canvas.style.height = '';
    }
  }, [canvasRef]);

  useEffect(() => {
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [handleFullscreenChange]);

  const enterFullscreen = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      if (canvas.requestFullscreen) {
        await canvas.requestFullscreen();
      }
    } catch (err) {
      console.error('Failed to enter fullscreen:', err);
    }
  }, [canvasRef]);

  const exitFullscreen = useCallback(async () => {
    try {
      if (document.exitFullscreen && document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.error('Failed to exit fullscreen:', err);
    }
  }, []);

  const resizeResult = useCanvasResize(canvasRef, onResize, {
    dpr: 'auto',
  });

  return {
    ...resizeResult,
    enterFullscreen,
    exitFullscreen,
    isFullscreen: !!document.fullscreenElement,
  };
}
