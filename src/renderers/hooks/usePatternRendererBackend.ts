import { useEffect, useLayoutEffect, useState } from 'react';
import {
  resolvePatternRenderer,
  resolvePatternRendererAsync,
  subscribeRendererPreference,
  applyWebGPUFallback,
  hasWebGPUAutoFallbackApplied,
} from '../rendererSelection';
import type { PatternRendererBackend } from '../types';

/** WebGPU → WebGL2 → HTML backend selection with async adapter probe and init-time fallback. */
export function usePatternRendererBackend(webgpuAvailable: boolean) {
  const [webgl2Available, setWebgl2Available] = useState(true);
  const [activeBackend, setActiveBackend] = useState<PatternRendererBackend>(() => resolvePatternRenderer());

  useEffect(() => subscribeRendererPreference(setActiveBackend), []);

  useEffect(() => {
    let cancelled = false;
    void resolvePatternRendererAsync().then((resolved) => {
      if (cancelled) return;
      setActiveBackend((current) => {
        if (current === 'webgpu' && resolved !== 'webgpu') {
          applyWebGPUFallback('no usable WebGPU adapter');
          return resolved;
        }
        return current;
      });
    });
    return () => { cancelled = true; };
  }, []);

  useLayoutEffect(() => {
    if (activeBackend !== 'webgpu' || webgpuAvailable) return;
    if (hasWebGPUAutoFallbackApplied()) return;
    const fallback = applyWebGPUFallback('WebGPU initialization or canvas presentation failed');
    setActiveBackend(fallback);
  }, [activeBackend, webgpuAvailable]);

  return {
    activeBackend,
    setActiveBackend,
    webgl2Available,
    setWebgl2Available,
  };
}
