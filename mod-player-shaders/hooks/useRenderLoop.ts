// hooks/useRenderLoop.ts
// Render loop management (requestAnimationFrame + command encoder)

import { useRef, useEffect, useCallback } from 'react';

export interface RenderFrame {
  time: number;
  deltaTime: number;
}

export interface UseRenderLoopOptions {
  isActive: boolean;
  onRender: (frame: RenderFrame) => void;
  targetFPS?: number;
}

export function useRenderLoop({ isActive, onRender, targetFPS = 60 }: UseRenderLoopOptions) {
  const animationFrameRef = useRef<number | undefined>(undefined);
  const lastTimeRef = useRef<number>(0);
  const renderRef = useRef<(() => void)>();

  // Keep ref to latest render function to avoid stale closures
  useEffect(() => {
    renderRef.current = () => {
      const now = performance.now();
      const deltaTime = lastTimeRef.current ? now - lastTimeRef.current : 0;
      lastTimeRef.current = now;
      
      onRender({
        time: now,
        deltaTime
      });
    };
  }, [onRender]);

  useEffect(() => {
    let isCancelled = false;
    
    const loop = (time: number) => {
      if (isCancelled || !isActive) return;
      
      animationFrameRef.current = requestAnimationFrame(loop);
      
      if (renderRef.current) {
        renderRef.current();
      }
    };

    if (isActive) {
      lastTimeRef.current = 0;
      animationFrameRef.current = requestAnimationFrame(loop);
    }

    return () => {
      isCancelled = true;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = undefined;
      }
    };
  }, [isActive]);

  const triggerRender = useCallback(() => {
    if (renderRef.current) {
      renderRef.current();
    }
  }, []);

  return { triggerRender };
}

export interface UseWebGLRenderLoopOptions {
  gl: WebGL2RenderingContext | null;
  resources: {
    program: WebGLProgram;
    vao: WebGLVertexArrayObject;
    texture: WebGLTexture;
    capTexture?: WebGLTexture;
    uniforms: Record<string, WebGLUniformLocation | null>;
  } | null;
  isActive: boolean;
  onBeforeRender?: () => void;
  onAfterRender?: () => void;
}

export function useWebGLRenderLoop({
  gl,
  resources,
  isActive,
  onBeforeRender,
  onAfterRender
}: UseWebGLRenderLoopOptions) {
  const animationFrameRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!gl || !resources || !isActive) return;

    const loop = () => {
      if (!isActive) return;
      
      animationFrameRef.current = requestAnimationFrame(loop);
      
      onBeforeRender?.();
      // Actual WebGL rendering happens here
      onAfterRender?.();
    };

    animationFrameRef.current = requestAnimationFrame(loop);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [gl, resources, isActive, onBeforeRender, onAfterRender]);

  return {};
}

export default useRenderLoop;
