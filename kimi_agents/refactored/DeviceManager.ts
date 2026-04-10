/**
 * DeviceManager - Handles WebGPU device lifecycle with proper error handling
 * and recovery mechanisms.
 */

export type DeviceState = 
  | { status: 'uninitialized' }
  | { status: 'initializing' }
  | { status: 'ready'; device: GPUDevice; adapter: GPUAdapter; context: GPUCanvasContext }
  | { status: 'error'; error: WebGPUError; recoverable: boolean }
  | { status: 'lost'; reason: string };

export class WebGPUError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly recoverable: boolean
  ) {
    super(message);
    this.name = 'WebGPUError';
  }
}

interface DeviceManagerOptions {
  powerPreference?: GPUPowerPreference;
  requiredFeatures?: GPUFeatureName[];
  requiredLimits?: Record<string, number>;
}

export class DeviceManager {
  private state: DeviceState = { status: 'uninitialized' };
  private canvas: HTMLCanvasElement | null = null;
  private listeners: Set<(state: DeviceState) => void> = new Set();
  private lostHandler: ((info: GPUDeviceLostInfo) => void) | null = null;

  get currentState(): DeviceState {
    return this.state;
  }

  subscribe(listener: (state: DeviceState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(newState: DeviceState): void {
    this.state = newState;
    this.listeners.forEach(l => l(newState));
  }

  async initialize(
    canvas: HTMLCanvasElement,
    options: DeviceManagerOptions = {}
  ): Promise<void> {
    if (this.state.status === 'initializing') {
      throw new WebGPUError(
        'Device initialization already in progress',
        'ALREADY_INITIALIZING',
        true
      );
    }

    this.setState({ status: 'initializing' });
    this.canvas = canvas;

    try {
      // Check WebGPU availability
      if (!navigator.gpu) {
        throw new WebGPUError(
          'WebGPU is not supported in this browser. Please use Chrome 113+, Edge 113+, or Firefox Nightly.',
          'NOT_SUPPORTED',
          false
        );
      }

      // Request adapter
      const adapter = await navigator.gpu.requestAdapter({
        powerPreference: options.powerPreference ?? 'high-performance',
      });

      if (!adapter) {
        throw new WebGPUError(
          'No suitable GPU adapter found. This may be due to hardware limitations or driver issues.',
          'NO_ADAPTER',
          true
        );
      }

      // Check required features
      const missingFeatures = (options.requiredFeatures || [])
        .filter(f => !adapter.features.has(f));
      
      if (missingFeatures.length > 0) {
        throw new WebGPUError(
          `Required GPU features not available: ${missingFeatures.join(', ')}`,
          'MISSING_FEATURES',
          false
        );
      }

      // Request device
      const device = await adapter.requestDevice({
        requiredFeatures: options.requiredFeatures,
        requiredLimits: options.requiredLimits,
      });

      // Get canvas context
      const context = canvas.getContext('webgpu');
      if (!context) {
        throw new WebGPUError(
          'Failed to get WebGPU canvas context',
          'CONTEXT_FAILED',
          true
        );
      }

      // Configure context
      const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
      context.configure({
        device,
        format: canvasFormat,
        alphaMode: 'premultiplied',
      });

      // Set up device lost handler
      this.lostHandler = (info) => {
        console.error('WebGPU device lost:', info.reason, info.message);
        this.setState({ status: 'lost', reason: info.reason });
        
        // Attempt recovery if not intentional
        if (info.reason !== 'destroyed') {
          setTimeout(() => {
            if (this.canvas) {
              this.initialize(this.canvas, options).catch(console.error);
            }
          }, 1000);
        }
      };
      device.lost.then(this.lostHandler);

      this.setState({ status: 'ready', device, adapter, context });

    } catch (error) {
      const webgpuError = error instanceof WebGPUError 
        ? error 
        : new WebGPUError(
            error instanceof Error ? error.message : 'Unknown error',
            'UNKNOWN',
            true
          );
      
      this.setState({ 
        status: 'error', 
        error: webgpuError,
        recoverable: webgpuError.recoverable 
      });
      
      throw webgpuError;
    }
  }

  destroy(): void {
    if (this.state.status === 'ready') {
      // Clean up device
      this.state.device.destroy();
    }
    this.canvas = null;
    this.setState({ status: 'uninitialized' });
  }
}

// React hook for using DeviceManager
import { useEffect, useRef, useState, useCallback } from 'react';

export function useWebGPUDevice(canvasRef: React.RefObject<HTMLCanvasElement>) {
  const managerRef = useRef(new DeviceManager());
  const [state, setState] = useState<DeviceState>({ status: 'uninitialized' });

  useEffect(() => {
    return managerRef.current.subscribe(setState);
  }, []);

  const initialize = useCallback(async (options?: DeviceManagerOptions) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      throw new Error('Canvas not available');
    }
    await managerRef.current.initialize(canvas, options);
  }, [canvasRef]);

  const retry = useCallback(async (options?: DeviceManagerOptions) => {
    if (state.status === 'error' && state.recoverable) {
      await initialize(options);
    }
  }, [state, initialize]);

  return {
    state,
    initialize,
    retry,
    destroy: () => managerRef.current.destroy(),
  };
}
