import React, { useEffect, useRef, useState } from 'react';
import { ChannelShadowState, PatternMatrix, PlaybackState, SyncDebugInfo } from '../types';

import { useWebGLOverlay } from '../hooks/useWebGLOverlay';
import { useWebGPURender } from '../hooks/useWebGPURender';
import type { WebGPURenderParams, DebugInfo } from '../src/renderers/params';
import { useWebGL2PatternRender } from '../src/renderers/webgl2/useWebGL2PatternRender';
import { PatternHTMLFallback } from '../src/renderers/html/PatternHTMLFallback';
import { setCurrentPatternRenderer } from '../src/renderers/global';
import { BloomPostProcessor } from '../utils/bloomPostProcessor';
import {
  WEBGL_HYBRID_SHADERS,
  supportsStepsLength,
  usesPadTopChannel,
  usesBareCanvasChrome,
  showsChannelInvertButton,
  isHorizontalLayoutShader,
} from '../utils/shaderVersion';
import { PatternDisplayDebugPanel } from './PatternDisplayDebugPanel';
import { usePatternRendererBackend } from '../src/renderers/hooks/usePatternRendererBackend';
import { usePatternCanvasMetrics } from '../src/renderers/hooks/usePatternCanvasMetrics';
import { useVideoPatternSource } from '../src/renderers/hooks/useVideoPatternSource';
import { usePatternBloom } from '../src/renderers/hooks/usePatternBloom';
import { useShaderCanvasHitTest } from '../src/renderers/hooks/useShaderCanvasHitTest';
import { usePatternRenderLoop } from '../src/renderers/hooks/usePatternRenderLoop';

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
  channelStatesRef?: React.MutableRefObject<ChannelShadowState[]>;
  oscBufferRef?: React.MutableRefObject<Float32Array | null>;
  audioReactiveRef?: React.MutableRefObject<Float32Array | null>;
  reactiveMode?: boolean;
  debugPanelOpen?: boolean;
  onCloseDebug?: () => void;
  onOpenDebug?: () => void;
  syncDebug?: SyncDebugInfo;
  colorPalette?: number;
  paletteMode?: number;
  highlightInstrument?: number;
  instrumentPalette?: Uint8Array;
  chassisDark?: boolean;
  stepsLength?: 32 | 64;
  onStepsLengthToggle?: () => void;
  nightModeEnabled?: boolean;
  nightPreset?: number;
  vignetteStrength?: number;
  filmGrain?: number;
  invertMix?: number;
  crtEnabled?: boolean;
  liteMode?: boolean;
  editMode?: boolean;
  onSequencerCellEdit?: (row: number, channel: number) => void;
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
  channelStatesRef,
  oscBufferRef,
  audioReactiveRef,
  reactiveMode = true,
  debugPanelOpen = false,
  onCloseDebug,
  onOpenDebug,
  syncDebug,
  colorPalette = 0,
  paletteMode = 0,
  highlightInstrument = 0,
  instrumentPalette,
  stepsLength: stepsLengthProp,
  onStepsLengthToggle,
  chassisDark = false,
  nightModeEnabled = false,
  nightPreset = 0,
  vignetteStrength = 0.0,
  filmGrain = 0.0,
  invertMix = 0.0,
  crtEnabled = false,
  liteMode = false,
  editMode = false,
  onSequencerCellEdit,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const bloomRef = useRef<BloomPostProcessor | null>(null);
  const gpuDeviceRef = useRef<GPUDevice | null>(null);
  const gpuContextRef = useRef<GPUCanvasContext | null>(null);

  const themeBlendRef = useRef<number>(nightModeEnabled ? 1.0 : 0.0);
  const nightModeTargetRef = useRef<number>(nightModeEnabled ? 1.0 : 0.0);
  nightModeTargetRef.current = nightModeEnabled ? 1.0 : 0.0;

  const crtEnabledRef = useRef<boolean>(crtEnabled);
  crtEnabledRef.current = crtEnabled;

  const [webgpuAvailable, setWebgpuAvailable] = useState(true);
  const { activeBackend, setActiveBackend, webgl2Available, setWebgl2Available } =
    usePatternRendererBackend(webgpuAvailable);

  const [localTime, setLocalTime] = useState(0);
  const [invertChannels, setInvertChannels] = useState(false);
  const [localStepsLength, setLocalStepsLength] = useState<32 | 64>(32);
  const stepsLength = stepsLengthProp ?? localStepsLength;

  const [debugInfo, setDebugInfo] = useState<DebugInfo>({
    layoutMode: 'NONE',
    errors: [],
    uniforms: {},
  });

  const numChannels = matrix?.numChannels ?? DEFAULT_CHANNELS;
  const padTopChannel = usesPadTopChannel(shaderFile);
  const isHorizontal = isHorizontalLayoutShader(shaderFile);

  const { needsDefaultVideo, bindDefaultVideoRef, effectiveVideoSource } = useVideoPatternSource({
    shaderFile,
    externalVideoSource,
    isPlaying,
  });

  const useWebGPU = activeBackend === 'webgpu';
  const useWebGL2 = activeBackend === 'webgl2';
  const useHTML = activeBackend === 'html';
  const isOverlayActive = useWebGPU && !liteMode && WEBGL_HYBRID_SHADERS.has(shaderFile);

  const { canvasMetrics, syncCanvasSize, handleResize } = usePatternCanvasMetrics({
    containerRef,
    canvasRef,
    glCanvasRef,
    shaderFile,
    numChannels,
    cellWidth,
    liteMode,
    bloomRef,
    gpuDeviceRef,
    gpuContextRef,
  });

  const {
    fileInputRef,
    clickedButton,
    handleCanvasClick,
    handleFileChange,
  } = useShaderCanvasHitTest({
    shaderFile,
    playheadRow,
    ...(totalRows !== undefined ? { totalRows } : {}),
    ...(onPlay ? { onPlay } : {}),
    ...(onStop ? { onStop } : {}),
    ...(onLoopToggle ? { onLoopToggle } : {}),
    ...(onSeek ? { onSeek } : {}),
    ...(onVolumeChange ? { onVolumeChange } : {}),
    ...(onPanChange ? { onPanChange } : {}),
    ...(onFileSelected ? { onFileSelected } : {}),
  });

  useEffect(() => {
    if (!supportsStepsLength(shaderFile)) setLocalStepsLength(32);
  }, [shaderFile]);

  const renderParamsRef = useRef<WebGPURenderParams>({
    matrix, channels, padTopChannel, isPlaying, bpm, timeSec, tickOffset,
    beatPhase, grooveAmount, kickTrigger, activeChannels, isModuleLoaded,
    bloomIntensity, bloomThreshold, dimFactor, volume, pan, isLooping,
    invertChannels, clickedButton, cellWidth, cellHeight, playheadRow,
    localTime, isHorizontal, externalVideoSource: effectiveVideoSource,
    canvasMetrics,
    colorPalette,
    paletteMode,
    highlightInstrument,
    instrumentPalette,
    stepsLength,
    chassisDark,
    vignetteStrength, filmGrain, invertMix, nightPreset,
    themeBlend: themeBlendRef.current,
    reactiveMode,
    ...(audioReactiveRef ? { audioReactiveRef } : {}),
    ...(totalRows !== undefined ? { totalRows } : {}),
    ...(playbackStateRef ? { playbackStateRef } : {}),
    ...(channelStatesRef ? { channelStatesRef } : {}),
    ...(oscBufferRef ? { oscBufferRef } : {}),
  });
  renderParamsRef.current = {
    matrix, channels, padTopChannel, isPlaying, bpm, timeSec, tickOffset,
    beatPhase, grooveAmount, kickTrigger, activeChannels, isModuleLoaded,
    bloomIntensity, bloomThreshold, dimFactor, volume, pan, isLooping,
    invertChannels, clickedButton, cellWidth, cellHeight, playheadRow,
    localTime, isHorizontal, externalVideoSource: effectiveVideoSource,
    canvasMetrics,
    colorPalette,
    paletteMode,
    highlightInstrument,
    instrumentPalette,
    stepsLength,
    chassisDark,
    vignetteStrength, filmGrain, invertMix, nightPreset,
    themeBlend: themeBlendRef.current,
    reactiveMode,
    ...(audioReactiveRef ? { audioReactiveRef } : {}),
    ...(totalRows !== undefined ? { totalRows } : {}),
    ...(playbackStateRef ? { playbackStateRef } : {}),
    ...(channelStatesRef ? { channelStatesRef } : {}),
    ...(oscBufferRef ? { oscBufferRef } : {}),
  };

  const { drawWebGL } = useWebGLOverlay(glCanvasRef, {
    shaderFile, matrix, padTopChannel, isOverlayActive,
    invertChannels, playheadRow, cellWidth, cellHeight,
    channels, bloomIntensity, stepsLength,
    ...(playbackStateRef ? { playbackStateRef } : {}),
    ...(channelStatesRef ? { channelStatesRef } : {}),
  }, setDebugInfo);

  const oscTextureRef = useRef<GPUTexture | null>(null);

  const { gpuReady, render: renderWebGPU, deviceRef: gpuDevRef, deviceStatus, contextRef: gpuHookContextRef } = useWebGPURender(
    canvasRef, glCanvasRef, shaderFile,
    syncCanvasSize, renderParamsRef, matrix, padTopChannel, setDebugInfo, setWebgpuAvailable,
    bloomRef,
    oscTextureRef,
    liteMode,
    useWebGPU,
  );

  const { glReady, render: renderWebGL2 } = useWebGL2PatternRender(
    canvasRef, shaderFile,
    syncCanvasSize, renderParamsRef, matrix, padTopChannel, setDebugInfo, setWebgl2Available,
    liteMode,
    crtEnabledRef,
    useWebGL2,
  );

  const { debugBloomLayer } = usePatternBloom({
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
  });

  const gpuReadyEffective = useWebGPU ? gpuReady : useWebGL2 ? glReady : false;
  const render = useWebGPU ? renderWebGPU : useWebGL2 ? renderWebGL2 : () => {};

  useEffect(() => {
    gpuDeviceRef.current = gpuDevRef.current;
    gpuContextRef.current = gpuHookContextRef.current;
  });

  useEffect(() => {
    if (!useWebGPU || !gpuReady) return;
    const canvas = canvasRef.current;
    setCurrentPatternRenderer({
      backend: 'webgpu',
      readPixels: () => {
        if (!canvas) return null;
        const gl = canvas.getContext('webgl2');
        void gl;
        return null;
      },
      getCanvas: () => canvas,
      setDebugMode: () => {},
      getDebugMode: () => 'normal',
      setScrollSpeed: () => {},
      getScrollSpeed: () => 1,
      resize: () => handleResize(),
    });
    return () => setCurrentPatternRenderer(null);
  }, [useWebGPU, gpuReady, handleResize]);

  const renderRef = useRef<() => void>();
  useEffect(() => {
    renderRef.current = render;
  });

  usePatternRenderLoop({
    isModuleLoaded,
    isPlaying,
    gpuReadyEffective,
    useWebGPU,
    useHTML,
    isOverlayActive,
    nightModeEnabled,
    ...(analyserNode !== undefined ? { analyserNode } : {}),
    crtEnabledRef,
    themeBlendRef,
    nightModeTargetRef,
    renderParamsRef,
    bloomRef,
    renderRef,
    drawWebGL,
    setLocalTime,
  });

  return (
    <div
      ref={containerRef}
      className={`pattern-display relative ${padTopChannel && !usesBareCanvasChrome(shaderFile) ? 'p-8 rounded-xl bg-[#18181a] shadow-2xl border border-[#333]' : ''}`}
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

      {showsChannelInvertButton(shaderFile) && (
        <button
          onClick={() => setInvertChannels(p => !p)}
          className="absolute top-2 left-12 px-2 py-1 bg-[#222] text-xs font-mono text-gray-400 border border-[#444] rounded hover:bg-[#333] hover:text-white transition-colors"
        >
          {invertChannels ? '[INNER LOW]' : '[OUTER LOW]'}
        </button>
      )}

      {supportsStepsLength(shaderFile) && (
        <button
          onClick={() => {
            if (onStepsLengthToggle) {
              onStepsLengthToggle();
            } else {
              setLocalStepsLength(s => s === 32 ? 64 : 32);
            }
          }}
          className="absolute top-2 left-36 px-2 py-1 bg-[#222] text-xs font-mono text-gray-400 border border-[#444] rounded hover:bg-[#333] hover:text-white transition-colors"
        >
          [{stepsLength} STEPS]
        </button>
      )}

      {useHTML ? (
        <PatternHTMLFallback
          matrix={matrix}
          playheadRow={playheadRow}
          totalRows={totalRows ?? matrix?.numRows ?? 64}
          bpm={bpm}
          editMode={editMode}
          {...(onSequencerCellEdit ? { onSequencerCellEdit } : {})}
          {...(onSeek ? { onSeek } : {})}
        />
      ) : (
        <div
          className="relative max-w-full max-h-full"
          style={{ width: 'fit-content', height: 'fit-content' }}
        >
          {needsDefaultVideo && (
            <video
              ref={bindDefaultVideoRef}
              className="sr-only"
              aria-hidden
              playsInline
              muted
              loop
              preload="auto"
            />
          )}
          <canvas
            ref={canvasRef}
            data-shader-preview-source="true"
            data-renderer={activeBackend}
            width={canvasMetrics.width}
            height={canvasMetrics.height}
            onClick={handleCanvasClick}
            className={`${padTopChannel && !usesBareCanvasChrome(shaderFile) ? 'rounded bg-black shadow-inner border border-black/50' : ''} cursor-pointer block`}
            style={{ width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '100%', aspectRatio: `${canvasMetrics.width} / ${canvasMetrics.height}`, objectFit: 'contain' }}
          />
          <canvas
            ref={glCanvasRef}
            data-overlay-canvas="true"
            width={canvasMetrics.width}
            height={canvasMetrics.height}
            className="absolute inset-0 pointer-events-none"
            style={{ display: isOverlayActive ? 'block' : 'none', zIndex: 2, width: '100%', height: '100%' }}
          />
        </div>
      )}

      {!useHTML && useWebGL2 && !webgl2Available && (
        <div className="error absolute inset-0 flex items-center justify-center bg-black/80 text-red-400 text-sm font-mono p-4">
          WebGL2 not available — use <code className="mx-1">?renderer=html</code>
        </div>
      )}

      {useWebGPU && deviceStatus === 'lost' && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center bg-black/75 text-amber-300 text-sm font-mono p-4 pointer-events-none"
          role="status"
          aria-live="polite"
        >
          GPU device lost — recovering…
        </div>
      )}

      {useWebGPU && deviceStatus === 'device-failed' && !webgpuAvailable && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center bg-black/80 text-red-400 text-sm font-mono p-4 text-center"
          role="alert"
        >
          WebGPU device unavailable — falling back or use{' '}
          <code className="mx-1">?renderer=webgl2</code>
        </div>
      )}

      <PatternDisplayDebugPanel
        debugPanelOpen={debugPanelOpen}
        {...(onCloseDebug ? { onCloseDebug } : {})}
        {...(onOpenDebug ? { onOpenDebug } : {})}
        activeBackend={activeBackend}
        setActiveBackend={setActiveBackend}
        debugInfo={debugInfo}
        {...(syncDebug ? { syncDebug } : {})}
        debugBloomLayer={debugBloomLayer}
        bloomLayerLabel={bloomRef.current?.getDebugLayerLabel() ?? null}
      />
    </div>
  );
};
