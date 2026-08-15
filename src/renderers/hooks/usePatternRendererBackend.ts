import { useEffect, useState } from 'react';
import {
  resolvePatternRenderer,
  resolvePatternRendererAsync,
  subscribeRendererPreference,
} from '../rendererSelection';
import type { PatternRendererBackend } from '../types';

/**
 * Pattern renderer backend selection.
 *
 * WebGPU is required for GPU viz. Failed probes do **not** auto-switch to
 * WebGL2/HTML shader backends — PatternDisplay shows a hard-fail viz surface.
 * Explicit `html` remains available for the DOM pattern grid (tracker UI).
 */
export function usePatternRendererBackend(_webgpuAvailable: boolean) {
  const [webgl2Available, setWebgl2Available] = useState(true);
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

  return {
    activeBackend,
    setActiveBackend,
    webgl2Available,
    setWebgl2Available,
  };
}
