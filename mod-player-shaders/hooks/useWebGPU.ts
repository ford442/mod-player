// hooks/useWebGPU.ts
// WebGPU device initialization hook

import { useState, useCallback, useRef, useEffect } from 'react';

export interface WebGPUState {
  device: GPUDevice | null;
  context: GPUCanvasContext | null;
  format: GPUTextureFormat | null;
  error: string | null;
  isReady: boolean;
}

export interface UseWebGPUOptions {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  onReady?: (device: GPUDevice, context: GPUCanvasContext, format: GPUTextureFormat) => void;
}

export function useWebGPU({ canvasRef, onReady }: UseWebGPUOptions): WebGPUState {
  const [state, setState] = useState<WebGPUState>({
    device: null,
    context: null,
    format: null,
    error: null,
    isReady: false,
  });

  const deviceRef = useRef<GPUDevice | null>(null);
  const contextRef = useRef<GPUCanvasContext | null>(null);

  const initialize = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!('gpu' in navigator)) {
      setState(prev => ({ ...prev, error: 'WebGPU not available in this browser' }));
      return;
    }

    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        setState(prev => ({ ...prev, error: 'Failed to get WebGPU adapter' }));
        return;
      }

      const requiredFeatures: GPUFeatureName[] = [];
      if (adapter.features.has('float32-filterable')) requiredFeatures.push('float32-filterable');
      if (adapter.features.has('float32-blendable')) requiredFeatures.push('float32-blendable');
      if (adapter.features.has('clip-distances')) requiredFeatures.push('clip-distances');
      if (adapter.features.has('depth32float-stencil8')) requiredFeatures.push('depth32float-stencil8');
      if (adapter.features.has('dual-source-blending')) requiredFeatures.push('dual-source-blending');
      if (adapter.features.has('subgroups')) requiredFeatures.push('subgroups');
      if (adapter.features.has('texture-component-swizzle')) requiredFeatures.push('texture-component-swizzle');
      if (adapter.features.has('shader-f16')) requiredFeatures.push('shader-f16');

      const device = await adapter.requestDevice({ requiredFeatures });
      if (!device) {
        setState(prev => ({ ...prev, error: 'Failed to create WebGPU device' }));
        return;
      }

      const context = canvas.getContext('webgpu') as GPUCanvasContext;
      const format = navigator.gpu.getPreferredCanvasFormat();

      context.configure({
        device,
        format,
        alphaMode: 'premultiplied'
      });

      deviceRef.current = device;
      contextRef.current = context;

      setState({
        device,
        context,
        format,
        error: null,
        isReady: true,
      });

      onReady?.(device, context, format);
    } catch (err) {
      console.error('Failed to initialize WebGPU:', err);
      setState(prev => ({ ...prev, error: String(err) }));
    }
  }, [canvasRef, onReady]);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      if (cancelled) return;
      await initialize();
    };

    init();

    return () => {
      cancelled = true;
      if (deviceRef.current) {
        try { deviceRef.current.destroy(); } catch (e) { console.warn(e); }
        deviceRef.current = null;
      }
    };
  }, [initialize]);

  return state;
}

export default useWebGPU;
