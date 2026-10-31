import { useRef, useEffect, useState, useCallback } from 'react';
import type React from 'react';
import type { PatternMatrix } from '../../../types';
import type { WebGPURenderParams, DebugInfo } from '../params';
import type { WebGL2PatternRenderer } from './WebGL2PatternRenderer';
import { setCurrentPatternRenderer } from '../global';
import type { CurrentPatternRenderer, WebGL2DebugMode } from '../types';
import { cycleDebugMode } from './debugModes';
import { createLogger } from '../../../utils/log';

const log = createLogger('WebGL2 debug');
const glLog = createLogger('WebGL2');

/** DebugInfo.errors prefix for WebGL2 session init failures (mirrors `DEVICE-INIT:` / `SHADER-INIT:`). */
const INIT_ERROR_PREFIX = 'WEBGL2-INIT:';
/** DebugInfo.errors prefix while the context is lost / when its restore failed (#492). */
const CONTEXT_ERROR_PREFIX = 'WEBGL2-CONTEXT:';

/**
 * The renderer (its GLSL, bloom and the GL plumbing) is its own chunk: it is only ever
 * constructed on the WebGL2 opt-in (`?webgl2=1` / failure-card button), so WebGPU and HTML
 * sessions never download it (#492).
 */
const loadWebGL2Renderer = () => import('./WebGL2PatternRenderer');

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
    if (!canvasRef.current) return;

    // Set by the cleanup: a backend switch, shader change or unmount while the chunk was still
    // loading must not construct (and leak) a renderer for a session that is already gone.
    let cancelled = false;
    let renderer: WebGL2PatternRenderer | null = null;

    const reportInitError = (initError: string) => {
      console.error(`[Renderer] WebGL2 init failed: ${initError}`);
      setDebugInfo((prev) => ({
        ...prev,
        errors: [...prev.errors.filter((e) => !e.startsWith(INIT_ERROR_PREFIX)), `${INIT_ERROR_PREFIX} ${initError}`],
      }));
      setWebgl2Available(false);
      setGlReady(false);
    };

    const start = (Renderer: typeof WebGL2PatternRenderer) => {
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;
      syncCanvasSize(canvas, null);
      const instance = new Renderer();
      let initError: string | null = null;
      let ok = false;
      try {
        ok = instance.init(canvas, shaderFile, {
          onContextLost: () => {
            glLog.warn('WebGL2 context lost — rendering paused until the browser restores it');
            setDebugInfo((prev) => ({
              ...prev,
              errors: [
                ...prev.errors.filter((e) => !e.startsWith(CONTEXT_ERROR_PREFIX)),
                `${CONTEXT_ERROR_PREFIX} lost — rendering paused until the browser restores it`,
              ],
              uniforms: { ...prev.uniforms, glContext: 'lost' },
            }));
          },
          onContextRestored: (error) => {
            if (error) {
              console.error(`[Renderer] WebGL2 context restored, but re-creating its resources failed: ${error}`);
            } else {
              log.log('context restored — GL resources re-created, rendering resumed');
            }
            const restores = instance.getContextState().restores;
            setDebugInfo((prev) => ({
              ...prev,
              errors: [
                ...prev.errors.filter((e) => !e.startsWith(CONTEXT_ERROR_PREFIX)),
                ...(error ? [`${CONTEXT_ERROR_PREFIX} restore failed: ${error}`] : []),
              ],
              uniforms: { ...prev.uniforms, glContext: error ? 'restore-failed' : `restored ×${restores}` },
            }));
          },
        });
        // `getContext('webgl2')` returns null when the canvas already holds another context
        // type (WebGPU after a late hard-fail) or when WebGL2 is unavailable.
        if (!ok) initError = 'no WebGL2 context on this canvas (unsupported, or already bound to WebGPU)';
      } catch (err) {
        // Shader compile/link failures throw; there is no ErrorBoundary, so never let one escape.
        initError = err instanceof Error ? err.message : String(err);
        instance.destroy();
      }
      if (!ok) {
        reportInitError(initError ?? 'unknown error');
        return;
      }
      setDebugInfo((prev) => ({ ...prev, errors: prev.errors.filter((e) => !e.startsWith(INIT_ERROR_PREFIX)) }));

      renderer = instance;
      rendererRef.current = instance;
      setWebgl2Available(true);
      setGlReady(true);

      const handle: CurrentPatternRenderer = {
        backend: 'webgl2',
        readPixels: () => instance.readPixels(),
        getCanvas: () => instance.getCanvas(),
        setDebugMode: (mode: WebGL2DebugMode) => instance.setDebugConfig({ mode }),
        getDebugMode: () => instance.getDebugConfig().mode,
        setScrollSpeed: (speed: number) => instance.setDebugConfig({ scrollSpeed: speed }),
        getScrollSpeed: () => instance.getDebugConfig().scrollSpeed,
        resize: () => {
          const c = canvasRef.current;
          if (c) instance.resize(c.width, c.height);
        },
      };
      setCurrentPatternRenderer(handle);
    };

    void loadWebGL2Renderer().then(
      (mod) => start(mod.WebGL2PatternRenderer),
      (err: unknown) => {
        // Chunk fetch failed (offline, or a deploy replaced the hashed file under this page).
        if (cancelled) return;
        reportInitError(`could not load the WebGL2 renderer: ${err instanceof Error ? err.message : String(err)}`);
      },
    );

    return () => {
      cancelled = true;
      setGlReady(false);
      if (!renderer) return;
      renderer.destroy();
      renderer = null;
      rendererRef.current = null;
      setCurrentPatternRenderer(null);
    };
  }, [shaderFile, canvasRef, syncCanvasSize, setWebgl2Available, setDebugInfo, enabled]);

  // DEV: Alt+D cycles WebGL2 debug visualization modes
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const handler = (e: KeyboardEvent) => {
      if (!e.altKey || e.key !== 'd') return;
      const r = rendererRef.current;
      if (!r) return; // no WebGL2 session active — leave Alt+D alone
      e.preventDefault();
      const next = cycleDebugMode(r.getDebugConfig().mode);
      r.setDebugConfig({ mode: next });
      log.log(`mode: ${next}`);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const render = useCallback(() => {
    const renderer = rendererRef.current;
    const canvas = canvasRef.current;
    // A lost context issues no GL calls; the renderer rebuilds itself on `webglcontextrestored`.
    if (!renderer || !canvas || !glReady || renderer.isContextLost()) return;

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
          // Per-frame GL errors replace the previous frame's, but keep entries owned by other
          // stages (e.g. a DEVICE-INIT: cause) instead of wiping them on the first frame.
          errors: [...prev.errors.filter((e) => !e.startsWith('GL error')), ...info.errors],
        }));
      },
    );
  }, [glReady, liteMode, crtEnabledRef, renderParamsRef, setDebugInfo, canvasRef]);

  return { glReady, render, rendererRef, deviceRef: rendererRef };
}
