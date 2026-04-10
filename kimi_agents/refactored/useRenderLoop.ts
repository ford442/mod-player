/**
 * useRenderLoop - Optimized render loop with error handling, frame timing,
 * and performance monitoring.
 */

import { useEffect, useRef, useCallback, useState } from 'react';

export interface FrameTiming {
  deltaTime: number;
  elapsedTime: number;
  frameNumber: number;
  fps: number;
}

export interface RenderLoopOptions {
  /** Target FPS (0 for unlimited) */
  targetFps?: number;
  /** Pause rendering when tab is hidden */
  pauseWhenHidden?: boolean;
  /** Maximum consecutive errors before stopping */
  maxConsecutiveErrors?: number;
  /** Enable performance monitoring */
  enableStats?: boolean;
}

export interface RenderLoopState {
  isRunning: boolean;
  isPaused: boolean;
  error: Error | null;
  consecutiveErrors: number;
  stats: RenderStats | null;
}

interface RenderStats {
  fps: number;
  frameTime: number;
  gpuTime: number | null;
}

export function useRenderLoop(
  renderFn: (timing: FrameTiming, encoder: GPUCommandEncoder) => void,
  device: GPUDevice | null,
  options: RenderLoopOptions = {}
) {
  const {
    targetFps = 0,
    pauseWhenHidden = true,
    maxConsecutiveErrors = 5,
    enableStats = false,
  } = options;

  const [state, setState] = useState<RenderLoopState>({
    isRunning: false,
    isPaused: false,
    error: null,
    consecutiveErrors: 0,
    stats: null,
  });

  const frameIdRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const frameNumberRef = useRef<number>(0);
  const elapsedTimeRef = useRef<number>(0);
  const consecutiveErrorsRef = useRef<number>(0);
  const isVisibleRef = useRef<boolean>(true);
  const targetFrameTimeRef = useRef<number>(
    targetFps > 0 ? 1000 / targetFps : 0
  );
  
  // Stats tracking
  const frameTimesRef = useRef<number[]>([]);
  const lastStatsUpdateRef = useRef<number>(0);

  const updateStats = useCallback((frameTime: number) => {
    if (!enableStats) return;

    frameTimesRef.current.push(frameTime);
    
    const now = performance.now();
    if (now - lastStatsUpdateRef.current >= 1000) {
      // Calculate stats every second
      const times = frameTimesRef.current;
      const avgFrameTime = times.reduce((a, b) => a + b, 0) / times.length;
      const fps = 1000 / avgFrameTime;

      setState(prev => ({
        ...prev,
        stats: {
          fps: Math.round(fps),
          frameTime: Math.round(avgFrameTime * 100) / 100,
          gpuTime: null, // Would need timestamp queries
        },
      }));

      frameTimesRef.current = [];
      lastStatsUpdateRef.current = now;
    }
  }, [enableStats]);

  const loop = useCallback((timestamp: number) => {
    if (!device) return;

    // Handle pause when hidden
    if (pauseWhenHidden && !isVisibleRef.current) {
      frameIdRef.current = requestAnimationFrame(loop);
      return;
    }

    // Frame rate limiting
    if (targetFrameTimeRef.current > 0) {
      const elapsed = timestamp - lastTimeRef.current;
      if (elapsed < targetFrameTimeRef.current) {
        frameIdRef.current = requestAnimationFrame(loop);
        return;
      }
    }

    // Calculate timing
    const deltaTime = lastTimeRef.current > 0 
      ? (timestamp - lastTimeRef.current) / 1000 
      : 0;
    elapsedTimeRef.current += deltaTime;
    frameNumberRef.current++;

    const timing: FrameTiming = {
      deltaTime,
      elapsedTime: elapsedTimeRef.current,
      frameNumber: frameNumberRef.current,
      fps: deltaTime > 0 ? 1 / deltaTime : 0,
    };

    // Create command encoder
    const encoder = device.createCommandEncoder({
      label: `Frame ${frameNumberRef.current}`,
    });

    try {
      // Call render function
      renderFn(timing, encoder);

      // Submit commands
      device.queue.submit([encoder.finish()]);

      // Reset error counter on success
      if (consecutiveErrorsRef.current > 0) {
        consecutiveErrorsRef.current = 0;
        setState(prev => ({ ...prev, consecutiveErrors: 0, error: null }));
      }

      // Update stats
      if (enableStats) {
        const frameTime = performance.now() - timestamp;
        updateStats(frameTime);
      }

    } catch (err) {
      console.error('Render error:', err);
      consecutiveErrorsRef.current++;

      // Try to finish encoder even on error
      try {
        device.queue.submit([encoder.finish()]);
      } catch {}

      setState(prev => ({
        ...prev,
        error: err instanceof Error ? err : new Error(String(err)),
        consecutiveErrors: consecutiveErrorsRef.current,
      }));

      // Stop if too many consecutive errors
      if (consecutiveErrorsRef.current >= maxConsecutiveErrors) {
        console.error(`Stopping render loop after ${maxConsecutiveErrors} consecutive errors`);
        return;
      }
    }

    lastTimeRef.current = timestamp;
    frameIdRef.current = requestAnimationFrame(loop);
  }, [device, renderFn, pauseWhenHidden, maxConsecutiveErrors, enableStats, updateStats]);

  // Start/stop the loop
  const start = useCallback(() => {
    if (frameIdRef.current !== null) return;
    
    setState(prev => ({ ...prev, isRunning: true, error: null }));
    lastTimeRef.current = 0;
    frameIdRef.current = requestAnimationFrame(loop);
  }, [loop]);

  const stop = useCallback(() => {
    if (frameIdRef.current !== null) {
      cancelAnimationFrame(frameIdRef.current);
      frameIdRef.current = null;
    }
    setState(prev => ({ ...prev, isRunning: false }));
  }, []);

  const pause = useCallback(() => {
    setState(prev => ({ ...prev, isPaused: true }));
  }, []);

  const resume = useCallback(() => {
    setState(prev => ({ ...prev, isPaused: false }));
  }, []);

  // Visibility handling
  useEffect(() => {
    if (!pauseWhenHidden) return;

    const handleVisibilityChange = () => {
      isVisibleRef.current = document.visibilityState === 'visible';
      
      if (isVisibleRef.current && state.isPaused) {
        // Reset last time to avoid large delta
        lastTimeRef.current = 0;
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [pauseWhenHidden, state.isPaused]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return {
    ...state,
    start,
    stop,
    pause,
    resume,
    frameNumber: frameNumberRef.current,
    elapsedTime: elapsedTimeRef.current,
  };
}

/**
 * Hook for GPU timestamp queries (performance profiling)
 */
export function useGPUTimestampQueries(device: GPUDevice | null) {
  const querySetRef = useRef<GPUQuerySet | null>(null);
  const resolveBufferRef = useRef<GPUBuffer | null>(null);
  const resultBufferRef = useRef<GPUBuffer | null>(null);

  useEffect(() => {
    if (!device?.features.has('timestamp-query')) return;

    // Create query set for 2 timestamps (begin and end)
    querySetRef.current = device.createQuerySet({
      type: 'timestamp',
      count: 2,
    });

    resolveBufferRef.current = device.createBuffer({
      size: 16, // 2 * 8 bytes
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });

    resultBufferRef.current = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    return () => {
      querySetRef.current?.destroy();
      resolveBufferRef.current?.destroy();
      resultBufferRef.current?.destroy();
    };
  }, [device]);

  const beginTimestamp = useCallback((encoder: GPUCommandEncoder) => {
    if (querySetRef.current) {
      encoder.writeTimestamp(querySetRef.current, 0);
    }
  }, []);

  const endTimestamp = useCallback((encoder: GPUCommandEncoder) => {
    if (querySetRef.current) {
      encoder.writeTimestamp(querySetRef.current, 1);
      encoder.resolveQuerySet(
        querySetRef.current,
        0,
        2,
        resolveBufferRef.current!,
        0
      );
      encoder.copyBufferToBuffer(
        resolveBufferRef.current!,
        0,
        resultBufferRef.current!,
        0,
        16
      );
    }
  }, []);

  const getGPUTime = useCallback(async (): Promise<number | null> => {
    if (!resultBufferRef.current) return null;

    await resultBufferRef.current.mapAsync(GPUMapMode.READ);
    const times = new BigInt64Array(resultBufferRef.current.getMappedRange());
    const gpuTime = Number(times[1] - times[0]) / 1_000_000; // Convert to ms
    resultBufferRef.current.unmap();

    return gpuTime;
  }, []);

  return {
    isSupported: !!querySetRef.current,
    beginTimestamp,
    endTimestamp,
    getGPUTime,
  };
}
