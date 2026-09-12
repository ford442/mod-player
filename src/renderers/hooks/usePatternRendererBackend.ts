import { useEffect, useState } from 'react';
import {
  applyWebGPUFallback,
  isWebGL2Available,
  resolvePatternRenderer,
  resolvePatternRendererAsync,
  subscribeRendererPreference,
} from '../rendererSelection';
import type { PatternRendererBackend } from '../types';

/**
 * Pattern renderer backend selection.
 *
 * WebGPU is preferred. `webgpuAvailable` reflects whether `requestWebGPUDevice`
 * has actually failed at runtime (set by the caller once device init throws) —
 * when it flips false while WebGPU is still the active backend, this downgrades
 * to WebGL2 (or HTML if WebGL2 is also unavailable) instead of leaving a dead
 * WebGPU canvas on screen. Explicit `webgl2`/`html` preferences always win.
 */
export function usePatternRendererBackend(webgpuAvailable: boolean) {
  const [webgl2Available, setWebgl2Available] = useState(() => isWebGL2Available());
  const [activeBackend, setActiveBackend] = useState<PatternRendererBackend>(() =>
    resolvePatternRenderer(),
  );

  useEffect(() => subscribeRendererPreference(setActiveBackend), []);

  useEffect(() => {
    let cancelled = false;
    void resolvePatternRendererAsync().then((resolved) => {
      if (cancelled) return;
      setActiveBackend(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (webgpuAvailable) return;
    setActiveBackend((current) =>
      current === 'webgpu' ? applyWebGPUFallback('device-init-failed') : current,
    );
  }, [webgpuAvailable]);

  return {
    activeBackend,
    setActiveBackend,
    webgl2Available,
    setWebgl2Available,
  };
}
