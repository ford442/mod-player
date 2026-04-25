import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { ChannelShadowState, PatternMatrix, PlaybackState } from '../types';

import { useWebGLOverlay } from '../hooks/useWebGLOverlay';
import { useWebGPURender, type WebGPURenderParams, type DebugInfo } from '../hooks/useWebGPURender';

const DEFAULT_CHANNELS = 4;

interface PatternDisplayProps {
  matrix: PatternMatrix | null;
  playheadRow: number;
  cellWidth?: number;
  cellHeight?: number;
  shaderFile?: string;
  isPlaying?: boolean;
  bpm?: number;
  timeSec?: number;
  tickOffset?: number;
  channels?: ChannelShadowState[];
  beatPhase?: number;
  grooveAmount?: number;
  kickTrigger?: number;
  activeChannels?: number[];
  isModuleLoaded?: boolean;
  externalVideoSource?: HTMLVideoElement | HTMLImageElement | null;
  bloomIntensity?: number;
  bloomThreshold?: number;
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
  totalRows?: number;
  dimFactor?: number;
  analyserNode?: AnalyserNode | null;
  playbackStateRef?: React.MutableRefObject<PlaybackState>;
  debugPanelOpen?: boolean;
  onCloseDebug?: () => void;
  onOpenDebug?: () => void;
  colorPalette?: number;
}

