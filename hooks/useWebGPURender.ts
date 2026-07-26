// WebGPU initialization and render loop for PatternDisplay.
// Thin React glue — GPU logic lives in src/renderers/webgpu/WebGPURenderer.ts.

import { useRef, useEffect, useState, useCallback } from 'react';
import type React from 'react';
import type { PatternMatrix } from '../types';
import type { WebGPURenderParams, DebugInfo } from '../src/renderers/params';

export type { WebGPURenderParams, DebugInfo } from '../src/renderers/params';
export { resolveLiveChannels } from '../src/renderers/params';

import type { BloomPostProcessor } from '../utils/bloomPostProcessor';
import { getLayoutType } from '../utils/shaderVersion';
import { WebGPUInitError, type WebGPUDeviceStatus } from '../utils/webgpuDevice';
import { WebGPURenderer } from '../src/renderers/webgpu/WebGPURenderer';

/** Lifecycle status for the shared WebGPU device (surfaced to UI). */
export type { WebGPUDeviceStatus };

export function useWebGPURender(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  glCanvasRef: React.RefObject<HTMLCanvasElement>,
  shaderFile: string,
  syncCanvasSize: (canvas: HTMLCanvasElement, gl: HTMLCanvasElement | null) => void,
  renderParamsRef: React.MutableRefObject<WebGPURenderParams>,
  matrix: PatternMatrix | null,
  padTopChannel: boolean,
  setDebugInfo: React.Dispatch<React.SetStateAction<DebugInfo>>,
  setWebgpuAvailable: (v: boolean) => void,
  bloomProcessorRef?: React.MutableRefObject<BloomPostProcessor | null>,
  oscTextureRef?: React.MutableRefObject<GPUTexture | null>,
  liteMode?: boolean,
  enabled = true,
) {
  const [gpuReady, setGpuReady] = useState(false);
  const [deviceAcquired, setDeviceAcquired] = useState(false);
  const [deviceEpoch, setDeviceEpoch] = useState(0);
  const [deviceStatus, setDeviceStatus] = useState<WebGPUDeviceStatus>('initializing');

  const rendererRef = useRef<WebGPURenderer | null>(null);
  const layoutTypeRef = useRef(getLayoutType(shaderFile));

  if (!rendererRef.current) {
    rendererRef.current = new WebGPURenderer(
      { oscTextureRef, bloomProcessorRef },
      {
        onDeviceStatus: setDeviceStatus,
        onDeviceAcquired: setDeviceAcquired,
        onGpuReady: setGpuReady,
        onWebgpuAvailable: setWebgpuAvailable,
        onDeviceEpochBump: () => setDeviceEpoch((n) => n + 1),
        onDebugInfo: setDebugInfo,
      },
    );
  }

  const deviceRef = useRef<GPUDevice | null>(null);
  const contextRef = useRef<GPUCanvasContext | null>(null);

  // Acquire GPUDevice + canvas context (once per mount / device-lost recovery).
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    if (!enabled) {
      setGpuReady(false);
      setDeviceAcquired(false);
      setDeviceStatus('unsupported');
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!('gpu' in navigator)) {
      console.log('[Renderer] WebGPU API not available');
      setWebgpuAvailable(false);
      setDeviceStatus('unsupported');
      return;
    }

    let cancelled = false;
    const initDevice = async () => {
      try {
        await renderer.initDevice(canvas, glCanvasRef.current, syncCanvasSize, {
          liteMode: !!liteMode,
          isCancelled: () => cancelled,
          deviceEpoch,
        });
        if (cancelled) return;
        deviceRef.current = renderer.device;
        contextRef.current = renderer.context;
      } catch (error) {
        if (cancelled) return;
        if (error instanceof WebGPUInitError && error.message.includes('cancelled')) {
          return;
        }
        const reason = error instanceof Error ? error.message : String(error);
        console.error('[Renderer] WebGPU device init failed:', reason);
        const status = error instanceof WebGPUInitError ? error.status : 'device-failed';
        setDeviceStatus(status);
        setDeviceAcquired(false);
        setWebgpuAvailable(false);
        setDebugInfo((prev) => ({
          ...prev,
          errors: [
            ...prev.errors.filter((e) => !e.startsWith('DEVICE-INIT')),
            `DEVICE-INIT: ${reason}`,
          ],
        }));
      }
    };

    void initDevice();
    return () => {
      cancelled = true;
      setGpuReady(false);
      setDeviceAcquired(false);
      renderer.disposeDevice();
      deviceRef.current = null;
      contextRef.current = null;
    };
  }, [syncCanvasSize, enabled, deviceEpoch, liteMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Shader pipelines + initial pattern buffers (rebuilt on shader switch).
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !enabled || !deviceAcquired) return;

    let cancelled = false;
    setGpuReady(false);
    layoutTypeRef.current = getLayoutType(shaderFile);

    const initShader = async () => {
      try {
        await renderer.initShader(shaderFile, renderParamsRef.current, () => cancelled);
        if (cancelled) return;
        deviceRef.current = renderer.device;
        contextRef.current = renderer.context;
        if (!renderer.isShaderReady()) {
          setGpuReady(false);
          setDebugInfo((prev) => ({
            ...prev,
            errors: [
              ...prev.errors.filter((e) => !e.startsWith('SHADER-INIT')),
              `SHADER-INIT: bind group incomplete for ${shaderFile}`,
            ],
          }));
          return;
        }
        setGpuReady(true);
      } catch (error) {
        if (cancelled) return;
        const reason = error instanceof Error ? error.message : String(error);
        console.error('[Renderer] WebGPU shader init failed:', reason);
        setGpuReady(false);
        setDebugInfo((prev) => ({
          ...prev,
          errors: [
            ...prev.errors.filter((e) => !e.startsWith('SHADER-INIT')),
            `SHADER-INIT: ${reason}`,
          ],
        }));
      }
    };

    void initShader();
    return () => {
      cancelled = true;
      setGpuReady(false);
      renderer.releaseShaderResources();
    };
  }, [shaderFile, deviceAcquired, enabled, liteMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update cells buffer when matrix changes.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !gpuReady) return;
    renderer.updateMatrix(matrix, padTopChannel, renderParamsRef.current);
    deviceRef.current = renderer.device;
    contextRef.current = renderer.context;
  }, [matrix, padTopChannel, gpuReady, shaderFile, liteMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update channel states buffer
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !gpuReady) return;
    renderer.syncChannels(renderParamsRef.current);
  }, [renderParamsRef.current.channels, matrix?.numChannels, padTopChannel, gpuReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const render = useCallback(() => {
    const renderer = rendererRef.current;
    const canvas = canvasRef.current;
    if (!renderer || !canvas) return;
    renderer.renderFrame(canvas, renderParamsRef.current);
    deviceRef.current = renderer.device;
    contextRef.current = renderer.context;
  }, [shaderFile]); // reads renderParamsRef; shaderFile is stable per init cycle

  return { gpuReady, render, deviceRef, deviceStatus, contextRef };
}
