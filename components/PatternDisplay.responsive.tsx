// Responsive PatternDisplay
// Handles all screen sizes from mobile to 4K
// Fixes: WebGL cleanup when switching modes

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { ChannelShadowState, PatternMatrix } from '../types';

// Breakpoint definitions
const BREAKPOINTS = {
  mobile: 768,
  tablet: 1024,
  desktop: 1440,
} as const;

type Breakpoint = 'mobile' | 'tablet' | 'desktop' | 'wide';

// Device capability detection
interface DeviceCapabilities {
  isTouch: boolean;
  isLowPower: boolean;
  prefersReducedMotion: boolean;
  pixelRatio: number;
  maxTextureSize: number;
}

// Responsive settings
interface ResponsiveSettings {
  breakpoint: Breakpoint;
  isLandscape: boolean;
  scaleFactor: number;
  quality: 'low' | 'medium' | 'high' | 'ultra';
  showSidePanels: boolean;
  showFullscreenButton: boolean;
  touchControls: boolean;
}

interface PatternDisplayResponsiveProps {
  matrix: PatternMatrix | null;
  playheadRow: number;
  isPlaying: boolean;
  bpm: number;
  timeSec: number;
  tickOffset: number;
  channels: ChannelShadowState[];
  beatPhase: number;
  grooveAmount: number;
  kickTrigger: number;
  activeChannels: number[];
  isModuleLoaded: boolean;
  shaderFile?: string;
  volume?: number;
  pan?: number;
  isLooping?: boolean;
  onPlay?: () => void;
  onStop?: () => void;
  onFileSelected?: (file: File) => void;
  onLoopToggle?: () => void;
  onSeek?: (row: number) => void;
  onVolumeChange?: (volume: number) => void;
  onPanChange?: (pan: number) => void;
  dimFactor?: number;
}

// Hook for breakpoint detection
const useBreakpoint = (): Breakpoint => {
  const [breakpoint, setBreakpoint] = useState<Breakpoint>('desktop');

  useEffect(() => {
    const updateBreakpoint = () => {
      const width = window.innerWidth;
      if (width < BREAKPOINTS.mobile) setBreakpoint('mobile');
      else if (width < BREAKPOINTS.tablet) setBreakpoint('tablet');
      else if (width < BREAKPOINTS.desktop) setBreakpoint('desktop');
      else setBreakpoint('wide');
    };

    updateBreakpoint();
    window.addEventListener('resize', updateBreakpoint);
    return () => window.removeEventListener('resize', updateBreakpoint);
  }, []);

  return breakpoint;
};

// Hook for device capabilities
const useDeviceCapabilities = (): DeviceCapabilities => {
  return useMemo(() => ({
    isTouch: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
    isLowPower: navigator.userAgent.includes('Android') || navigator.userAgent.includes('Mobile'),
    prefersReducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    maxTextureSize: 4096, // Will be updated after WebGPU init
  }), []);
};

// Hook for orientation
const useOrientation = (): boolean => {
  const [isLandscape, setIsLandscape] = useState(
    window.innerWidth > window.innerHeight
  );

  useEffect(() => {
    const updateOrientation = () => {
      setIsLandscape(window.innerWidth > window.innerHeight);
    };

    window.addEventListener('resize', updateOrientation);
    window.addEventListener('orientationchange', updateOrientation);

    return () => {
      window.removeEventListener('resize', updateOrientation);
      window.removeEventListener('orientationchange', updateOrientation);
    };
  }, []);

  return isLandscape;
};

