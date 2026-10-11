import { useCallback, useEffect, useRef } from 'react';
import type React from 'react';
import type { DebugInfo } from '../params';
import type { PatternRendererBackend } from '../types';

/**
 * Wraps the (throttled) DebugInfo dispatch so every update — including the
 * WebGPU frame loop, which replaces `uniforms` wholesale each frame — carries
 * the resolved `backend` and why (`backendReason`). Reads the latest values
 * through a ref, so the returned dispatch keeps a stable identity: renderers
 * capture it once at construction.
 */
export function useBackendDebugInfo(
  setDebugInfo: React.Dispatch<React.SetStateAction<DebugInfo>>,
  backend: PatternRendererBackend,
  backendReason: string,
): React.Dispatch<React.SetStateAction<DebugInfo>> {
  const latest = useRef({ backend, backendReason });
  latest.current = { backend, backendReason };

  const dispatch = useCallback<React.Dispatch<React.SetStateAction<DebugInfo>>>(
    (action) => {
      setDebugInfo((prev) => {
        const next = typeof action === 'function' ? action(prev) : action;
        const { backend: b, backendReason: r } = latest.current;
        return { ...next, uniforms: { ...next.uniforms, backend: b, backendReason: r } };
      });
    },
    [setDebugInfo],
  );

  // Publish on change too — a backend swap may not produce a frame update right away.
  useEffect(() => {
    dispatch((prev) => prev);
  }, [dispatch, backend, backendReason]);

  return dispatch;
}
