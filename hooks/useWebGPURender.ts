// WebGPU initialization and render loop for PatternDisplay.
// Manages GPU device, pipelines, buffers, textures, and the per-frame render function.

import { useRef, useEffect, useState, useCallback } from 'react';
import type React from 'react';
import { ChannelShadowState, PatternMatrix, PlaybackState } from '../types';
import {
  getLayoutType,
  isSinglePassCompositeShader,
  isCircularLayoutShader,
  shouldUseBackgroundPass,
  getBackgroundShaderFile,
  shouldEnableAlphaBlending,
  supportsStepsLength,
  usesHighPrecisionPacking,
  usesPlayheadRowAsFloat,
  usesOscilloscope,
  usesInstrumentPalette,
  usesAudioReactive,
  usesAudioReactiveBezel,
  usesVideoPatternTexture,
  usesStepsDrivenVisibleRows,
  getUiExtraInstances,
  usesNightModeBezel,
  needsChassisControlFields,
  resolveShaderMeta,
  WEBGL_HYBRID_SHADERS,
} from '../utils/shaderVersion';
import { getShaderMeta, getLiteRecommendedShader } from '../utils/shaderRegistry';
import {
  alignTo,
  clampPlayhead,
  fillUniformPayload,
  fillChannelStates,
  packPatternMatrix,
  packPatternMatrixHighPrecision,
  packPatternMatrixComputeInput,
  createBufferWithData,
  buildRowFlags,
  verifyDurationParity,
  DEFAULT_ROWS,
  DEFAULT_CHANNELS,
} from '../utils/gpuPacking';
import {
  initNoteDurationCompute,
  runNoteDurationCompute,
  canUseComputePath,
  readbackBuffer,
  disposeNoteDurationCompute,
  type NoteDurationComputeState,
} from '../utils/computeNoteDuration';
import type { BloomPostProcessor } from '../utils/bloomPostProcessor';
import { GpuResourcePool } from '../utils/gpuResourcePool';
import { GpuLifecycle } from '../utils/gpuLifecycle';
import { GRID_RECT, getPolarRadii } from '../utils/geometryConstants';
import { withBase } from '../src/lib/paths';
import { generateEmptyInstrumentPalette, MAX_INSTRUMENT_PALETTE_SIZE } from '../utils/instrumentPalette';
import {
  requestWebGPUDevice,
  configureCanvasContext,
  getWebGPUCanvasContext,
  attachDeviceLostHandler,
  preferredSampledImageFormat,
  probeWebGPUCanvasPresentation,
  WebGPUInitError,
  type WebGPUDeviceStatus,
} from '../utils/webgpuDevice';
import {
  AUDIO_REACTIVE_UNIFORM_BYTES,
  packAudioReactiveUniform,
  readAudioBands,
} from '../utils/audioReactive';

export type DebugInfo = {
  layoutMode: string;
  errors: string[];
  uniforms: Record<string, number | string>;
};

/** Lifecycle status for the shared WebGPU device (surfaced to UI). */
export type { WebGPUDeviceStatus };

async function fetchShaderSource(shaderName: string): Promise<string> {
  const response = await fetch(withBase(`shaders/${shaderName}`));
  if (!response.ok) {
    throw new Error(`Failed to load shader "${shaderName}" (${response.status} ${response.statusText})`);
  }
  const source = await response.text();
  if (!source.trim()) {
    throw new Error(`Shader "${shaderName}" loaded as an empty file`);
  }
  return source;
}

// All per-frame render parameters — updated every React render via ref assignment
export interface WebGPURenderParams {
  matrix: PatternMatrix | null;
  channels: ChannelShadowState[];
  padTopChannel: boolean;
  isPlaying: boolean;
  bpm: number;
  timeSec: number;
  tickOffset: number;
  beatPhase: number;
  grooveAmount: number;
  kickTrigger: number;
  activeChannels: number[];
  isModuleLoaded: boolean;
  bloomIntensity: number;
  bloomThreshold: number;
  dimFactor: number;
  volume: number;
  pan: number;
  isLooping: boolean;
  invertChannels: boolean;
  clickedButton: number;
  cellWidth: number;
  cellHeight: number;
  playheadRow: number;
  localTime: number;
  isHorizontal: boolean;
  externalVideoSource: HTMLVideoElement | HTMLImageElement | null;
  playbackStateRef?: React.MutableRefObject<PlaybackState>;
  /** Live channel shadow state — preferred over `channels` in the render loop. */
  channelStatesRef?: React.MutableRefObject<ChannelShadowState[]>;
  canvasMetrics: { width: number; height: number };
  totalRows?: number;
  colorPalette?: number;
  stepsLength?: number;
  chassisDark?: boolean;
  // Night Mode 2.0 (v0.35_bloom)
  vignetteStrength?: number;
  themeBlend?: number;
  filmGrain?: number;
  nightPreset?: number;
  invertMix?: number;
  // Per-instrument palette mode
  paletteMode?: number;
  instrumentPalette?: Uint8Array | undefined;
  /** SAB metadata view (band energy + meters) from worklet. */
  audioReactiveRef?: React.MutableRefObject<Float32Array | null>;
  /** User toggle — when false, AudioReactive.enabled is 0. */
  reactiveMode?: boolean;
}

/** Prefer ref-backed channel state for GPU uploads (avoids 60 Hz React re-renders). */
export function resolveLiveChannels(p: WebGPURenderParams): ChannelShadowState[] {
  const fromRef = p.channelStatesRef?.current;
  if (fromRef && fromRef.length > 0) return fromRef;
  return p.channels;
}