export const PatternDisplayResponsive: React.FC<PatternDisplayResponsiveProps> = (props) => {
  const {
    matrix: _matrix,
    playheadRow: _playheadRow,
    isPlaying,
    bpm: _bpm,
    timeSec: _timeSec,
    tickOffset: _tickOffset,
    channels: _channels,
    beatPhase: _beatPhase,
    grooveAmount: _grooveAmount,
    kickTrigger: _kickTrigger,
    activeChannels: _activeChannels,
    isModuleLoaded: _isModuleLoaded,
    shaderFile = 'patternv0.40.wgsl',
    dimFactor: _dimFactor,
  } = props;

  const breakpoint = useBreakpoint();
  const isLandscape = useOrientation();
  const deviceCaps = useDeviceCapabilities();

  // Refs for cleanup
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // WebGPU/WebGL refs
  const deviceRef = useRef<GPUDevice | null>(null);
  const contextRef = useRef<GPUCanvasContext | null>(null);
  const glContextRef = useRef<WebGL2RenderingContext | null>(null);
  const glResourcesRef = useRef<any>(null);
  const pipelineRef = useRef<GPURenderPipeline | null>(null);
  const bindGroupRef = useRef<GPUBindGroup | null>(null);
  const uniformBufferRef = useRef<GPUBuffer | null>(null);

  // State
  const [gpuReady, setGpuReady] = useState(false);
  const [webgpuAvailable, setWebgpuAvailable] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);

  // Track current shader for cleanup
  const currentShaderRef = useRef<string>(shaderFile);

  // Calculate responsive settings
  const settings = useMemo((): ResponsiveSettings => {
    const baseQuality = deviceCaps.isLowPower ? 'low' :
                       breakpoint === 'mobile' ? 'medium' :
                       breakpoint === 'tablet' ? 'high' : 'ultra';

    return {
      breakpoint,
      isLandscape,
      scaleFactor: breakpoint === 'mobile' ? 0.7 :
                   breakpoint === 'tablet' ? 0.85 : 1.0,
      quality: baseQuality,
      showSidePanels: breakpoint !== 'mobile',
      showFullscreenButton: true,
      touchControls: deviceCaps.isTouch,
    };
  }, [breakpoint, isLandscape, deviceCaps]);

  // Calculate canvas size based on breakpoint
  const canvasSize = useMemo(() => {
    const baseWidth = breakpoint === 'mobile' ? 320 :
                      breakpoint === 'tablet' ? 768 :
                      breakpoint === 'desktop' ? 1024 : 1440;

    const baseHeight = isLandscape ? baseWidth * 0.75 : baseWidth * 1.33;

    return {
      width: Math.floor(baseWidth * settings.scaleFactor),
      height: Math.floor(baseHeight * settings.scaleFactor),
      dpr: deviceCaps.pixelRatio,
    };
  }, [breakpoint, isLandscape, settings.scaleFactor, deviceCaps.pixelRatio]);

  // Cleanup WebGL resources properly
  const cleanupWebGL = useCallback(() => {
    if (glContextRef.current && glResourcesRef.current) {
      const gl = glContextRef.current;
      const res = glResourcesRef.current;

      try {
        gl.deleteProgram(res.program);
        gl.deleteVertexArray(res.vao);
        gl.deleteBuffer(res.buffer);
        gl.deleteTexture(res.texture);
        if (res.capTexture) gl.deleteTexture(res.capTexture);
        console.log('[Responsive] WebGL resources cleaned up');
      } catch (e) {
        console.warn('[Responsive] Error cleaning WebGL:', e);
      }

      glResourcesRef.current = null;
    }
  }, []);

  // Cleanup WebGPU resources
  const cleanupWebGPU = useCallback(() => {
    pipelineRef.current = null;
    bindGroupRef.current = null;
    if (uniformBufferRef.current) {
      uniformBufferRef.current.destroy();
      uniformBufferRef.current = null;
    }
  }, []);

  // Full cleanup on shader change
  useEffect(() => {
    if (currentShaderRef.current !== shaderFile) {
      console.log(`[Responsive] Shader changed: ${currentShaderRef.current} -> ${shaderFile}`);
      cleanupWebGL();
      cleanupWebGPU();
      currentShaderRef.current = shaderFile;
    }
  }, [shaderFile, cleanupWebGL, cleanupWebGPU]);

  // Initialize WebGPU/WebGL
  useEffect(() => {
    if (!canvasRef.current) return;

    let cancelled = false;

    const init = async () => {
      try {
        // Try WebGPU first
        if ('gpu' in navigator) {
          const adapter = await navigator.gpu.requestAdapter();
          if (adapter && !cancelled) {
            const device = await adapter.requestDevice();
            const context = canvasRef.current!.getContext('webgpu');

            if (context && !cancelled) {
              const format = navigator.gpu.getPreferredCanvasFormat();
              context.configure({
                device,
                format,
                alphaMode: 'premultiplied'
              });

              deviceRef.current = device;
              contextRef.current = context;
              setGpuReady(true);
              setWebgpuAvailable(true);
              return;
            }
          }
        }

        // Fallback to WebGL2
        if (!cancelled) {
          const gl = canvasRef.current!.getContext('webgl2', {
            alpha: true,
            premultipliedAlpha: false
          });

          if (gl) {
            glContextRef.current = gl;
            setWebgpuAvailable(false);
            setGpuReady(true);
          }
        }
      } catch (err) {
        console.error('[Responsive] Graphics init failed:', err);
        setWebgpuAvailable(false);
      }
    };

    init();

    return () => {
      cancelled = true;
      cleanupWebGL();
      cleanupWebGPU();
    };
  }, [cleanupWebGL, cleanupWebGPU]);

  // Handle resize
  useEffect(() => {
    if (!canvasRef.current || !gpuReady) return;

    const canvas = canvasRef.current;
    const { width, height, dpr } = canvasSize;

    // Set actual canvas buffer size
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);

    // Set CSS display size
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    // Reconfigure WebGPU context if needed
    if (contextRef.current && deviceRef.current) {
      try {
        contextRef.current.configure({
          device: deviceRef.current,
          format: navigator.gpu.getPreferredCanvasFormat(),
          alphaMode: 'premultiplied'
        });
      } catch (e) {
        console.error('[Responsive] Context reconfigure failed:', e);
      }
    }
  }, [canvasSize, gpuReady]);

  // Fullscreen toggle
  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;

    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => {
        setIsFullscreen(true);
        setShowControls(false);
      });
    } else {
      document.exitFullscreen().then(() => {
        setIsFullscreen(false);
        setShowControls(true);
      });
    }
  }, []);

  // Show controls on mouse move in fullscreen
  useEffect(() => {
    if (!isFullscreen) return;

    let timeout: number;
    const showOnMove = () => {
      setShowControls(true);
      clearTimeout(timeout);
      timeout = window.setTimeout(() => setShowControls(false), 3000);
    };

    window.addEventListener('mousemove', showOnMove);
    window.addEventListener('touchstart', showOnMove);

    return () => {
      window.removeEventListener('mousemove', showOnMove);
      window.removeEventListener('touchstart', showOnMove);
      clearTimeout(timeout);
    };
  }, [isFullscreen]);

  return (
    <div
      ref={containerRef}
      className={`
        relative w-full h-full flex flex-col
        ${breakpoint === 'mobile' ? 'touch-manipulation' : ''}
        ${isFullscreen ? 'bg-black' : ''}
      `}
    >
      {/* Main Canvas Container */}
      <div className={`
        relative flex-1 flex items-center justify-center
        overflow-hidden
        ${breakpoint === 'mobile' && !isLandscape ? 'aspect-[3/4]' : ''}
        ${breakpoint === 'mobile' && isLandscape ? 'aspect-video' : ''}
      `}>
        {/* WebGPU/WebGL Canvas */}
        <canvas
          ref={canvasRef}
          className="max-w-full max-h-full object-contain"
          style={{
            imageRendering: settings.quality === 'low' ? 'auto' : 'crisp-edges',
          }}
        />

        {/* WebGL Overlay Canvas (for glass effects) */}
        <canvas
          ref={glCanvasRef}
          className="absolute inset-0 pointer-events-none max-w-full max-h-full"
          style={{ opacity: gpuReady ? 1 : 0 }}
        />

        {/* Loading State */}
        {!gpuReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <div className="text-white font-mono animate-pulse">
              Initializing Graphics...
            </div>
          </div>
        )}

        {/* Fullscreen Button */}
        {settings.showFullscreenButton && (
          <button
            onClick={toggleFullscreen}
            className="absolute top-2 right-2 p-2 bg-black/50 text-white rounded hover:bg-black/70 transition-colors"
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {isFullscreen ? '⛶' : '⛶'}
          </button>
        )}
      </div>

      {/* Mobile Bottom Sheet Controls */}
      {settings.touchControls && breakpoint === 'mobile' && showControls && (
        <div className={`
          absolute bottom-0 left-0 right-0
          bg-black/90 backdrop-blur-sm
          p-4 rounded-t-xl
          transform transition-transform
          ${showControls ? 'translate-y-0' : 'translate-y-full'}
        `}>
          <div className="flex items-center justify-between">
            <button
              onClick={props.onPlay}
              className="px-4 py-2 bg-cyan-600 text-white rounded font-mono"
            >
              {isPlaying ? '⏸' : '▶'}
            </button>

            <button
              onClick={props.onStop}
              className="px-4 py-2 bg-red-600 text-white rounded font-mono"
            >
              ⏹
            </button>

            <button
              onClick={props.onLoopToggle}
              className={`px-4 py-2 rounded font-mono ${
                props.isLooping ? 'bg-green-600' : 'bg-gray-600'
              } text-white`}
            >
              🔁
            </button>
          </div>
        </div>
      )}

      {/* Quality Indicator (dev mode) */}
      {/* @ts-expect-error - process may not be defined in browser */}
      {typeof process !== 'undefined' && process.env?.NODE_ENV === 'development' && (
        <div className="absolute top-2 left-2 bg-black/50 text-white text-xs font-mono p-2 rounded">
          <div>BP: {breakpoint}</div>
          <div>Quality: {settings.quality}</div>
          <div>DPR: {deviceCaps.pixelRatio}</div>
          <div>WebGPU: {webgpuAvailable ? 'Yes' : 'No'}</div>
        </div>
      )}
    </div>
  );
};

export default PatternDisplayResponsive;
