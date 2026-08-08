import { useEffect, useState } from 'react';
import { BloomPostProcessor } from '../../../utils/bloomPostProcessor';
import { getShaderMeta } from '../../../utils/shaderRegistry';
import { getBloomProfile } from '../../../utils/bloomProfiles';
import { detectRuntimeBase } from '../../lib/paths';
import { configureCanvasContext } from '../../../utils/webgpuDevice';

export interface UsePatternBloomParams {
  bloomRef: React.MutableRefObject<BloomPostProcessor | null>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  glCanvasRef: React.RefObject<HTMLCanvasElement>;
  shaderFile: string;
  gpuReady: boolean;
  useWebGPU: boolean;
  liteMode: boolean;
  gpuDevRef: React.MutableRefObject<GPUDevice | null>;
  gpuHookContextRef: React.MutableRefObject<GPUCanvasContext | null>;
  syncCanvasSize: (canvas: HTMLCanvasElement, gl: HTMLCanvasElement | null) => void;
}

export function usePatternBloom(params: UsePatternBloomParams) {
  const {
    bloomRef,
    canvasRef,
    glCanvasRef,
    shaderFile,
    gpuReady,
    useWebGPU,
    liteMode,
    gpuDevRef,
    gpuHookContextRef,
    syncCanvasSize,
  } = params;

  const [debugBloomLayer, setDebugBloomLayer] = useState<number>(-1);

  useEffect(() => {
    const device = gpuDevRef.current;
    const canvas = canvasRef.current;
    if (!device || !canvas || !gpuReady || !useWebGPU) return;
    if (liteMode) return;
    const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
    if (!context) return;

    let cancelled = false;
    const meta = getShaderMeta(shaderFile);
    const bloomLayers = meta?.bloomProfile
      ? getBloomProfile(meta.bloomProfile)
      : undefined;
    const bloomOptions = bloomLayers
      ? { layers: [...bloomLayers], finalFormat: navigator.gpu.getPreferredCanvasFormat() }
      : { finalFormat: navigator.gpu.getPreferredCanvasFormat() };
    const bloom = new BloomPostProcessor(device, canvas, context, bloomOptions);
    bloom.setBaseUrl(detectRuntimeBase());
    void bloom.init().then(() => {
      if (cancelled) {
        bloom.destroy();
        return;
      }
      bloomRef.current = bloom;
    }).catch((err: unknown) => {
      if (!cancelled) {
        console.warn('BloomPostProcessor init failed:', err);
      }
    });

    return () => {
      cancelled = true;
      bloom.destroy();
      if (bloomRef.current === bloom) {
        bloomRef.current = null;
      }
    };
  }, [gpuReady, shaderFile, liteMode, useWebGPU, gpuDevRef, canvasRef, bloomRef]);

  useEffect(() => {
    if (!useWebGPU || !gpuReady) return;
    const canvas = canvasRef.current;
    const device = gpuDevRef.current;
    const context = gpuHookContextRef.current;
    if (!canvas || !device || !context) return;
    syncCanvasSize(canvas, glCanvasRef.current);
    try {
      configureCanvasContext({ device, context });
      bloomRef.current?.resize(canvas.width, canvas.height);
    } catch (e) {
      console.error('❌ WebGPU context configure-on-ready failed:', e);
    }
  }, [useWebGPU, gpuReady, syncCanvasSize, gpuDevRef, gpuHookContextRef, canvasRef, glCanvasRef, bloomRef]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const handler = (e: KeyboardEvent) => {
      if (!e.altKey || e.key !== 'b') return;
      e.preventDefault();
      const bloom = bloomRef.current;
      if (!bloom) return;
      setDebugBloomLayer((prev) => {
        const next = prev >= 2 ? -1 : prev + 1;
        bloom.setDebugLayer(next);
        const label = bloom.getDebugLayerLabel();
        console.log(`[Bloom debug] layer: ${label ?? 'all'}`);
        return next;
      });
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [bloomRef]);

  return { debugBloomLayer };
}
