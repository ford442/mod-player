import { useEffect, useState } from 'react';
import { BloomPostProcessor, HDR_OUTPUT_HEADROOM } from '../../../utils/bloomPostProcessor';
import { getShaderMeta } from '../../../utils/shaderRegistry';
import { getBloomProfile } from '../../../utils/bloomProfiles';
import { detectRuntimeBase } from '../../lib/paths';
import type { CanvasOutput } from '../../../utils/webgpuDevice';
import { createLogger } from '../../../utils/log';

const log = createLogger('Bloom debug');

export interface UsePatternBloomParams {
  bloomRef: React.MutableRefObject<BloomPostProcessor | null>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  shaderFile: string;
  gpuReady: boolean;
  useWebGPU: boolean;
  liteMode: boolean;
  gpuDevRef: React.MutableRefObject<GPUDevice | null>;
  /** The canvas configuration the renderer applied; the composite pass targets it. */
  canvasOutput: CanvasOutput | null;
}

export function usePatternBloom(params: UsePatternBloomParams) {
  const {
    bloomRef,
    canvasRef,
    shaderFile,
    gpuReady,
    useWebGPU,
    liteMode,
    gpuDevRef,
    canvasOutput,
  } = params;

  const [debugBloomLayer, setDebugBloomLayer] = useState<number>(-1);
  const outputFormat = canvasOutput?.format ?? null;
  const hdrOutput = canvasOutput?.hdr ?? false;

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
    const bloomOptions = {
      finalFormat: outputFormat ?? navigator.gpu.getPreferredCanvasFormat(),
      ...(hdrOutput ? { outputHeadroom: HDR_OUTPUT_HEADROOM } : {}),
      ...(bloomLayers ? { layers: [...bloomLayers] } : {}),
    };
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
  }, [gpuReady, shaderFile, liteMode, useWebGPU, gpuDevRef, canvasRef, bloomRef, outputFormat, hdrOutput]);

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
        log.log(`layer: ${label ?? 'all'}`);
        return next;
      });
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [bloomRef]);

  return { debugBloomLayer };
}