export function useWebGPURender(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  glCanvasRef: React.RefObject<HTMLCanvasElement>,
  shaderFile: string,
  syncCanvasSize: (canvas: HTMLCanvasElement, gl: HTMLCanvasElement | null) => void,
  renderParamsRef: React.MutableRefObject<WebGPURenderParams>,
  matrix: import('../types').PatternMatrix | null,
  padTopChannel: boolean,
  setDebugInfo: React.Dispatch<React.SetStateAction<DebugInfo>>,
  setWebgpuAvailable: (v: boolean) => void,
  bloomProcessorRef?: React.MutableRefObject<BloomPostProcessor | null>,
  oscTextureRef?: React.MutableRefObject<GPUTexture | null>,
  liteMode?: boolean,
  enabled = true,
) {
  const [gpuReady, setGpuReady] = useState(false);
  /** True once adapter/device/context are acquired (shader resources may still be loading). */
  const [deviceAcquired, setDeviceAcquired] = useState(false);
  /** Bumped on unexpected device loss to re-run the init effect (recovery). */
  const [deviceEpoch, setDeviceEpoch] = useState(0);
  const [deviceStatus, setDeviceStatus] = useState<WebGPUDeviceStatus>('initializing');
  const markLostIntentionalRef = useRef<(() => void) | null>(null);
  /** Caps automatic device-lost recovery to avoid infinite re-init loops. */
  const recoveryAttemptsRef = useRef(0);
  const MAX_DEVICE_LOST_RECOVERIES = 3;

  // GPU resource refs
  const deviceRef = useRef<GPUDevice | null>(null);
  const contextRef = useRef<GPUCanvasContext | null>(null);
  const pipelineRef = useRef<GPURenderPipeline | null>(null);
  const bindGroupRef = useRef<GPUBindGroup | null>(null);
  const uniformBufferRef = useRef<GPUBuffer | null>(null);
  const cellsBufferRef = useRef<GPUBuffer | null>(null);
  const rowFlagsBufferRef = useRef<GPUBuffer | null>(null);
  const channelsBufferRef = useRef<GPUBuffer | null>(null);
  const useExtendedRef = useRef<boolean>(false);
  const bezelTextureResourcesRef = useRef<{ sampler: GPUSampler; view: GPUTextureView } | null>(null);
  const textureResourcesRef = useRef<{ sampler: GPUSampler; view: GPUTextureView } | null>(null);
  const layoutTypeRef = useRef(getLayoutType(shaderFile));
  const videoRef = useRef<HTMLVideoElement | HTMLImageElement | null>(null);
  const videoTextureRef = useRef<GPUTexture | null>(null);
  const renderFrameCountRef = useRef<number>(0);
  const bezelPipelineRef = useRef<GPURenderPipeline | null>(null);
  const computeStateRef = useRef<NoteDurationComputeState | null>(null);
  const bezelBindGroupRef = useRef<GPUBindGroup | null>(null);
  const bezelUniformBufferRef = useRef<GPUBuffer | null>(null);
  const instrumentPaletteTextureRef = useRef<GPUTexture | null>(null);
  const instrumentPaletteVersionRef = useRef<Uint8Array | null>(null);
  const audioReactiveUniformBufferRef = useRef<GPUBuffer | null>(null);
  const audioReactiveUniformDataRef = useRef(new Float32Array(16));
  const poolRef = useRef<GpuResourcePool | null>(null);
  const lifecycleRef = useRef(new GpuLifecycle());
  const renderGenerationRef = useRef(0);

  // Persistent typed arrays to avoid GC pressure
  const uniformBufferDataRef = useRef(new ArrayBuffer(144));
  const uniformUintRef = useRef(new Uint32Array(uniformBufferDataRef.current));
  const uniformFloatRef = useRef(new Float32Array(uniformBufferDataRef.current));
  const bezelBufferDataRef = useRef(new ArrayBuffer(128));
  const bezelFloatRef = useRef(new Float32Array(bezelBufferDataRef.current));
  const bezelUintRef = useRef(new Uint32Array(bezelBufferDataRef.current));
  const channelBufferDataRef = useRef<ArrayBuffer | null>(null);
  const channelDataViewRef = useRef<DataView | null>(null);

  const preferredImageFormat = preferredSampledImageFormat;

  const refreshBindGroup = useCallback((device: GPUDevice) => {
    const pool = poolRef.current;
    if (!pool || pool.isDisposed) return;
    if (!pipelineRef.current || !cellsBufferRef.current || !uniformBufferRef.current) return;
    if (!pool.isAlive(cellsBufferRef.current) || !pool.isAlive(uniformBufferRef.current)) return;
    const layout = pipelineRef.current.getBindGroupLayout(0);
    const layoutType = layoutTypeRef.current;
    const entries: GPUBindGroupEntry[] = [
      { binding: 0, resource: { buffer: cellsBufferRef.current, size: cellsBufferRef.current.size } },
      { binding: 1, resource: { buffer: uniformBufferRef.current } },
    ];
    if (layoutType === 'extended') {
      if (!rowFlagsBufferRef.current || !channelsBufferRef.current || !textureResourcesRef.current) {
        bindGroupRef.current = null;
        return;
      }
      entries.push(
        { binding: 2, resource: { buffer: rowFlagsBufferRef.current } },
        { binding: 3, resource: { buffer: channelsBufferRef.current } },
        { binding: 4, resource: textureResourcesRef.current.sampler },
        { binding: 5, resource: textureResourcesRef.current.view },
      );
      if (usesOscilloscope(shaderFile) && oscTextureRef?.current) {
        entries.push({ binding: 6, resource: oscTextureRef.current.createView() });
      }
      if (usesInstrumentPalette(shaderFile) && instrumentPaletteTextureRef.current) {
        entries.push({ binding: 7, resource: instrumentPaletteTextureRef.current.createView() });
      }
      if (usesAudioReactive(shaderFile) && audioReactiveUniformBufferRef.current) {
        entries.push({ binding: 8, resource: { buffer: audioReactiveUniformBufferRef.current } });
      }
    } else if (layoutType === 'texture') {
      if (!textureResourcesRef.current) {
        bindGroupRef.current = null;
        return;
      }
      entries.push(
        { binding: 2, resource: textureResourcesRef.current.sampler },
        { binding: 3, resource: textureResourcesRef.current.view },
      );
    }
    bindGroupRef.current = device.createBindGroup({ layout, entries });
  }, [oscTextureRef, shaderFile]);

  const loadBezelTexture = async (device: GPUDevice) => {
    if (bezelTextureResourcesRef.current) return;
    const textureName =
      resolveShaderMeta(shaderFile).bezelTexture === 'square'
        ? `./bezel-square.png`
        : `./bezel.png`;
    let bitmap: ImageBitmap;
    try {
      const img = new Image();
      img.src = textureName;
      await img.decode();
      bitmap = await createImageBitmap(img);
    } catch (e) {
      console.warn(`Failed to load ${textureName}, using fallback.`, e);
      const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
      const ctx = canvas.getContext('2d'); if (ctx) { ctx.fillStyle = 'rgba(0,0,0,0)'; ctx.fillRect(0, 0, 1, 1); }
      bitmap = await createImageBitmap(canvas);
    }
    const texture = poolRef.current?.track(
      device.createTexture({ size: [bitmap.width, bitmap.height, 1], format: preferredImageFormat(device), usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT }),
      'shader',
    ) ?? device.createTexture({ size: [bitmap.width, bitmap.height, 1], format: preferredImageFormat(device), usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    device.queue.copyExternalImageToTexture({ source: bitmap, flipY: true }, { texture }, [bitmap.width, bitmap.height, 1]);
    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    bezelTextureResourcesRef.current = { sampler, view: texture.createView() };
  };

  const ensureButtonTexture = async (device: GPUDevice) => {
    if (textureResourcesRef.current) return;
    const textureUrl =
      resolveShaderMeta(shaderFile).patternTexture === 'button-v30'
        ? withBase('unlit-button-2.png')
        : withBase('unlit-button.png');
    console.log('[WebGPU] Loading button texture:', textureUrl);
    let bitmap: ImageBitmap;
    try {
      const img = new Image();
      img.src = textureUrl;
      img.crossOrigin = 'anonymous';
      await img.decode();
      bitmap = await createImageBitmap(img);
    } catch (e) {
      console.warn(`Failed to load button texture (${textureUrl}), using fallback.`, e);
      const canvas = document.createElement('canvas');
      canvas.width = 128; canvas.height = 128;
      const ctx = canvas.getContext('2d');
      if (ctx) { ctx.fillStyle = '#222'; ctx.fillRect(0, 0, 128, 128); ctx.strokeStyle = '#444'; ctx.strokeRect(10, 10, 108, 108); }
      bitmap = await createImageBitmap(canvas);
    }
    const texture = poolRef.current?.track(
      device.createTexture({ size: [bitmap.width, bitmap.height, 1], format: preferredImageFormat(device), usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT }),
      'shader',
    ) ?? device.createTexture({ size: [bitmap.width, bitmap.height, 1], format: preferredImageFormat(device), usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    device.queue.copyExternalImageToTexture({ source: bitmap, flipY: true }, { texture }, [bitmap.width, bitmap.height, 1]);
    const sampler = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' });
    textureResourcesRef.current = { sampler, view: texture.createView() };
  };

  const ensureVideoPlaceholder = (device: GPUDevice) => {
    if (videoTextureRef.current) return;
    const fmt = preferredImageFormat(device);
    const texture = poolRef.current?.track(
      device.createTexture({
        size: [1, 1, 1], format: fmt,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      }),
      'shader',
    ) ?? device.createTexture({
      size: [1, 1, 1], format: fmt,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    if (fmt === 'rgba32float') {
      device.queue.writeTexture({ texture }, new Float32Array([100/255, 100/255, 100/255, 1.0]), { bytesPerRow: 16 }, { width: 1, height: 1 });
    } else {
      device.queue.writeTexture({ texture }, new Uint8Array([100, 100, 100, 255]), { bytesPerRow: 4 }, { width: 1, height: 1 });
    }
    videoTextureRef.current = texture;
    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    textureResourcesRef.current = { sampler, view: texture.createView() };
  };

  const canvasFormatRef = useRef<GPUTextureFormat>('bgra8unorm');
  /** Last canvas buffer size the WebGPU context was configured for. */
  const configuredCanvasSizeRef = useRef<{ w: number; h: number } | null>(null);

  const releaseShaderGpuResources = useCallback(() => {
    renderGenerationRef.current = lifecycleRef.current.bump();
    bindGroupRef.current = null;
    pipelineRef.current = null;
    bezelBindGroupRef.current = null;
    bezelPipelineRef.current = null;
    bezelTextureResourcesRef.current = null;
    textureResourcesRef.current = null;
    instrumentPaletteVersionRef.current = null;

    const pool = poolRef.current;
    if (pool && !pool.isDisposed) {
      if (cellsBufferRef.current) {
        pool.releaseBuffer('cells', cellsBufferRef.current, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
      }
      if (rowFlagsBufferRef.current) {
        pool.releaseBuffer('rowFlags', rowFlagsBufferRef.current, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
      }
      if (channelsBufferRef.current) {
        pool.releaseBuffer('channels', channelsBufferRef.current, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
      }
      pool.disposeScope('shader');
      pool.disposeScope('matrix');
    }

    cellsBufferRef.current = null;
    uniformBufferRef.current = null;
    rowFlagsBufferRef.current = null;
    channelsBufferRef.current = null;
    bezelUniformBufferRef.current = null;
    videoTextureRef.current = null;
    instrumentPaletteTextureRef.current = null;
    audioReactiveUniformBufferRef.current = null;
  }, []);

  // Acquire GPUDevice + canvas context (once per mount / device-lost recovery).
  useEffect(() => {
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
    setDeviceStatus(deviceEpoch > 0 ? 'lost' : 'initializing');

    const initDevice = async () => {
      try {
        const { device, preferredCanvasFormat } = await requestWebGPUDevice({
          liteMode: !!liteMode,
          isCancelled: () => cancelled,
        });
        if (cancelled) {
          try { device.destroy(); } catch { /* ignore */ }
          return;
        }

        // Adapter/device can succeed while the canvas swapchain never composites
        // (common on headless / software WebGPU). Detect before claiming ready.
        const presents = await probeWebGPUCanvasPresentation(device, preferredCanvasFormat);
        if (cancelled) {
          try { device.destroy(); } catch { /* ignore */ }
          return;
        }
        if (!presents) {
          try { device.destroy(); } catch { /* ignore */ }
          throw new WebGPUInitError(
            'WebGPU canvas presentation failed (swapchain does not composite)',
            'device-failed',
            true,
          );
        }

        syncCanvasSize(canvas, glCanvasRef.current);

        const context = getWebGPUCanvasContext(canvas);
        const format = configureCanvasContext({
          device,
          context,
          format: preferredCanvasFormat,
        });
        canvasFormatRef.current = format;
        configuredCanvasSizeRef.current = { w: canvas.width, h: canvas.height };

        markLostIntentionalRef.current?.();
        markLostIntentionalRef.current = attachDeviceLostHandler(device, {
          onLost: (info, intentional) => {
            if (cancelled || intentional) return;
            console.error(
              `[WebGPU] device lost (reason=${info.reason}): ${info.message}`,
            );
            setGpuReady(false);
            setDeviceAcquired(false);
            lifecycleRef.current.bump();
            poolRef.current?.disposeAll();
            poolRef.current = null;
            disposeNoteDurationCompute(deviceRef.current);
            computeStateRef.current = null;
            deviceRef.current = null;
            contextRef.current = null;
            pipelineRef.current = null;
            bindGroupRef.current = null;

            if (recoveryAttemptsRef.current >= MAX_DEVICE_LOST_RECOVERIES) {
              setDeviceStatus('device-failed');
              setWebgpuAvailable(false);
              setDebugInfo((prev) => ({
                ...prev,
                errors: [
                  ...prev.errors.filter((e) => !e.startsWith('DEVICE-LOST')),
                  `DEVICE-LOST: ${info.reason} — recovery exhausted after ${MAX_DEVICE_LOST_RECOVERIES} attempts`,
                ],
              }));
              return;
            }

            recoveryAttemptsRef.current += 1;
            setDeviceStatus('lost');
            setDebugInfo((prev) => ({
              ...prev,
              errors: [
                ...prev.errors.filter((e) => !e.startsWith('DEVICE-LOST')),
                `DEVICE-LOST: ${info.reason} — recovering (${recoveryAttemptsRef.current}/${MAX_DEVICE_LOST_RECOVERIES})…`,
              ],
            }));
            setDeviceEpoch((n) => n + 1);
          },
        });

        poolRef.current?.disposeAll();
        poolRef.current = new GpuResourcePool(device);
        deviceRef.current = device;
        contextRef.current = context;
        recoveryAttemptsRef.current = 0;
        setDeviceStatus('ready');
        setDeviceAcquired(true);
        setDebugInfo((prev) => ({
          ...prev,
          errors: prev.errors.filter((e) => !e.startsWith('DEVICE-LOST')),
        }));
      } catch (error) {
        if (cancelled) return;
        if (error instanceof WebGPUInitError && error.message.includes('cancelled')) {
          return;
        }
        const reason = error instanceof Error ? error.message : String(error);
        console.error('[Renderer] WebGPU device init failed:', reason);
        const status =
          error instanceof WebGPUInitError ? error.status : 'device-failed';
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
      markLostIntentionalRef.current?.();
      markLostIntentionalRef.current = null;
      setGpuReady(false);
      setDeviceAcquired(false);
      lifecycleRef.current.bump();
      releaseShaderGpuResources();
      disposeNoteDurationCompute(deviceRef.current);
      computeStateRef.current = null;
      poolRef.current?.disposeAll();
      poolRef.current = null;
      if (deviceRef.current) {
        try { deviceRef.current.destroy(); } catch { /* ignore */ }
      }
      deviceRef.current = null;
      contextRef.current = null;
      if (import.meta.env.DEV) {
        console.log('[WebGPU] device disposed on unmount');
      }
    };
  }, [syncCanvasSize, enabled, deviceEpoch, liteMode, releaseShaderGpuResources]); // eslint-disable-line react-hooks/exhaustive-deps

  // Shader pipelines + initial pattern buffers (rebuilt on shader switch).
  useEffect(() => {
    const device = deviceRef.current;
    const pool = poolRef.current;
    if (!enabled || !deviceAcquired || !device || !pool || pool.isDisposed) return;

    let cancelled = false;
    setGpuReady(false);
    releaseShaderGpuResources();

    const initShader = async () => {
      try {
        const format = canvasFormatRef.current;
        textureResourcesRef.current = null;
        bezelTextureResourcesRef.current = null;

        let activeShaderFile = shaderFile;
        if (!getShaderMeta(activeShaderFile)) {
          const fallbackShader = getLiteRecommendedShader();
          console.warn(`[WebGPU] Shader "${activeShaderFile}" is not registered; falling back to "${fallbackShader}".`);
          activeShaderFile = fallbackShader;
        }

        const shaderSource = await fetchShaderSource(activeShaderFile);
        if (cancelled || pool.isDisposed) return;
        const module = device.createShaderModule({ code: shaderSource });
        if ('getCompilationInfo' in module) module.getCompilationInfo().catch(() => {});

        const layoutType = getLayoutType(activeShaderFile);
        layoutTypeRef.current = layoutType;
        useExtendedRef.current = layoutType === 'extended';

        let bindGroupLayout: GPUBindGroupLayout;
        if (layoutType === 'texture') {
          bindGroupLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }, { binding: 1, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }, { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } }, { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }] });
        } else if (layoutType === 'extended') {
          const extendedEntries: GPUBindGroupLayoutEntry[] = [{ binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }, { binding: 1, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }, { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } }, { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } }, { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } }, { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }];
          if (usesOscilloscope(activeShaderFile)) {
            extendedEntries.push({ binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } });
          }
          if (usesInstrumentPalette(activeShaderFile)) {
            extendedEntries.push({ binding: 7, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } });
          }
          if (usesAudioReactive(activeShaderFile)) {
            extendedEntries.push({ binding: 8, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } });
          }
          bindGroupLayout = device.createBindGroupLayout({ entries: extendedEntries });
        } else {
          bindGroupLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }, { binding: 1, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }] });
        }

        const enableAlphaBlend = shouldEnableAlphaBlending(activeShaderFile);
        const targets: GPUColorTargetState[] = [{ format, ...(enableAlphaBlend ? { blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } } : {}) }];
        try {
          pipelineRef.current = device.createRenderPipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }), vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets }, primitive: { topology: 'triangle-list' } });
        } catch {
          pipelineRef.current = device.createRenderPipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }), vertex: { module, entryPoint: 'vertex_main' }, fragment: { module, entryPoint: 'fragment_main', targets }, primitive: { topology: 'triangle-list' } });
        }

        const uniformSize = layoutType === 'extended' ? 132 : (layoutType === 'texture' ? 64 : 32);
        const uniformBuffer = pool.track(
          device.createBuffer({ size: alignTo(uniformSize, 256), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
          'shader',
        );
        uniformBufferRef.current = uniformBuffer;

        if (usesInstrumentPalette(activeShaderFile)) {
          const placeholder = generateEmptyInstrumentPalette();
          const texture = pool.track(
            device.createTexture({
              size: [MAX_INSTRUMENT_PALETTE_SIZE, 1, 1],
              format: 'rgba8unorm',
              usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
            }),
            'shader',
          );
          device.queue.writeTexture(
            { texture },
            placeholder.buffer as ArrayBuffer,
            { bytesPerRow: MAX_INSTRUMENT_PALETTE_SIZE * 4 },
            { width: MAX_INSTRUMENT_PALETTE_SIZE, height: 1, depthOrArrayLayers: 1 },
          );
          instrumentPaletteTextureRef.current = texture;
          instrumentPaletteVersionRef.current = placeholder;
        }

        if (usesAudioReactive(activeShaderFile) || usesAudioReactiveBezel(activeShaderFile)) {
          audioReactiveUniformBufferRef.current = pool.track(
            device.createBuffer({
              size: alignTo(AUDIO_REACTIVE_UNIFORM_BYTES, 256),
              usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            }),
            'shader',
          );
        }

        if (shouldUseBackgroundPass(activeShaderFile)) {
          try {
            const backgroundShaderFile = getBackgroundShaderFile(activeShaderFile);
            const backgroundSource = await fetchShaderSource(backgroundShaderFile);
            if (cancelled || pool.isDisposed) return;
            const bezelModule = device.createShaderModule({ code: backgroundSource });
            const audioBezel = usesAudioReactiveBezel(activeShaderFile);
            const bezelBindEntries: GPUBindGroupLayoutEntry[] = [
              { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
              { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
              { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
            ];
            if (audioBezel) {
              bezelBindEntries.push({ binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } });
            }
            const bezelBindLayout = device.createBindGroupLayout({ entries: bezelBindEntries });
            bezelPipelineRef.current = device.createRenderPipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [bezelBindLayout] }), vertex: { module: bezelModule, entryPoint: 'vs' }, fragment: { module: bezelModule, entryPoint: 'fs', targets: [{ format }] }, primitive: { topology: 'triangle-list' } });
            bezelUniformBufferRef.current = pool.track(
              device.createBuffer({ size: alignTo(96, 256), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
              'shader',
            );
            await loadBezelTexture(device);
            if (cancelled || pool.isDisposed) return;
            const bezelGroupEntries: GPUBindGroupEntry[] = [
              { binding: 0, resource: { buffer: bezelUniformBufferRef.current! } },
              { binding: 1, resource: bezelTextureResourcesRef.current!.sampler },
              { binding: 2, resource: bezelTextureResourcesRef.current!.view },
            ];
            if (audioBezel && audioReactiveUniformBufferRef.current) {
              bezelGroupEntries.push({ binding: 3, resource: { buffer: audioReactiveUniformBufferRef.current } });
            }
            bezelBindGroupRef.current = device.createBindGroup({ layout: bezelBindLayout, entries: bezelGroupEntries });
          } catch (e) { console.warn('Failed to initialize bezel shader', e); }
        }

        const p = renderParamsRef.current;
        const isHighPrec = usesHighPrecisionPacking(activeShaderFile);

        if (isHighPrec && !computeStateRef.current) {
          try {
            computeStateRef.current = await initNoteDurationCompute(device);
          } catch (e) {
            console.warn('[DURA-001] Compute pipeline init failed, falling back to CPU:', e);
          }
        }

        const cellsUsage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
        const useCompute = !liteMode && isHighPrec && computeStateRef.current && canUseComputePath(p.matrix);
        if (useCompute) {
          const rawPacked = packPatternMatrixComputeInput(p.matrix, p.padTopChannel);
          const rawBuffer = pool.track(
            createBufferWithData(device, rawPacked.packedData, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST),
            'matrix',
          );
          const numRows = p.matrix?.numRows ?? DEFAULT_ROWS;
          const rawChannels = p.matrix?.numChannels ?? DEFAULT_CHANNELS;
          const numChannels = p.padTopChannel ? rawChannels + 1 : rawChannels;
          cellsBufferRef.current = pool.track(
            runNoteDurationCompute(device, computeStateRef.current!, rawBuffer, numRows, numChannels, p.padTopChannel),
            'matrix',
          );
          pool.destroyTracked(rawBuffer);

          if (import.meta.env.DEV) {
            void (async () => {
              const buffer = cellsBufferRef.current;
              if (!buffer || cancelled) return;
              const gpuData = await readbackBuffer(device, buffer, buffer.size);
              if (gpuData) {
                const parity = verifyDurationParity(gpuData, p.matrix, p.padTopChannel);
                if (!parity.ok && parity.errorSummary) {
                  setDebugInfo((prev: DebugInfo) => ({
                    ...prev,
                    errors: [...prev.errors.filter(e => !e.startsWith('DURA-PARITY')), parity.errorSummary!],
                  }));
                } else if (parity.ok) {
                  console.log('[DURA-PARITY] ✓');
                }
              }
            })();
          }
        } else {
          const packFunc = isHighPrec ? packPatternMatrixHighPrecision : packPatternMatrix;
          const { packedData } = packFunc(p.matrix, p.padTopChannel);
          const byteLength = packedData.byteLength;
          cellsBufferRef.current = pool.acquireBuffer('cells', byteLength, cellsUsage, (buf) => {
            device.queue.writeBuffer(buf, 0, packedData.buffer, packedData.byteOffset, packedData.byteLength);
          }, 'matrix');
        }

        if (layoutType === 'extended') {
          const numRows = p.matrix?.numRows ?? DEFAULT_ROWS;
          const flags = buildRowFlags(numRows);
          rowFlagsBufferRef.current = pool.acquireBuffer('rowFlags', flags.byteLength, cellsUsage, (buf) => {
            device.queue.writeBuffer(buf, 0, flags.buffer, flags.byteOffset, flags.byteLength);
          }, 'matrix');
          const channelsCount = Math.max(1, p.matrix?.numChannels ?? DEFAULT_CHANNELS);
          const totalCount = p.padTopChannel ? channelsCount + 1 : channelsCount;
          const requiredSize = totalCount * 32;
          const buffer = new ArrayBuffer(requiredSize);
          fillChannelStates([], channelsCount, new DataView(buffer), p.padTopChannel);
          channelsBufferRef.current = pool.acquireBuffer('channels', requiredSize, cellsUsage, (buf) => {
            device.queue.writeBuffer(buf, 0, buffer);
          }, 'matrix');
        }

        const needsTexture = layoutType === 'texture' || layoutType === 'extended';
        if (needsTexture) {
          if (usesVideoPatternTexture(activeShaderFile)) ensureVideoPlaceholder(device);
          else await ensureButtonTexture(device);
        }

        if (cancelled || pool.isDisposed) return;
        refreshBindGroup(device);
        renderGenerationRef.current = lifecycleRef.current.bump();
        setGpuReady(true);
        if (import.meta.env.DEV) {
          pool.logStats('WebGPU shader init');
        }
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
      releaseShaderGpuResources();
    };
  }, [shaderFile, deviceAcquired, enabled, liteMode, releaseShaderGpuResources, refreshBindGroup]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update cells buffer when matrix changes.
  // Uses `matrix` and `padTopChannel` as direct React deps (not via renderParamsRef) so React
  // reliably detects new-module loads even if the ref mutation timing is ambiguous.
  useEffect(() => {
    const device = deviceRef.current;
    const pool = poolRef.current;
    if (!device || !gpuReady || !pool || pool.isDisposed) return;
    const p = renderParamsRef.current;
    const rawChannels = matrix?.numChannels ?? DEFAULT_CHANNELS;
    const numChannels = p.padTopChannel ? rawChannels + 1 : rawChannels;
    if (numChannels <= 0) return;
    const numRows = matrix?.numRows ?? DEFAULT_ROWS;
    const cellsUsage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
    bindGroupRef.current = null;
    renderFrameCountRef.current = 0;
    renderGenerationRef.current = lifecycleRef.current.bump();

    if (cellsBufferRef.current) {
      pool.releaseBuffer('cells', cellsBufferRef.current, cellsUsage);
      cellsBufferRef.current = null;
    }
    const isHighPrec = usesHighPrecisionPacking(shaderFile);

    const useCompute = !liteMode && isHighPrec && computeStateRef.current && canUseComputePath(p.matrix);
    if (useCompute) {
      const rawPacked = packPatternMatrixComputeInput(p.matrix, p.padTopChannel);
      const rawBuffer = pool.track(
        createBufferWithData(device, rawPacked.packedData, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST),
        'matrix',
      );
      const outNumRows = p.matrix?.numRows ?? DEFAULT_ROWS;
      const outRawChannels = p.matrix?.numChannels ?? DEFAULT_CHANNELS;
      const outNumChannels = p.padTopChannel ? outRawChannels + 1 : outRawChannels;
      cellsBufferRef.current = pool.track(
        runNoteDurationCompute(device, computeStateRef.current!, rawBuffer, outNumRows, outNumChannels, p.padTopChannel),
        'matrix',
      );
      pool.destroyTracked(rawBuffer);

      if (import.meta.env.DEV) {
        void (async () => {
          const buffer = cellsBufferRef.current;
          if (!buffer) return;
          const gpuData = await readbackBuffer(device, buffer, buffer.size);
          if (gpuData) {
            const parity = verifyDurationParity(gpuData, p.matrix, p.padTopChannel);
            if (!parity.ok && parity.errorSummary) {
              setDebugInfo((prev: DebugInfo) => ({
                ...prev,
                errors: [...prev.errors.filter(e => !e.startsWith('DURA-PARITY')), parity.errorSummary!],
              }));
            } else if (parity.ok) {
              console.log('[DURA-PARITY] ✓');
            }
          }
        })();
      }
    } else {
      const packFunc = isHighPrec ? packPatternMatrixHighPrecision : packPatternMatrix;
      const { packedData } = packFunc(p.matrix, p.padTopChannel);
      cellsBufferRef.current = pool.acquireBuffer('cells', packedData.byteLength, cellsUsage, (buf) => {
        device.queue.writeBuffer(buf, 0, packedData.buffer, packedData.byteOffset, packedData.byteLength);
      }, 'matrix');
    }

    // DEV INVARIANT: GPU buffer size must match expected cell data size
    if (import.meta.env?.DEV && cellsBufferRef.current) {
      const expectedBytes = numRows * numChannels * 2 * 4;
      if (cellsBufferRef.current.size !== expectedBytes) {
        console.error(
          `[useWebGPURender INVARIANT] cells buffer size mismatch. ` +
          `bufferSize=${cellsBufferRef.current.size}, expectedBytes=${expectedBytes}, ` +
          `expectedCells=${numRows * numChannels}`
        );
      }
    }

    if (layoutTypeRef.current === 'extended') {
      const extNumRows = matrix?.numRows ?? DEFAULT_ROWS;
      const flags = buildRowFlags(extNumRows);
      if (!rowFlagsBufferRef.current || rowFlagsBufferRef.current.size < flags.byteLength) {
        if (rowFlagsBufferRef.current) {
          pool.releaseBuffer('rowFlags', rowFlagsBufferRef.current, cellsUsage);
        }
        rowFlagsBufferRef.current = pool.acquireBuffer('rowFlags', flags.byteLength, cellsUsage, (buf) => {
          device.queue.writeBuffer(buf, 0, flags.buffer, flags.byteOffset, flags.byteLength);
        }, 'matrix');
      } else {
        device.queue.writeBuffer(rowFlagsBufferRef.current, 0, flags.buffer, flags.byteOffset, flags.byteLength);
      }

      const channelsCount = Math.max(1, numChannels - (p.padTopChannel ? 1 : 0));
      const totalCount = numChannels;
      const requiredSize = totalCount * 32;
      if (!channelBufferDataRef.current || channelBufferDataRef.current.byteLength < requiredSize) {
        channelBufferDataRef.current = new ArrayBuffer(requiredSize);
        channelDataViewRef.current = new DataView(channelBufferDataRef.current);
      } else {
        new Uint8Array(channelBufferDataRef.current).fill(0, 0, requiredSize);
      }
      fillChannelStates(resolveLiveChannels(p), channelsCount, channelDataViewRef.current!, p.padTopChannel);
      if (!channelsBufferRef.current || channelsBufferRef.current.size < requiredSize) {
        if (channelsBufferRef.current) {
          pool.releaseBuffer('channels', channelsBufferRef.current, cellsUsage);
        }
        channelsBufferRef.current = pool.acquireBuffer('channels', requiredSize, cellsUsage, (buf) => {
          device.queue.writeBuffer(buf, 0, channelBufferDataRef.current!);
        }, 'matrix');
      } else {
        device.queue.writeBuffer(channelsBufferRef.current, 0, channelBufferDataRef.current!, 0, requiredSize);
      }
    }
    renderGenerationRef.current = lifecycleRef.current.bump();
    refreshBindGroup(device);
    if (import.meta.env.DEV) {
      pool.logStats('WebGPU matrix update');
    }
  }, [matrix, padTopChannel, gpuReady, shaderFile, refreshBindGroup, liteMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update channel states buffer
  useEffect(() => {
    const device = deviceRef.current;
    const pool = poolRef.current;
    if (!device || !gpuReady || !pool || pool.isDisposed) return;
    const p = renderParamsRef.current;
    if (layoutTypeRef.current === 'extended') {
      const cellsUsage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
      const count = Math.max(1, p.matrix?.numChannels ?? DEFAULT_CHANNELS);
      const totalCount = p.padTopChannel ? count + 1 : count;
      const requiredSize = totalCount * 32;
      if (!channelBufferDataRef.current || channelBufferDataRef.current.byteLength < requiredSize) {
        channelBufferDataRef.current = new ArrayBuffer(requiredSize);
        channelDataViewRef.current = new DataView(channelBufferDataRef.current);
      } else {
        new Uint8Array(channelBufferDataRef.current).fill(0, 0, requiredSize);
      }
      fillChannelStates(resolveLiveChannels(p), count, channelDataViewRef.current!, p.padTopChannel);
      let recreated = false;
      if (!channelsBufferRef.current || channelsBufferRef.current.size < requiredSize) {
        if (channelsBufferRef.current) {
          pool.releaseBuffer('channels', channelsBufferRef.current, cellsUsage);
        }
        channelsBufferRef.current = pool.acquireBuffer('channels', requiredSize, cellsUsage, (buf) => {
          device.queue.writeBuffer(buf, 0, channelBufferDataRef.current!);
        }, 'matrix');
        recreated = true;
      } else {
        device.queue.writeBuffer(channelsBufferRef.current, 0, channelBufferDataRef.current!, 0, requiredSize);
      }
      if (recreated || channelsBufferRef.current) refreshBindGroup(device);
    }
  }, [renderParamsRef.current.channels, matrix?.numChannels, padTopChannel, gpuReady, refreshBindGroup]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stable render function — reads from renderParamsRef to avoid stale closures
  const render = useCallback(() => {
    const frameGen = renderGenerationRef.current;
    if (!lifecycleRef.current.isCurrent(frameGen)) return;

    const device = deviceRef.current;
    const pool = poolRef.current;
    const context = contextRef.current;
    const pipeline = pipelineRef.current;
    const bindGroup = bindGroupRef.current;
    const canvas = canvasRef.current;
    if (!device || !pool || pool.isDisposed || !context || !pipeline || !bindGroup || !canvas) {
      return;
    }
    if (
      !uniformBufferRef.current || !cellsBufferRef.current ||
      !pool.isAlive(uniformBufferRef.current) || !pool.isAlive(cellsBufferRef.current)
    ) {
      return;
    }

    // Canvas buffer size can change via ResizeObserver after the last configure().
    // Drawing without reconfigure leaves Chrome with an invalid swapchain (black frame).
    const configured = configuredCanvasSizeRef.current;
    if (!configured || configured.w !== canvas.width || configured.h !== canvas.height) {
      try {
        configureCanvasContext({
          device,
          context,
          format: canvasFormatRef.current ?? undefined,
        });
        configuredCanvasSizeRef.current = { w: canvas.width, h: canvas.height };
        bloomProcessorRef?.current?.resize(canvas.width, canvas.height);
      } catch (e) {
        console.error('[WebGPU] mid-frame configure failed:', e);
        return;
      }
    }

    const p = renderParamsRef.current;

    if (
      audioReactiveUniformBufferRef.current &&
      (usesAudioReactive(shaderFile) || usesAudioReactiveBezel(shaderFile))
    ) {
      const meta = p.audioReactiveRef?.current;
      const bands = meta ? readAudioBands(meta) : {
        bass: 0, mid: 0, high: 0, amplitude: 0, beat: 0,
        peakL: 0, peakR: 0, rmsL: 0, rmsR: 0,
      };
      const enabled = !!(p.reactiveMode && meta);
      packAudioReactiveUniform(
        bands,
        enabled,
        p.bloomIntensity ?? 1,
        audioReactiveUniformDataRef.current,
      );
      device.queue.writeBuffer(
        audioReactiveUniformBufferRef.current,
        0,
        audioReactiveUniformDataRef.current.buffer as ArrayBuffer,
        0,
        AUDIO_REACTIVE_UNIFORM_BYTES,
      );
      // Feed legacy kickTrigger from SAB beat for non-reactive shaders reading playbackStateRef
      if (enabled && p.playbackStateRef?.current) {
        p.playbackStateRef.current.kickTrigger = bands.beat;
      }
    }

    if (usesInstrumentPalette(shaderFile) && p.instrumentPalette && p.instrumentPalette !== instrumentPaletteVersionRef.current) {
      if (instrumentPaletteTextureRef.current) {
        pool.destroyTracked(instrumentPaletteTextureRef.current);
      }
      const texture = pool.track(
        device.createTexture({
          size: [MAX_INSTRUMENT_PALETTE_SIZE, 1, 1],
          format: 'rgba8unorm',
          usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
        }),
        'shader',
      );
      device.queue.writeTexture(
        { texture },
        (p.instrumentPalette as Uint8Array).buffer as ArrayBuffer,
        { bytesPerRow: MAX_INSTRUMENT_PALETTE_SIZE * 4 },
        { width: MAX_INSTRUMENT_PALETTE_SIZE, height: 1, depthOrArrayLayers: 1 },
      );
      instrumentPaletteTextureRef.current = texture;
      instrumentPaletteVersionRef.current = p.instrumentPalette;
      if (!lifecycleRef.current.isCurrent(frameGen)) return;
      refreshBindGroup(device);
    }

    if (uniformBufferRef.current) {
      const numRows = p.matrix?.numRows ?? DEFAULT_ROWS;
      const rawChannels = p.matrix?.numChannels ?? DEFAULT_CHANNELS;
      const numChannels = p.padTopChannel ? rawChannels + 1 : rawChannels;
      if (numChannels <= 0) return;
      const stepsCount = p.stepsLength ?? 32;
      const visibleRows = (stepsCount > 0 && usesStepsDrivenVisibleRows(shaderFile))
        ? Math.min(stepsCount, numRows)
        : numRows;
      const rowLimit = Math.max(1, visibleRows);

      const refState = p.playbackStateRef?.current;
      const livePlayheadRow = refState?.playheadRow ?? p.playheadRow;
      const liveBeatPhase = refState?.beatPhase ?? p.beatPhase;
      const liveKickTrigger = refState?.kickTrigger ?? p.kickTrigger;
      const liveGrooveAmount = refState?.grooveAmount ?? p.grooveAmount;
      const liveTimeSec = refState?.timeSec ?? p.timeSec;

      // DIAGNOSTIC: log playhead every 60 frames to verify animation
      renderFrameCountRef.current++;
      if (renderFrameCountRef.current % 60 === 0) {
        console.log(
          '[PatternDisplay render] playheadRow=%s matrix=%s numRows=%d isPlaying=%s',
          livePlayheadRow.toFixed(2),
          p.matrix ? `order=${p.matrix.order} rows=${p.matrix.numRows} ch=${p.matrix.numChannels}` : 'null',
          numRows,
          p.isPlaying
        );
      }

      const tickRow = clampPlayhead(livePlayheadRow, rowLimit);
      const computedTickOffset = tickRow - Math.floor(tickRow);
      const fractionalTick = Math.min(1, Math.max(0, Number.isFinite(computedTickOffset) ? computedTickOffset : p.tickOffset));
      const effectiveTime = p.isModuleLoaded ? liveTimeSec : p.localTime;

      const actualCanvasW = canvas.width;
      const actualCanvasH = canvas.height;

      let effectiveCellW = p.cellWidth;
      let effectiveCellH = p.cellHeight;
      const cellMode = resolveShaderMeta(shaderFile).cellSizeMode;
      if (cellMode === 'gridRect') {
        effectiveCellW = (GRID_RECT.w * actualCanvasW) / stepsCount;
        effectiveCellH = (GRID_RECT.h * actualCanvasH) / numChannels;
      } else if (cellMode === 'fullCanvas') {
        effectiveCellW = actualCanvasW / stepsCount;
        effectiveCellH = actualCanvasH / numChannels;
      }

      const { innerRadius, outerRadius } = getPolarRadii(actualCanvasW, actualCanvasH, shaderFile);

      const uniformByteLength = fillUniformPayload(layoutTypeRef.current, {
        numRows: visibleRows, numChannels,
        playheadRow: tickRow,
        playheadRowAsFloat: usesPlayheadRowAsFloat(shaderFile),
        isPlaying: p.isPlaying,
        cellW: effectiveCellW, cellH: effectiveCellH,
        canvasW: actualCanvasW, canvasH: actualCanvasH,
        tickOffset: fractionalTick,
        bpm: p.bpm, timeSec: effectiveTime,
        beatPhase: liveBeatPhase,
        groove: Math.min(1, Math.max(0, liveGrooveAmount)),
        kickTrigger: liveKickTrigger,
        activeChannels: p.activeChannels,
        isModuleLoaded: p.isModuleLoaded,
        bloomIntensity: p.bloomIntensity,
        bloomThreshold: p.bloomThreshold,
        invertChannels: p.invertChannels,
        dimFactor: p.dimFactor,
        innerRadius,
        outerRadius,
        colorPalette: p.colorPalette ?? 0,
        gridRect: GRID_RECT,
        // Night Mode 2.0
        vignetteStrength: p.vignetteStrength ?? 0.0,
        themeBlend: p.themeBlend ?? 0.0,
        filmGrain: p.filmGrain ?? 0.0,
        nightPreset: p.nightPreset ?? 0,
        invertMix: p.invertMix ?? 0.0,
        paletteMode: p.paletteMode ?? 0,
        // Only pass stepsLength for shaders that use it at slot [24];
        // for circular shaders slot [24] is colorPalette, so stepsLength must be absent.
        ...(supportsStepsLength(shaderFile)
          ? { stepsLength: p.stepsLength ?? 32 }
          : {}),
      }, uniformUintRef.current, uniformFloatRef.current);
      device.queue.writeBuffer(uniformBufferRef.current, 0, uniformBufferDataRef.current, 0, uniformByteLength);
    }

    // TIMING FIX: Upload live channel shadow state every frame (noteAge, VU, trigger).
    if (layoutTypeRef.current === 'extended' && channelsBufferRef.current && channelDataViewRef.current) {
      const rawCh = p.matrix?.numChannels ?? DEFAULT_CHANNELS;
      const channelsCount = Math.max(1, rawCh);
      const totalCount = p.padTopChannel ? channelsCount + 1 : channelsCount;
      const requiredSize = totalCount * 32;
      if (channelBufferDataRef.current && channelBufferDataRef.current.byteLength >= requiredSize) {
        fillChannelStates(resolveLiveChannels(p), channelsCount, channelDataViewRef.current, p.padTopChannel);
        device.queue.writeBuffer(channelsBufferRef.current, 0, channelBufferDataRef.current, 0, requiredSize);
      }
    }

    // Handle video texture source
    const isVideoShader = usesVideoPatternTexture(shaderFile);
    const source = p.externalVideoSource;
    if (isVideoShader && source) {
      videoRef.current = source;
      let sourceWidth = 0, sourceHeight = 0, sourceReady = false;
      if (source instanceof HTMLVideoElement && source.readyState >= 2) { sourceWidth = source.videoWidth; sourceHeight = source.videoHeight; sourceReady = true; }
      else if (source instanceof HTMLImageElement && source.complete) { sourceWidth = source.naturalWidth; sourceHeight = source.naturalHeight; sourceReady = true; }
      if (sourceReady && sourceWidth > 0 && sourceHeight > 0) {
        if (!videoTextureRef.current || videoTextureRef.current.width !== sourceWidth || videoTextureRef.current.height !== sourceHeight) {
          if (videoTextureRef.current) {
            pool.destroyTracked(videoTextureRef.current);
          }
          videoTextureRef.current = pool.track(
            device.createTexture({ size: [sourceWidth, sourceHeight, 1], format: preferredImageFormat(device), usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT }),
            'shader',
          );
          textureResourcesRef.current = { sampler: device.createSampler({ magFilter: 'linear', minFilter: 'linear' }), view: videoTextureRef.current.createView() };
          if (!lifecycleRef.current.isCurrent(frameGen)) return;
          refreshBindGroup(device);
        }
        try { if (videoTextureRef.current) device.queue.copyExternalImageToTexture({ source, flipY: true }, { texture: videoTextureRef.current }, [sourceWidth, sourceHeight, 1]); } catch { /* ignore */ }
      }
    }

    // Pre-calculate channel/instance counts for debug info
    const numRows = p.matrix?.numRows ?? DEFAULT_ROWS;
    const stepsCount = p.stepsLength ?? 32;
    const visibleRows = (stepsCount > 0 && usesStepsDrivenVisibleRows(shaderFile))
      ? Math.min(stepsCount, numRows)
      : numRows;
    const rawChannels = p.matrix?.numChannels ?? DEFAULT_CHANNELS;
    const numChannels = p.padTopChannel ? rawChannels + 1 : rawChannels;
    let totalInstances = visibleRows * numChannels;
    totalInstances += getUiExtraInstances(shaderFile);

    // Scene render helper — reused by both direct and bloom-wrapped paths
    const renderScene = (pass: GPURenderPassEncoder) => {
      // Background pass (bezel/chassis shader)
      const needsBackground = !isSinglePassCompositeShader(shaderFile);
      if (bezelPipelineRef.current && bezelBindGroupRef.current && needsBackground && bezelUniformBufferRef.current) {
        const actualCanvasW = canvas.width;
        const actualCanvasH = canvas.height;
        const minDim = Math.min(actualCanvasW, actualCanvasH);
        const isCircShader = isCircularLayoutShader(shaderFile);
        const backgroundShader = getBackgroundShaderFile(shaderFile);
        const needsUIFields = needsChassisControlFields(shaderFile);

        const bezelData = bezelFloatRef.current;
        bezelData[0] = actualCanvasW;
        bezelData[1] = actualCanvasH;
        bezelData[2] = minDim * (isCircShader ? 0.05 : 0.07);

        if (p.chassisDark) {
          bezelData[3] = 0.06; bezelData[4] = 0.06; bezelData[5] = 0.07;
          bezelData[6] = 0.04; bezelData[7] = 0.04; bezelData[8] = 0.05;
          bezelData[9] = 0.04;
        } else {
          bezelData[3] = 0.92; bezelData[4] = 0.93; bezelData[5] = 0.95;
          bezelData[6] = 0.88; bezelData[7] = 0.89; bezelData[8] = 0.91;
          bezelData[9] = 0.015;
        }

        if (usesNightModeBezel(shaderFile)) {
          bezelData[10] = 0.0; bezelData[11] = 0.95; bezelData[12] = 0.32;
        } else {
          bezelData[10] = isCircShader ? 0.0 : 1.0;
          bezelData[11] = isCircShader ? 0.95 : 1.25;
          bezelData[12] = isCircShader ? 0.32 : 0.0;
        }
        bezelData[13] = usesNightModeBezel(shaderFile) ? 0.10 : (isCircShader ? 0.0 : 0.02);
        bezelData[14] = p.dimFactor ?? 1.0;
        bezelData[15] = p.isPlaying ? 1.0 : 0.0;

        if (needsUIFields) {
          const livePlayheadRow = p.playbackStateRef?.current?.playheadRow ?? p.playheadRow;
          bezelData[16] = p.volume;
          bezelData[17] = p.pan;
          bezelData[18] = p.bpm ?? 120.0;

          const chassisEnc = resolveShaderMeta(shaderFile).chassisControlEncoding;
          if (chassisEnc === 'frosted-f32' || backgroundShader === 'chassis_frosted.wgsl') {
            // chassis_frosted.wgsl uses f32 for all fields
            bezelData[19] = p.isLooping ? 1.0 : 0.0;
            bezelData[20] = 0.0; // currentOrder
            bezelData[21] = livePlayheadRow;
            bezelData[22] = p.clickedButton;
            bezelData[23] = 0.0; // _pad2
          } else {
            // chassisv0.37.wgsl uses u32 for indices 19-22
            const bezelUint = bezelUintRef.current;
            bezelUint[19] = p.isLooping ? 1 : 0;
            bezelUint[20] = 0; // currentOrder
            bezelUint[21] = Math.floor(livePlayheadRow);
            bezelUint[22] = p.clickedButton;
            // _pad2 at index 23 can stay as 0.0
          }
        }

        device.queue.writeBuffer(bezelUniformBufferRef.current, 0, bezelBufferDataRef.current, 0, 96);
        pass.setPipeline(bezelPipelineRef.current);
        pass.setBindGroup(0, bezelBindGroupRef.current);
        pass.draw(6, 1, 0, 0);
      }

      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);

      if (totalInstances > 0) {
        if (isSinglePassCompositeShader(shaderFile)) {
          // Shaders with embedded UI quads (uiExtraInstances) draw all instances in one call
          if (getUiExtraInstances(shaderFile) > 0) {
            pass.draw(6, totalInstances, 0, 0);
          } else {
            pass.draw(6, 1, 0, totalInstances);
            pass.draw(6, totalInstances, 0, 0);
          }
        } else {
          pass.draw(6, totalInstances, 0, 0);
        }
      }
    };

    const encoder = device.createCommandEncoder();
    if (!lifecycleRef.current.isCurrent(frameGen)) return;
    if (bloomProcessorRef?.current) {
      bloomProcessorRef.current.render(encoder, renderScene);
    } else {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          loadOp: 'clear',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          storeOp: 'store',
        }],
      });
      renderScene(pass);
      pass.end();
    }
    device.queue.submit([encoder.finish()]);

    if (import.meta.env.DEV && renderFrameCountRef.current % 600 === 0) {
      poolRef.current?.logStats('WebGPU render');
    }

    // Update debug info - always update regardless of overlay state
    const isOverlayActive = WEBGL_HYBRID_SHADERS.has(shaderFile);
    const layoutModeName = isCircularLayoutShader(shaderFile) ? 'CIRCULAR (WebGPU)' :
      p.isHorizontal ? 'HORIZONTAL (WebGPU)' : 'STANDARD (WebGPU)';
    setDebugInfo((prev: DebugInfo) => ({
      ...prev,
      layoutMode: layoutModeName,
      uniforms: {
        shader: shaderFile,
        overlay: isOverlayActive ? 'ACTIVE' : 'NONE',
        numRows: p.matrix?.numRows ?? DEFAULT_ROWS,
        numChannels,
        totalInstances,
        playheadRow: (p.playbackStateRef?.current?.playheadRow ?? p.playheadRow).toFixed(2),
      },
      // Preserve device lifecycle messages (lost / init) — do not wipe every frame.
      errors: prev.errors.filter(
        (e) => e.startsWith('DEVICE-LOST') || e.startsWith('DEVICE-INIT'),
      ),
    }));
  }, [shaderFile, setDebugInfo, refreshBindGroup]); // reads renderParamsRef; shaderFile is stable per init cycle

  return { gpuReady, render, deviceRef, deviceStatus, contextRef };
}