export const PatternDisplay: React.FC<PatternDisplayProps> = ({
  matrix,
  playheadRow,
  cellWidth = 120,
  cellHeight = 24,
  shaderFile = 'patternv0.40.wgsl',
  isPlaying = false,
  bpm = 120,
  timeSec = 0,
  tickOffset = 0,
  channels = [],
  beatPhase = 0.0,
  grooveAmount = 0.5,
  kickTrigger = 0.0,
  activeChannels = [],
  isModuleLoaded = false,
  externalVideoSource = null,
  bloomIntensity = 1.0,
  bloomThreshold = 0.8,
  volume = 0.5,
  pan = 0.0,
  isLooping = false,
  onPlay,
  onStop,
  onFileSelected,
  onLoopToggle,
  onSeek,
  onVolumeChange,
  onPanChange,
  totalRows,
  dimFactor = 1.0,
  analyserNode,
  playbackStateRef,
  debugPanelOpen = false,
  onCloseDebug,
  onOpenDebug,
  colorPalette = 0,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [webgpuAvailable, setWebgpuAvailable] = useState(true);
  const [localTime, setLocalTime] = useState(0);
  const [invertChannels, setInvertChannels] = useState(false);
  const [stepsLength, setStepsLength] = useState<32 | 64>(32);
  const [clickedButton, setClickedButton] = useState<number>(0);
  const clickTimeoutRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number>();
  const freqDataRef = useRef(new Uint8Array(256));
  const canvasSizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  const resizeTimeoutRef = useRef<number | null>(null);

  const [debugInfo, setDebugInfo] = useState<DebugInfo>({
    layoutMode: 'NONE',
    errors: [],
    uniforms: {},
  });

  const numChannels = matrix?.numChannels ?? DEFAULT_CHANNELS;

  const isOverlayActive = shaderFile.includes('v0.21') || shaderFile.includes('v0.38') || shaderFile.includes('v0.39') || shaderFile.includes('v0.40') || shaderFile.includes('v0.42') || shaderFile.includes('v0.43') || shaderFile.includes('v0.44') || shaderFile.includes('v0.45') || shaderFile.includes('v0.46') || shaderFile.includes('v0.47') || shaderFile.includes('v0.48') || shaderFile.includes('v0.49') || shaderFile.includes('v0.50');

  const padTopChannel = shaderFile.includes('v0.16') || shaderFile.includes('v0.17') || shaderFile.includes('v0.21') || shaderFile.includes('v0.38') || shaderFile.includes('v0.39') || shaderFile.includes('v0.40') || shaderFile.includes('v0.42') || shaderFile.includes('v0.43') || shaderFile.includes('v0.44') || shaderFile.includes('v0.45') || shaderFile.includes('v0.46') || shaderFile.includes('v0.47') || shaderFile.includes('v0.48') || shaderFile.includes('v0.49') || shaderFile.includes('v0.50');

  const isHorizontal = shaderFile.includes('v0.13') || shaderFile.includes('v0.14') || shaderFile.includes('v0.16') || shaderFile.includes('v0.17') || shaderFile.includes('v0.21') || shaderFile.includes('v0.39') || shaderFile.includes('v0.40');

  const canvasMetrics = useMemo(() => {
    if (shaderFile.includes('v0.27') || shaderFile.includes('v0.28')) return { width: 1024, height: 1008 };
    if (shaderFile.includes('v0.21') || shaderFile.includes('v0.37') || shaderFile.includes('v0.38') || shaderFile.includes('v0.39') || shaderFile.includes('v0.40') || shaderFile.includes('v0.42') || shaderFile.includes('v0.43') || shaderFile.includes('v0.44') || shaderFile.includes('v0.45') || shaderFile.includes('v0.46') || shaderFile.includes('v0.47') || shaderFile.includes('v0.48') || shaderFile.includes('v0.49') || shaderFile.includes('v0.50')) return { width: 1024, height: 1024 };
    if (isHorizontal) return { width: 1024, height: 1024 };
    if (shaderFile.includes('v0.25') || shaderFile.includes('v0.30') || shaderFile.includes('v0.35')) return { width: 1024, height: 1024 };
    return { width: Math.max(800, numChannels * cellWidth), height: 600 };
  }, [shaderFile, isHorizontal, numChannels, cellWidth]);

  // Reset step length when switching to a shader that doesn't support it
  useEffect(() => {
    if (!shaderFile.includes('v0.21') && !shaderFile.includes('v0.39') && !shaderFile.includes('v0.40')) {
      setStepsLength(32);
    }
  }, [shaderFile]);

  // Track video source changes
  useEffect(() => {
    // externalVideoSource is read from renderParamsRef on each frame
  }, [externalVideoSource]);

  // Canvas resize handling
  const syncCanvasSize = useCallback((canvas: HTMLCanvasElement, glCanvas: HTMLCanvasElement | null) => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const containerWidth = containerRect.width;
    const containerHeight = containerRect.height;
    const aspectRatio = canvasMetrics.width / canvasMetrics.height;
    let displayWidth = containerWidth;
    let displayHeight = containerHeight;
    const containerAspect = containerWidth / containerHeight;
    if (containerAspect > aspectRatio) {
      displayWidth = containerHeight * aspectRatio;
    } else {
      displayHeight = containerWidth / aspectRatio;
    }
    displayWidth = Math.floor(displayWidth);
    displayHeight = Math.floor(displayHeight);
    const bufferWidth = Math.max(1, Math.floor(displayWidth * dpr));
    const bufferHeight = Math.max(1, Math.floor(displayHeight * dpr));
    if (canvas.width !== bufferWidth || canvas.height !== bufferHeight) {
      canvas.width = bufferWidth;
      canvas.height = bufferHeight;
      canvasSizeRef.current = { width: bufferWidth, height: bufferHeight, dpr };
      console.log(`🖥️ Canvas resized: ${displayWidth}x${displayHeight} (buffer: ${bufferWidth}x${bufferHeight}, DPR: ${dpr})`);
    }
    if (glCanvas) {
      if (glCanvas.width !== bufferWidth || glCanvas.height !== bufferHeight) {
        glCanvas.width = bufferWidth;
        glCanvas.height = bufferHeight;
      }
    }
  }, [canvasMetrics]);

  const handleResize = useCallback(() => {
    const canvas = canvasRef.current;
    const glCanvas = glCanvasRef.current;
    if (!canvas) return;
    if (resizeTimeoutRef.current !== null) window.clearTimeout(resizeTimeoutRef.current);
    resizeTimeoutRef.current = window.setTimeout(() => {
      syncCanvasSize(canvas, glCanvas);
      if (gpuContextRef.current && gpuDeviceRef.current) {
        try {
          gpuContextRef.current.configure({
            device: gpuDeviceRef.current,
            format: navigator.gpu.getPreferredCanvasFormat(),
            alphaMode: 'premultiplied'
          });
        } catch (e) {
          console.error('❌ WebGPU context reconfiguration failed:', e);
        }
      }
      resizeTimeoutRef.current = null;
    }, 100);
  }, [syncCanvasSize]);

  // Expose GPU device/context refs for resize reconfiguration
  const gpuDeviceRef = useRef<GPUDevice | null>(null);
  const gpuContextRef = useRef<GPUCanvasContext | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    syncCanvasSize(canvas, glCanvasRef.current);
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => handleResize());
    });
    resizeObserver.observe(container);
    const handleWindowResize = () => handleResize();
    window.addEventListener('resize', handleWindowResize);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleWindowResize);
      if (resizeTimeoutRef.current !== null) window.clearTimeout(resizeTimeoutRef.current);
    };
  }, [handleResize, syncCanvasSize]);

  // Build render params ref — updated every render, read by hooks without stale closures
  const renderParamsRef = useRef<WebGPURenderParams>({
    matrix, channels, padTopChannel, isPlaying, bpm, timeSec, tickOffset,
    beatPhase, grooveAmount, kickTrigger, activeChannels, isModuleLoaded,
    bloomIntensity, bloomThreshold, dimFactor, volume, pan, isLooping,
    invertChannels, clickedButton, cellWidth, cellHeight, playheadRow,
    localTime, isHorizontal, externalVideoSource,
    canvasMetrics,
    colorPalette,
    stepsLength,
    ...(totalRows !== undefined ? { totalRows } : {}),
    ...(playbackStateRef ? { playbackStateRef } : {}),
  });
  renderParamsRef.current = {
    matrix, channels, padTopChannel, isPlaying, bpm, timeSec, tickOffset,
    beatPhase, grooveAmount, kickTrigger, activeChannels, isModuleLoaded,
    bloomIntensity, bloomThreshold, dimFactor, volume, pan, isLooping,
    invertChannels, clickedButton, cellWidth, cellHeight, playheadRow,
    localTime, isHorizontal, externalVideoSource,
    canvasMetrics,
    colorPalette,
    stepsLength,
    ...(totalRows !== undefined ? { totalRows } : {}),
    ...(playbackStateRef ? { playbackStateRef } : {}),
  };

  // WebGL overlay hook (frosted caps)
  const { drawWebGL } = useWebGLOverlay(glCanvasRef, {
    shaderFile, matrix, padTopChannel, isOverlayActive,
    invertChannels, playheadRow, cellWidth, cellHeight,
    channels, bloomIntensity, stepsLength,
    ...(playbackStateRef ? { playbackStateRef } : {}),
  }, setDebugInfo);

  // WebGPU render hook — matrix and padTopChannel passed directly so React tracks them as
  // explicit deps, guaranteeing the cells buffer is rebuilt when a new module is loaded.
  const { gpuReady, render, deviceRef: gpuDevRef } = useWebGPURender(
    canvasRef, glCanvasRef, shaderFile,
    syncCanvasSize, renderParamsRef, matrix, padTopChannel, setDebugInfo, setWebgpuAvailable
  );

  // Keep resize reconfiguration refs in sync
  useEffect(() => {
    gpuDeviceRef.current = gpuDevRef.current;
  });

  // Canvas click handler for shader-embedded UI interaction
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!shaderFile.includes('v0.37') && !shaderFile.includes('v0.38') && !shaderFile.includes('v0.39') && !shaderFile.includes('v0.40') && !shaderFile.includes('v0.42') && !shaderFile.includes('v0.43') && !shaderFile.includes('v0.44') && !shaderFile.includes('v0.45') && !shaderFile.includes('v0.46')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const pX = (x / rect.width) - 0.5;
    const pY = 0.5 - (y / rect.height);

    const isV40 = shaderFile.includes('v0.40') || shaderFile.includes('v0.43') || shaderFile.includes('v0.44') || shaderFile.includes('v0.45') || shaderFile.includes('v0.46');

    const flashButton = (buttonId: number) => {
      if (clickTimeoutRef.current !== null) window.clearTimeout(clickTimeoutRef.current);
      setClickedButton(buttonId);
      clickTimeoutRef.current = window.setTimeout(() => { setClickedButton(0); clickTimeoutRef.current = null; }, 200) as number;
    };

    if (Math.abs(pX - 0.26) < 0.05 && Math.abs(pY - 0.42) < 0.05) {
      flashButton(2); fileInputRef.current?.click(); return;
    }
    if (Math.abs(pX + 0.26) < 0.05 && Math.abs(pY - 0.42) < 0.05) {
      flashButton(1); onLoopToggle?.(); return;
    }
    if (Math.abs(pY - 0.32) < 0.04) {
      if (Math.abs(pX + 0.12) < 0.04) { flashButton(5); if (onSeek) onSeek(Math.max(0, playheadRow - 16)); return; }
      if (Math.abs(pX - 0.12) < 0.04) { flashButton(6); if (onSeek) onSeek(playheadRow + 16); return; }
    }
    const volSliderX = isV40 ? 0.08 : 0.28;
    const volSliderY = 0.415;
    const volSliderW = 0.18;
    const volSliderH = 0.05;
    if (Math.abs(pX - volSliderX) < volSliderW * 0.5 && Math.abs(pY - volSliderY) < volSliderH * 0.5) {
      const relX = (pX - volSliderX) / (volSliderW * 0.9);
      onVolumeChange?.(Math.max(0, Math.min(1, relX + 0.5))); return;
    }
    const sliderRightX = 0.42, sliderY = -0.2, sliderH = 0.2, sliderClickRadius = 0.03;
    if (Math.abs(pX - sliderRightX) < sliderClickRadius && Math.abs(pY - sliderY) < sliderH * 0.5) {
      const panValue = (pY - sliderY) / (sliderH * 0.45);
      onPanChange?.(Math.max(-1, Math.min(1, panValue))); return;
    }
    const barY = -0.45, barWidth = 0.6, barCenterX = 0.1, barHeight = 0.03;
    if (Math.abs(pY - barY) < barHeight && Math.abs(pX - barCenterX) < barWidth / 2) {
      const relX = pX - (barCenterX - barWidth / 2);
      if (onSeek) onSeek(Math.floor(Math.max(0, Math.min(1, relX / barWidth)) * (totalRows || 64)));
      return;
    }
    const btnRadius = 0.045;
    const dist = (x1: number, y1: number, x2: number, y2: number) => Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
    const playY = isV40 ? -0.45 : -0.40;
    const stopY = isV40 ? -0.45 : -0.40;
    if (dist(pX, pY, -0.44, playY) < btnRadius) { flashButton(3); onPlay?.(); return; }
    if (dist(pX, pY, -0.35, stopY) < btnRadius) { flashButton(4); onStop?.(); return; }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) onFileSelected?.(selectedFile);
  };

  // Keep renderRef pointing to latest render so RAF loop never uses stale closure
  const renderRef = useRef<() => void>();
  useEffect(() => {
    renderRef.current = render;
  });

  // Animation RAF loop
  useEffect(() => {
    let isActive = true;
    const loop = (time: number) => {
      if (!isActive) return;
      animationFrameRef.current = requestAnimationFrame(loop);
      if (!isModuleLoaded && !isPlaying) setLocalTime(time / 1000.0);
      if (analyserNode) {
        if (freqDataRef.current.length !== analyserNode.frequencyBinCount) {
          freqDataRef.current = new Uint8Array(analyserNode.frequencyBinCount);
        }
        analyserNode.getByteFrequencyData(freqDataRef.current);
      }
      if (gpuReady) {
        renderRef.current?.();
        drawWebGL();
      }
    };
    animationFrameRef.current = requestAnimationFrame(loop);
    return () => {
      isActive = false;
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isModuleLoaded, isPlaying, gpuReady, drawWebGL]);

  return (
    <div
      ref={containerRef}
      className={`pattern-display relative ${padTopChannel && !shaderFile.includes('v0.40') && !shaderFile.includes('v0.43') && !shaderFile.includes('v0.44') ? 'p-8 rounded-xl bg-[#18181a] shadow-2xl border border-[#333]' : ''}`}
      style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
    >
      <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".mod,.xm,.it,.s3m,.mptm" />
      {padTopChannel && (
        <>
          <div className="absolute top-0 bottom-0 left-0 w-8 bg-[#111] border-r border-[#000] flex flex-col justify-between py-4 items-center rounded-l-xl">
            <div className="w-3 h-3 rounded-full bg-[#222] border border-[#444] shadow-inner flex items-center justify-center"><div className="w-2 h-0.5 bg-[#111] rotate-45"></div></div>
            <div className="w-3 h-3 rounded-full bg-[#222] border border-[#444] shadow-inner flex items-center justify-center"><div className="w-2 h-0.5 bg-[#111] rotate-45"></div></div>
          </div>
          <div className="absolute top-0 bottom-0 right-0 w-8 bg-[#111] border-l border-[#000] flex flex-col justify-between py-4 items-center rounded-r-xl">
            <div className="w-3 h-3 rounded-full bg-[#222] border border-[#444] shadow-inner flex items-center justify-center"><div className="w-2 h-0.5 bg-[#111] rotate-45"></div></div>
            <div className="w-3 h-3 rounded-full bg-[#222] border border-[#444] shadow-inner flex items-center justify-center"><div className="w-2 h-0.5 bg-[#111] rotate-45"></div></div>
          </div>
          <div className="absolute top-2 right-12 flex items-center gap-3">
            <div className="text-[10px] font-mono font-bold text-gray-500 tracking-widest uppercase opacity-70">Tracker GPU-9000</div>
            <div className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(255,50,50,0.8)]"></div>
          </div>
        </>
      )}

      {(shaderFile.includes('v0.35') || shaderFile.includes('v0.37') || shaderFile.includes('v0.38') || shaderFile.includes('v0.39') || shaderFile.includes('v0.40') || shaderFile.includes('v0.43') || shaderFile.includes('v0.44')) && (
        <button
          onClick={() => setInvertChannels(p => !p)}
          className="absolute top-2 left-12 px-2 py-1 bg-[#222] text-xs font-mono text-gray-400 border border-[#444] rounded hover:bg-[#333] hover:text-white transition-colors"
        >
          {invertChannels ? '[INNER LOW]' : '[OUTER LOW]'}
        </button>
      )}

      {(shaderFile.includes('v0.21') || shaderFile.includes('v0.39') || shaderFile.includes('v0.40')) && (
        <button
          onClick={() => setStepsLength(s => s === 32 ? 64 : 32)}
          className="absolute top-2 left-36 px-2 py-1 bg-[#222] text-xs font-mono text-gray-400 border border-[#444] rounded hover:bg-[#333] hover:text-white transition-colors"
        >
          [{stepsLength} STEPS]
        </button>
      )}

      <canvas
        ref={canvasRef}
        width={canvasMetrics.width}
        height={canvasMetrics.height}
        onClick={handleCanvasClick}
        className={`${padTopChannel && !shaderFile.includes('v0.40') && !shaderFile.includes('v0.43') && !shaderFile.includes('v0.44') ? 'rounded bg-black shadow-inner border border-black/50' : ''} cursor-pointer`}
        style={{ width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '100%', aspectRatio: `${canvasMetrics.width} / ${canvasMetrics.height}`, objectFit: 'contain', position: 'relative' }}
      />
      <canvas
        ref={glCanvasRef}
        width={canvasMetrics.width}
        height={canvasMetrics.height}
        className="absolute top-0 left-0 pointer-events-none"
        style={{ width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '100%', aspectRatio: `${canvasMetrics.width} / ${canvasMetrics.height}`, objectFit: 'contain', zIndex: 2, position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', display: isOverlayActive ? 'block' : 'none' }}
      />

      {!webgpuAvailable && <div className="error">WebGPU not available in this browser.</div>}

      {!debugPanelOpen && (
        <button
          onClick={onOpenDebug}
          className="fixed top-4 right-4 z-50 rounded-full border border-green-500/40 bg-black/80 px-3 py-1 text-sm text-green-300 shadow-lg hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400"
          aria-label="Open debug panel"
        >
          🔍
        </button>
      )}

      {debugPanelOpen && (
        <div className="fixed top-4 right-4 bg-black/90 border border-green-500/50 rounded p-3 text-xs font-mono z-50 max-w-xs" style={{ backdropFilter: 'blur(4px)' }}>
          <div className="flex justify-between items-center mb-2">
            <span className="text-green-400 font-bold">🔍 PatternDisplay Debug</span>
            <button onClick={onCloseDebug} className="text-gray-500 hover:text-white">✕</button>
          </div>
          <div className="mb-2">
            <span className="text-gray-400">Mode:</span>
            <span className={`ml-2 font-bold ${debugInfo.layoutMode.includes('32') ? 'text-blue-400' : debugInfo.layoutMode.includes('64') ? 'text-purple-400' : 'text-orange-400'}`}>
              {debugInfo.layoutMode}
            </span>
          </div>
          {debugInfo.errors.length > 0 && (
            <div className="mb-2">
              <div className="text-red-400 font-bold mb-1">Errors:</div>
              {debugInfo.errors.map((err, i) => (
                <div key={i} className="text-red-300 text-[10px] truncate">• {err}</div>
              ))}
            </div>
          )}
          <div className="border-t border-gray-700 pt-2 mt-2">
            <div className="text-gray-500 text-[10px] mb-1">Uniforms:</div>
            {Object.entries(debugInfo.uniforms).map(([key, val]) => (
              <div key={key} className="flex justify-between text-[10px]">
                <span className="text-gray-400">{key}:</span>
                <span className="text-cyan-300 ml-2">{String(val)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
