import { useRef, useEffect, useState, useCallback } from 'react';
import type React from 'react';
import type { PatternMatrix } from '../../../types';
import type { WebGPURenderParams, DebugInfo } from '../../../hooks/useWebGPURender';
import { WebGL2PatternRenderer } from './WebGL2PatternRenderer';
import { setCurrentPatternRenderer } from '../global';
import type { CurrentPatternRenderer, WebGL2DebugMode } from '../types';
import { cycleDebugMode } from './debugModes';

export function useWebGL2PatternRender(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  shaderFile: string,
  syncCanvasSize: (canvas: HTMLCanvasElement, gl: HTMLCanvasElement | null) => void,
  renderParamsRef: React.MutableRefObject<WebGPURenderParams>,
  _matrix: PatternMatrix | null,
  padTopChannel: boolean,
  setDebugInfo: React.Dispatch<React.SetStateAction<DebugInfo>>,
  setWebgl2Available: (v: boolean) => void,
  liteMode?: boolean,
  crtEnabledRef?: React.MutableRefObject<boolean>,
  enabled = true,
) {
  const [glReady, setGlReady] = useState(false);
  const rendererRef = useRef<WebGL2PatternRenderer | null>(null);
  const padTopRef = useRef(padTopChannel);
  padTopRef.current = padTopChannel;

  useEffect(() => {
    if (!enabled) {
      setGlReady(false);
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;

    syncCanvasSize(canvas, null);
    const renderer = new WebGL2PatternRenderer();
    const ok = renderer.init(canvas, shaderFile);
    if (!ok) {
      setWebgl2Available(false);
      setGlReady(false);
      return;
    }

    rendererRef.current = renderer;
    setWebgl2Available(true);
    setGlReady(true);

    const handle: CurrentPatternRenderer = {
      backend: 'webgl2',
      readPixels: () => renderer.readPixels(),
      getCanvas: () => renderer.getCanvas(),
      setDebugMode: (mode: WebGL2DebugMode) => renderer.setDebugConfig({ mode }),
      getDebugMode: () => renderer.getDebugConfig().mode,
      setScrollSpeed: (speed: number) => renderer.setDebugConfig({ scrollSpeed: speed }),
      getScrollSpeed: () => renderer.getDebugConfig().scrollSpeed,
      resize: () => {
        const c = canvasRef.current;
        if (c) renderer.resize(c.width, c.height);
      },
    };
    setCurrentPatternRenderer(handle);

    return () => {
      renderer.destroy();
      rendererRef.current = null;
      setGlReady(false);
      setCurrentPatternRenderer(null);
    };
  }, [shaderFile, canvasRef, syncCanvasSize, setWebgl2Available, enabled]);

  // DEV: Alt+D cycles WebGL2 debug visualization modes
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const handler = (e: KeyboardEvent) => {
      if (!e.altKey || e.key !== 'd') return;
      e.preventDefault();
      const r = rendererRef.current;
      if (!r) return;
      const next = cycleDebugMode(r.getDebugConfig().mode);
      r.setDebugConfig({ mode: next });
      console.log(`[WebGL2 debug] mode: ${next}`);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const render = useCallback(() => {
    const renderer = rendererRef.current;
    const canvas = canvasRef.current;
    if (!renderer || !canvas || !glReady) return;

    renderer.resize(canvas.width, canvas.height);
    if (crtEnabledRef) {
      renderer.setCRT(crtEnabledRef.current);
    }

    const params = renderParamsRef.current;
    renderer.render(
      params,
      padTopRef.current,
      liteMode ?? false,
      (info) => {
        setDebugInfo((prev) => ({
          ...prev,
          layoutMode: info.layoutMode,
          uniforms: { ...prev.uniforms, ...info.uniforms, backend: 'webgl2' },
          errors: info.errors,
        }));
      },
    );
  }, [glReady, liteMode, crtEnabledRef, renderParamsRef, setDebugInfo, canvasRef]);

  return { glReady, render, rendererRef, deviceRef: rendererRef };
}
