/**
 * PatternDisplay - Refactored main visualization component
 * 
 * Improvements:
 * - Proper error handling and recovery
 * - GPU resource pooling
 * - Modular shader composition
 * - Optimized resize handling
 * - Memory leak prevention
 */

import React, { useRef, useCallback, useState, useEffect, useMemo } from 'react';
import { useWebGPUDevice, WebGPUError } from './DeviceManager';
import { BufferPool, TextureManager } from './ResourcePool';
import { composeShader, shaderPresets, ShaderCache } from './ShaderComposer';
import { useCanvasResize, CanvasSize } from './useCanvasResize';
import { useRenderLoop, FrameTiming } from './useRenderLoop';

// Types
interface PatternDisplayProps {
  className?: string;
  onError?: (error: Error) => void;
  showDebugOverlay?: boolean;
}

interface PatternData {
  rows: Float32Array;
  currentRow: number;
  numChannels: number;
}

interface RenderResources {
  pipeline: GPURenderPipeline;
  bindGroup: GPUBindGroup;
  uniformBuffer: GPUBuffer;
  patternBuffer: GPUBuffer;
  vertexBuffer: GPUBuffer;
  indexBuffer: GPUBuffer;
}

export const PatternDisplay: React.FC<PatternDisplayProps> = ({
  className,
  onError,
  showDebugOverlay: initialShowDebug = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [showDebug, setShowDebug] = useState(initialShowDebug);
  const [patternData, setPatternData] = useState<PatternData | null>(null);
  
  // Resource managers (persist across renders)
  const bufferPoolRef = useRef<BufferPool | null>(null);
  const textureManagerRef = useRef<TextureManager | null>(null);
  const shaderCacheRef = useRef<ShaderCache | null>(null);
  const resourcesRef = useRef<RenderResources | null>(null);
  const uniformDataRef = useRef<ArrayBuffer>(new ArrayBuffer(256));
  
  // Device management
  const { state: deviceState, initialize, retry, destroy } = useWebGPUDevice(canvasRef);

  // Initialize resource managers when device is ready
  useEffect(() => {
    if (deviceState.status === 'ready') {
      const { device } = deviceState;
      
      bufferPoolRef.current = new BufferPool(device, {
        maxPoolSize: 100,
        maxMemoryMB: 64,
      });
      
      textureManagerRef.current = new TextureManager(device, 128);
      shaderCacheRef.current = new ShaderCache(device);
      
      // Initialize device
      initializeDevice();
    }
    
    return () => {
      cleanupResources();
    };
  }, [deviceState.status]);

  // Canvas resize handling
  const handleResize = useCallback((size: CanvasSize) => {
    if (deviceState.status !== 'ready') return;
    
    // Update uniform buffer with new resolution
    updateUniforms({ resolution: [size.width, size.height] });
    
    // Recreate render target if needed
    // (context is automatically resized by configure)
  }, [deviceState.status]);

  const { triggerResize } = useCanvasResize(canvasRef, handleResize, {
    dpr: 'auto',
  });

  // Initialize device and create initial resources
  const initializeDevice = async () => {
    if (deviceState.status !== 'ready') return;
    
    const { device, context } = deviceState;
    
    try {
      // Create vertex data for fullscreen quad
      const vertices = new Float32Array([
        // Position    // UV
        -1, -1,       0, 1,
         1, -1,       1, 1,
         1,  1,       1, 0,
        -1,  1,       0, 0,
      ]);
      
      const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
      
      // Create buffers using pool
      const vertexBuffer = bufferPoolRef.current!.acquireWithData(
        vertices,
        GPUBufferUsage.VERTEX,
        'vertex-buffer'
      );
      
      const indexBuffer = bufferPoolRef.current!.acquireWithData(
        indices,
        GPUBufferUsage.INDEX,
        'index-buffer'
      );
      
      // Create uniform buffer
      const uniformBuffer = bufferPoolRef.current!.acquire(
        256,
        GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        'uniform-buffer'
      );
      
      // Create pattern data buffer
      const patternBuffer = bufferPoolRef.current!.acquire(
        1024 * 16, // 1024 rows * 16 bytes per row
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        'pattern-buffer'
      );
      
      // Create pipeline
      const pipeline = await createPipeline();
      
      // Create bind group
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 3, resource: { buffer: patternBuffer } },
        ],
      });
      
      resourcesRef.current = {
        pipeline,
        bindGroup,
        uniformBuffer,
        patternBuffer,
        vertexBuffer,
        indexBuffer,
      };
      
    } catch (err) {
      console.error('Failed to initialize device:', err);
      onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  };

  // Create render pipeline
  const createPipeline = async (): Promise<GPURenderPipeline> => {
    if (deviceState.status !== 'ready') {
      throw new Error('Device not ready');
    }
    
    const { device } = deviceState;
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    
    // Compose shader
    const { vertex, fragment, layout } = shaderPresets.textured();
    
    // Check required features
    for (const feature of layout.requiredFeatures) {
      if (!device.features.has(feature)) {
        throw new Error(`Required feature not available: ${feature}`);
      }
    }
    
    // Get or create shader modules
    const vertexModule = shaderCacheRef.current!.getOrCreate(
      'vertex-main',
      vertex
    );
    
    const fragmentModule = shaderCacheRef.current!.getOrCreate(
      'fragment-main',
      fragment
    );
    
    // Create bind group layout
    const bindGroupLayout = device.createBindGroupLayout({
      entries: layout.bindings,
    });
    
    // Create pipeline layout
    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    });
    
    // Create pipeline
    return device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: vertexModule,
        entryPoint: 'vs_main',
        buffers: layout.vertexBuffers,
      },
      fragment: {
        module: fragmentModule,
        entryPoint: 'fs_main',
        targets: [{
          format: canvasFormat,
          blend: layout.blendState,
        }],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none',
      },
    });
  };

  // Update uniform buffer
  const updateUniforms = useCallback((updates: Partial<{
    time: number;
    resolution: [number, number];
    rowIndex: number;
  }>) => {
    if (!resourcesRef.current) return;
    
    const view = new DataView(uniformDataRef.current);
    
    if (updates.time !== undefined) {
      view.setFloat32(0, updates.time, true);
    }
    
    if (updates.resolution !== undefined) {
      view.setFloat32(4, updates.resolution[0], true);
      view.setFloat32(8, updates.resolution[1], true);
    }
    
    if (updates.rowIndex !== undefined) {
      view.setUint32(12, updates.rowIndex, true);
    }
    
    // Write to GPU buffer
    const { device } = deviceState as { device: GPUDevice; status: 'ready' };
    device.queue.writeBuffer(
      resourcesRef.current.uniformBuffer,
      0,
      uniformDataRef.current
    );
  }, [deviceState]);

  // Update pattern data
  const updatePatternData = useCallback((data: PatternData) => {
    if (!resourcesRef.current) return;
    
    const { device } = deviceState as { device: GPUDevice; status: 'ready' };
    device.queue.writeBuffer(
      resourcesRef.current.patternBuffer,
      0,
      data.rows
    );
    
    updateUniforms({ rowIndex: data.currentRow });
  }, [deviceState, updateUniforms]);

  // Render function
  const render = useCallback((timing: FrameTiming, encoder: GPUCommandEncoder) => {
    if (deviceState.status !== 'ready' || !resourcesRef.current) return;
    
    const { context } = deviceState;
    const resources = resourcesRef.current;
    
    // Update time uniform
    updateUniforms({ time: timing.elapsedTime });
    
    // Begin render pass
    const renderPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    
    // Set pipeline and bind group
    renderPass.setPipeline(resources.pipeline);
    renderPass.setBindGroup(0, resources.bindGroup);
    
    // Set vertex and index buffers
    renderPass.setVertexBuffer(0, resources.vertexBuffer);
    renderPass.setIndexBuffer(resources.indexBuffer, 'uint16');
    
    // Draw
    renderPass.drawIndexed(6);
    
    renderPass.end();
  }, [deviceState, updateUniforms]);

  // Render loop
  const { 
    isRunning, 
    start, 
    stop, 
    stats,
    error: renderError,
  } = useRenderLoop(render, deviceState.status === 'ready' ? deviceState.device : null, {
    targetFps: 60,
    pauseWhenHidden: true,
    enableStats: showDebug,
  });

  // Start render loop when ready
  useEffect(() => {
    if (deviceState.status === 'ready' && resourcesRef.current && !isRunning) {
      start();
    }
  }, [deviceState.status, isRunning, start]);

  // Cleanup resources
  const cleanupResources = () => {
    stop();
    
    if (resourcesRef.current) {
      const { pipeline, bindGroup, uniformBuffer, patternBuffer, vertexBuffer, indexBuffer } = resourcesRef.current;
      
      // Release buffers back to pool
      bufferPoolRef.current?.release(uniformBuffer);
      bufferPoolRef.current?.release(patternBuffer);
      bufferPoolRef.current?.release(vertexBuffer);
      bufferPoolRef.current?.release(indexBuffer);
      
      // Pipeline doesn't have destroy in WebGPU, but we can drop the reference
      resourcesRef.current = null;
    }
    
    bufferPoolRef.current?.destroy();
    textureManagerRef.current?.destroy();
    shaderCacheRef.current?.clear();
  };

  // Keyboard shortcut for debug overlay
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'd' || e.key === 'D') {
        setShowDebug(prev => !prev);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Initialize on mount
  useEffect(() => {
    initialize();
    
    return () => {
      cleanupResources();
      destroy();
    };
  }, []);

  // Error handling
  useEffect(() => {
    if (deviceState.status === 'error') {
      onError?.(deviceState.error);
    }
  }, [deviceState, onError]);

  // Render error UI
  const renderErrorUI = () => {
    if (deviceState.status !== 'error') return null;
    
    const { error, recoverable } = deviceState;
    
    return (
      <div className="error-overlay">
        <h3>WebGPU Error</h3>
        <p>{error.message}</p>
        {recoverable && (
          <button onClick={() => retry()}>Retry</button>
        )}
      </div>
    );
  };

  // Render debug overlay
  const renderDebugOverlay = () => {
    if (!showDebug) return null;
    
    return (
      <div className="debug-overlay">
        <h4>Debug Info</h4>
        <div>Device Status: {deviceState.status}</div>
        <div>Render Loop: {isRunning ? 'Running' : 'Stopped'}</div>
        {stats && (
          <>
            <div>FPS: {stats.fps}</div>
            <div>Frame Time: {stats.frameTime}ms</div>
          </>
        )}
        {bufferPoolRef.current && (
          <>
            <div>Buffer Pool:</div>
            <pre>{JSON.stringify(bufferPoolRef.current.getStats(), null, 2)}</pre>
          </>
        )}
        {textureManagerRef.current && (
          <>
            <div>Texture Cache:</div>
            <pre>{JSON.stringify(textureManagerRef.current.getStats(), null, 2)}</pre>
          </>
        )}
      </div>
    );
  };

  return (
    <div className={`pattern-display ${className || ''}`}>
      <canvas
        ref={canvasRef}
        className="pattern-canvas"
        style={{ width: '100%', height: '100%' }}
      />
      {renderErrorUI()}
      {renderDebugOverlay()}
    </div>
  );
};

export default PatternDisplay;
