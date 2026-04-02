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
} from '../utils/shaderVersion';
import {
  alignTo,
  clampPlayhead,
  fillUniformPayload,
  fillChannelStates,
  packPatternMatrix,
  packPatternMatrixHighPrecision,
  createBufferWithData,
  buildRowFlags,
  DEFAULT_ROWS,
  DEFAULT_CHANNELS,
} from '../utils/gpuPacking';
import { GRID_RECT } from '../utils/geometryConstants';

// Runtime base URL detection for subdirectory deployment
const detectRuntimeBase = (): string => {
  const viteBase = import.meta.env.BASE_URL;
  if (viteBase && viteBase !== '/') {
    return viteBase.endsWith('/') ? viteBase : `${viteBase}/`;
  }
  const pathSegments = window.location.pathname.split('/').filter(Boolean);
  if (pathSegments.length > 0) {
    return `/${pathSegments[0]}/`;
  }
  return '/';
};

export type DebugInfo = {
  layoutMode: string;
  errors: string[];
  uniforms: Record<string, number | string>;
  visible: boolean;
};

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
  canvasMetrics: { width: number; height: number };
  totalRows?: number;
}

export function useWebGPURender(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  glCanvasRef: React.RefObject<HTMLCanvasElement>,
  shaderFile: string,
  syncCanvasSize: (canvas: HTMLCanvasElement, gl: HTMLCanvasElement | null) => void,
  renderParamsRef: React.MutableRefObject<WebGPURenderParams>,
  setDebugInfo: React.Dispatch<React.SetStateAction<DebugInfo>>,
  setWebgpuAvailable: (v: boolean) => void
) {
  const [gpuReady, setGpuReady] = useState(false);

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
  const bezelPipelineRef = useRef<GPURenderPipeline | null>(null);
  const bezelBindGroupRef = useRef<GPUBindGroup | null>(null);
  const bezelUniformBufferRef = useRef<GPUBuffer | null>(null);

  // Persistent typed arrays to avoid GC pressure
  const uniformBufferDataRef = useRef(new ArrayBuffer(96));
  const uniformUintRef = useRef(new Uint32Array(uniformBufferDataRef.current));
  const uniformFloatRef = useRef(new Float32Array(uniformBufferDataRef.current));
  const bezelBufferDataRef = useRef(new ArrayBuffer(128));
  const bezelFloatRef = useRef(new Float32Array(bezelBufferDataRef.current));
  const bezelUintRef = useRef(new Uint32Array(bezelBufferDataRef.current));
  const channelBufferDataRef = useRef<ArrayBuffer | null>(null);
  const channelDataViewRef = useRef<DataView | null>(null);

  const preferredImageFormat = (device: GPUDevice): GPUTextureFormat =>
    device.features.has('float32-filterable') ? 'rgba32float' : 'rgba8unorm';

  const refreshBindGroup = useCallback((device: GPUDevice) => {
    if (!pipelineRef.current || !cellsBufferRef.current || !uniformBufferRef.current) return;
    const layout = pipelineRef.current.getBindGroupLayout(0);
    const layoutType = layoutTypeRef.current;
    const entries: GPUBindGroupEntry[] = [
      { binding: 0, resource: { buffer: cellsBufferRef.current, size: cellsBufferRef.current.size } },
      { binding: 1, resource: { buffer: uniformBufferRef.current } },
    ];
    if (layoutType === 'extended') {
      if (!rowFlagsBufferRef.current || !channelsBufferRef.current || !textureResourcesRef.current) return;
      entries.push(
        { binding: 2, resource: { buffer: rowFlagsBufferRef.current } },
        { binding: 3, resource: { buffer: channelsBufferRef.current } },
        { binding: 4, resource: textureResourcesRef.current.sampler },
        { binding: 5, resource: textureResourcesRef.current.view },
      );
    } else if (layoutType === 'texture') {
      if (!textureResourcesRef.current) return;
      entries.push(
        { binding: 2, resource: textureResourcesRef.current.sampler },
        { binding: 3, resource: textureResourcesRef.current.view },
      );
    }
    bindGroupRef.current = device.createBindGroup({ layout, entries });
  }, []);

  const loadBezelTexture = async (device: GPUDevice) => {
    if (bezelTextureResourcesRef.current) return;
    const textureName = (shaderFile.includes('v0.39') || shaderFile.includes('v0.40') || shaderFile.includes('v0.43') || shaderFile.includes('v0.44')) ? `./bezel-square.png` : `./bezel.png`;
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
    const texture = device.createTexture({ size: [bitmap.width, bitmap.height, 1], format: preferredImageFormat(device), usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    device.queue.copyExternalImageToTexture({ source: bitmap, flipY: true }, { texture }, [bitmap.width, bitmap.height, 1]);
    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    bezelTextureResourcesRef.current = { sampler, view: texture.createView() };
  };

  const ensureButtonTexture = async (device: GPUDevice) => {
    if (textureResourcesRef.current) return;
    const runtimeBase = detectRuntimeBase();
    const textureUrl = shaderFile.includes('v0.30')
      ? `${runtimeBase}unlit-button-2.png`
      : `${runtimeBase}unlit-button.png`;
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
    const texture = device.createTexture({ size: [bitmap.width, bitmap.height, 1], format: preferredImageFormat(device), usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    device.queue.copyExternalImageToTexture({ source: bitmap, flipY: true }, { texture }, [bitmap.width, bitmap.height, 1]);
    const sampler = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' });
    textureResourcesRef.current = { sampler, view: texture.createView() };
  };

  const ensureVideoPlaceholder = (device: GPUDevice) => {
    if (videoTextureRef.current) return;
    const fmt = preferredImageFormat(device);
    const texture = device.createTexture({
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

  // Main WebGPU initialization
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!('gpu' in navigator)) { setWebgpuAvailable(false); return; }
    let cancelled = false;

    const init = async () => {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter || cancelled) { setWebgpuAvailable(false); return; }
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
        if (!device || cancelled) { setWebgpuAvailable(false); return; }

        const context = canvas.getContext('webgpu') as GPUCanvasContext;
        const format = navigator.gpu.getPreferredCanvasFormat();
        context.configure({ device, format, alphaMode: 'premultiplied' });

        textureResourcesRef.current = null;
        bezelTextureResourcesRef.current = null;

        const shaderBase = import.meta.env.BASE_URL;
        const shaderSource = await fetch(`${shaderBase}shaders/${shaderFile}`).then(r => r.text());
        if (cancelled) return;
        const module = device.createShaderModule({ code: shaderSource });
        if ('getCompilationInfo' in module) module.getCompilationInfo().catch(() => {});

        const layoutType = getLayoutType(shaderFile);
        layoutTypeRef.current = layoutType;
        useExtendedRef.current = layoutType === 'extended';
        if (layoutType !== 'extended') {
          rowFlagsBufferRef.current?.destroy(); rowFlagsBufferRef.current = null;
          channelsBufferRef.current?.destroy(); channelsBufferRef.current = null;
        }

        let bindGroupLayout: GPUBindGroupLayout;
        if (layoutType === 'texture') {
          bindGroupLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }, { binding: 1, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }, { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } }, { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }] });
        } else if (layoutType === 'extended') {
          bindGroupLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }, { binding: 1, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }, { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } }, { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } }, { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } }, { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }] });
        } else {
          bindGroupLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }, { binding: 1, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }] });
        }

        const enableAlphaBlend = shouldEnableAlphaBlending(shaderFile);
        const targets: GPUColorTargetState[] = [{ format, ...(enableAlphaBlend ? { blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } } : {}) }];
        try {
          pipelineRef.current = device.createRenderPipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }), vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets }, primitive: { topology: 'triangle-list' } });
        } catch {
          pipelineRef.current = device.createRenderPipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }), vertex: { module, entryPoint: 'vertex_main' }, fragment: { module, entryPoint: 'fragment_main', targets }, primitive: { topology: 'triangle-list' } });
        }

        const uniformSize = layoutType === 'extended' ? 96 : (layoutType === 'texture' ? 64 : 32);
        const uniformBuffer = device.createBuffer({ size: alignTo(uniformSize, 256), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

        if (shouldUseBackgroundPass(shaderFile)) {
          try {
            const backgroundShaderFile = getBackgroundShaderFile(shaderFile);
            const backgroundSource = await fetch(`${shaderBase}shaders/${backgroundShaderFile}`).then(r => r.text());
            const bezelModule = device.createShaderModule({ code: backgroundSource });
            const bezelBindLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }, { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } }, { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }] });
            bezelPipelineRef.current = device.createRenderPipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [bezelBindLayout] }), vertex: { module: bezelModule, entryPoint: 'vs' }, fragment: { module: bezelModule, entryPoint: 'fs', targets: [{ format }] }, primitive: { topology: 'triangle-list' } });
            bezelUniformBufferRef.current = device.createBuffer({ size: alignTo(96, 256), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
            await loadBezelTexture(device);
            bezelBindGroupRef.current = device.createBindGroup({ layout: bezelBindLayout, entries: [{ binding: 0, resource: { buffer: bezelUniformBufferRef.current } }, { binding: 1, resource: bezelTextureResourcesRef.current!.sampler }, { binding: 2, resource: bezelTextureResourcesRef.current!.view }] });
          } catch (e) { console.warn('Failed to initialize bezel shader', e); }
        } else {
          bezelPipelineRef.current = null; bezelBindGroupRef.current = null;
          if (bezelUniformBufferRef.current) { bezelUniformBufferRef.current.destroy(); bezelUniformBufferRef.current = null; }
        }

        deviceRef.current = device; contextRef.current = context; uniformBufferRef.current = uniformBuffer;

        const p = renderParamsRef.current;
        const isHighPrec = shaderFile.includes('v0.36') || shaderFile.includes('v0.37') || shaderFile.includes('v0.38') || shaderFile.includes('v0.39') || shaderFile.includes('v0.40') || shaderFile.includes('v0.42') || shaderFile.includes('v0.43') || shaderFile.includes('v0.44') || shaderFile.includes('v0.45') || shaderFile.includes('v0.46') || shaderFile.includes('v0.47') || shaderFile.includes('v0.48') || shaderFile.includes('v0.49') || shaderFile.includes('v0.50');
        const packFunc = isHighPrec ? packPatternMatrixHighPrecision : packPatternMatrix;
        const { packedData } = packFunc(p.matrix, p.padTopChannel);
        cellsBufferRef.current = createBufferWithData(device, packedData, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);

        if (layoutType === 'extended') {
          const numRows = p.matrix?.numRows ?? DEFAULT_ROWS;
          rowFlagsBufferRef.current = createBufferWithData(device, buildRowFlags(numRows), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
          const channelsCount = Math.max(1, p.matrix?.numChannels ?? DEFAULT_CHANNELS);
          const totalCount = p.padTopChannel ? channelsCount + 1 : channelsCount;
          const requiredSize = totalCount * 32;
          const buffer = new ArrayBuffer(requiredSize);
          fillChannelStates([], channelsCount, new DataView(buffer), p.padTopChannel);
          channelsBufferRef.current = createBufferWithData(device, buffer, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
        }

        const needsTexture = layoutType === 'texture' || layoutType === 'extended';
        if (needsTexture) {
          const isVideoShader = shaderFile.includes('v0.20') || shaderFile.includes('v0.23') || shaderFile.includes('v0.24') || shaderFile.includes('v0.25');
          if (isVideoShader) ensureVideoPlaceholder(device); else await ensureButtonTexture(device);
        }

        refreshBindGroup(device);

        const glCanvas = glCanvasRef.current;
        if (canvas && glCanvas) syncCanvasSize(canvas, glCanvas);

        setGpuReady(true);
      } catch (error) {
        console.error('Failed to initialize WebGPU pattern display', error);
        if (!cancelled) setWebgpuAvailable(false);
      }
    };

    init();
    return () => {
      cancelled = true;
      setGpuReady(false);
      bindGroupRef.current = null;
      pipelineRef.current = null;
      if (bezelUniformBufferRef.current) {
        try { bezelUniformBufferRef.current.destroy(); } catch (e) {}
        bezelUniformBufferRef.current = null;
      }
      bezelBindGroupRef.current = null;
      bezelPipelineRef.current = null;
      bezelTextureResourcesRef.current = null;
      cellsBufferRef.current = null;
      uniformBufferRef.current = null;
      rowFlagsBufferRef.current = null;
      channelsBufferRef.current = null;
      textureResourcesRef.current = null;
      if (videoTextureRef.current) {
        try { videoTextureRef.current.destroy(); } catch (e) {}
        videoTextureRef.current = null;
      }
      if (deviceRef.current) {
        try { deviceRef.current.destroy(); } catch (e) {}
      }
      deviceRef.current = null;
      contextRef.current = null;
    };
  }, [shaderFile, syncCanvasSize]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update cells buffer when matrix changes
  useEffect(() => {
    const device = deviceRef.current;
    if (!device || !gpuReady) return;
    const p = renderParamsRef.current;
    console.log(`[PatternDisplay] Updating cells buffer: matrix=${p.matrix ? 'yes' : 'null'}, rows=${p.matrix?.numRows}, channels=${p.matrix?.numChannels}`);
    if (cellsBufferRef.current) cellsBufferRef.current.destroy();
    const isHighPrec = shaderFile.includes('v0.36') || shaderFile.includes('v0.37') || shaderFile.includes('v0.38') || shaderFile.includes('v0.39') || shaderFile.includes('v0.40') || shaderFile.includes('v0.42') || shaderFile.includes('v0.43') || shaderFile.includes('v0.44') || shaderFile.includes('v0.45') || shaderFile.includes('v0.46') || shaderFile.includes('v0.47') || shaderFile.includes('v0.48') || shaderFile.includes('v0.49') || shaderFile.includes('v0.50');
    const packFunc = isHighPrec ? packPatternMatrixHighPrecision : packPatternMatrix;
    const { packedData, noteCount } = packFunc(p.matrix, p.padTopChannel);
    console.log(`[PatternDisplay] Packed data contains ${noteCount} notes in ${packedData.length / 2} cells`);
    cellsBufferRef.current = createBufferWithData(device, packedData, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    if (layoutTypeRef.current === 'extended') {
      const numRows = p.matrix?.numRows ?? DEFAULT_ROWS;
      const flags = buildRowFlags(numRows);
      if (!rowFlagsBufferRef.current || rowFlagsBufferRef.current.size < flags.byteLength) {
        rowFlagsBufferRef.current?.destroy();
        rowFlagsBufferRef.current = createBufferWithData(device, flags, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
      } else {
        device.queue.writeBuffer(rowFlagsBufferRef.current, 0, flags.buffer, flags.byteOffset, flags.byteLength);
      }
    }
    refreshBindGroup(device);
  }, [renderParamsRef.current.matrix, gpuReady, shaderFile, refreshBindGroup]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update channel states buffer
  useEffect(() => {
    const device = deviceRef.current;
    if (!device || !gpuReady) return;
    const p = renderParamsRef.current;
    if (layoutTypeRef.current === 'extended') {
      const count = Math.max(1, p.matrix?.numChannels ?? DEFAULT_CHANNELS);
      const totalCount = p.padTopChannel ? count + 1 : count;
      const requiredSize = totalCount * 32;
      if (!channelBufferDataRef.current || channelBufferDataRef.current.byteLength < requiredSize) {
        channelBufferDataRef.current = new ArrayBuffer(requiredSize);
        channelDataViewRef.current = new DataView(channelBufferDataRef.current);
      }
      fillChannelStates(p.channels, count, channelDataViewRef.current!, p.padTopChannel);
      let recreated = false;
      if (!channelsBufferRef.current || channelsBufferRef.current.size < requiredSize) {
        channelsBufferRef.current?.destroy();
        channelsBufferRef.current = createBufferWithData(device, channelBufferDataRef.current!, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
        recreated = true;
      } else {
        device.queue.writeBuffer(channelsBufferRef.current, 0, channelBufferDataRef.current!, 0, requiredSize);
      }
      if (recreated) refreshBindGroup(device);
    }
  }, [renderParamsRef.current.channels, renderParamsRef.current.matrix?.numChannels, gpuReady, refreshBindGroup]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stable render function — reads from renderParamsRef to avoid stale closures
  const render = useCallback(() => {
    const device = deviceRef.current;
    const context = contextRef.current;
    const pipeline = pipelineRef.current;
    const bindGroup = bindGroupRef.current;
    const canvas = canvasRef.current;
    if (!device || !context || !pipeline || !bindGroup || !uniformBufferRef.current || !cellsBufferRef.current || !canvas) {
      return;
    }

    const p = renderParamsRef.current;

    if (uniformBufferRef.current) {
      const numRows = p.matrix?.numRows ?? DEFAULT_ROWS;
      const rawChannels = p.matrix?.numChannels ?? DEFAULT_CHANNELS;
      const numChannels = p.padTopChannel ? rawChannels + 1 : rawChannels;
      const rowLimit = Math.max(1, numRows);

      const refState = p.playbackStateRef?.current;
      const livePlayheadRow = refState?.playheadRow ?? p.playheadRow;
      const liveBeatPhase = refState?.beatPhase ?? p.beatPhase;
      const liveKickTrigger = refState?.kickTrigger ?? p.kickTrigger;
      const liveGrooveAmount = refState?.grooveAmount ?? p.grooveAmount;
      const liveTimeSec = refState?.timeSec ?? p.timeSec;

      const tickRow = clampPlayhead(livePlayheadRow, rowLimit);
      const computedTickOffset = tickRow - Math.floor(tickRow);
      const fractionalTick = Math.min(1, Math.max(0, Number.isFinite(computedTickOffset) ? computedTickOffset : p.tickOffset));
      const effectiveTime = p.isModuleLoaded ? liveTimeSec : p.localTime;

      const actualCanvasW = canvas.width;
      const actualCanvasH = canvas.height;

      let effectiveCellW = p.cellWidth;
      let effectiveCellH = p.cellHeight;
      if (shaderFile.includes('v0.21') || shaderFile.includes('v0.40') || shaderFile.includes('v0.43') || shaderFile.includes('v0.44') || shaderFile.includes('v0.45') || shaderFile.includes('v0.46') || shaderFile.includes('v0.47') || shaderFile.includes('v0.48') || shaderFile.includes('v0.49') || shaderFile.includes('v0.50')) {
        effectiveCellW = (GRID_RECT.w * actualCanvasW) / 32.0;
        effectiveCellH = (GRID_RECT.h * actualCanvasH) / numChannels;
      } else if (shaderFile.includes('v0.39')) {
        effectiveCellW = actualCanvasW / 32.0;
        effectiveCellH = actualCanvasH / numChannels;
      }

      const uniformByteLength = fillUniformPayload(layoutTypeRef.current, {
        numRows, numChannels,
        playheadRow: tickRow,
        playheadRowAsFloat: shaderFile.includes('v0.21') || shaderFile.includes('v0.39') || shaderFile.includes('v0.40') || shaderFile.includes('v0.42') || shaderFile.includes('v0.43') || shaderFile.includes('v0.44') || shaderFile.includes('v0.45') || shaderFile.includes('v0.46') || shaderFile.includes('v0.47') || shaderFile.includes('v0.48') || shaderFile.includes('v0.49') || shaderFile.includes('v0.50'),
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
        gridRect: GRID_RECT,
      }, uniformUintRef.current, uniformFloatRef.current);
      device.queue.writeBuffer(uniformBufferRef.current, 0, uniformBufferDataRef.current, 0, uniformByteLength);
    }

    if (bezelUniformBufferRef.current) {
      const buf = bezelFloatRef.current;
      const actualCanvasW = canvas.width;
      const actualCanvasH = canvas.height;
      buf[0] = actualCanvasW; buf[1] = actualCanvasH;
      const minDim = Math.min(actualCanvasW, actualCanvasH);
      const circularLayout = isCircularLayoutShader(shaderFile);
      buf[2] = minDim * (circularLayout ? 0.05 : 0.07);
      buf[3] = 0.98; buf[4] = 0.98; buf[5] = 0.98;
      buf[6] = 0.92; buf[7] = 0.92; buf[8] = 0.93;
      buf[9] = 0.02;
      if (shaderFile.includes('v0.35')) { buf[10] = 0.0; buf[11] = 0.95; buf[12] = 0.32; }
      else { buf[10] = circularLayout ? 0.0 : 1.0; buf[11] = circularLayout ? 1.0 : 1.25; buf[12] = circularLayout ? 1.0 : 0.0; }
      buf[13] = 0.10;
      buf[14] = p.dimFactor;
      buf[15] = p.isPlaying ? 1.0 : 0.0;
      buf[16] = p.volume;
      buf[17] = p.pan;
      buf[18] = p.bpm;
      const uint32View = bezelUintRef.current;
      uint32View[19] = p.isLooping ? 1 : 0;
      uint32View[20] = 0;
      const livePlayheadRow = p.playbackStateRef?.current?.playheadRow ?? p.playheadRow;
      buf[21] = livePlayheadRow;
      uint32View[22] = p.clickedButton;
      device.queue.writeBuffer(bezelUniformBufferRef.current, 0, bezelBufferDataRef.current, 0, 96);
    }

    // Handle video texture source
    const isVideoShader = shaderFile.includes('v0.20') || shaderFile.includes('v0.23') || shaderFile.includes('v0.24') || shaderFile.includes('v0.25');
    const source = p.externalVideoSource;
    if (isVideoShader && source) {
      videoRef.current = source;
      let sourceWidth = 0, sourceHeight = 0, sourceReady = false;
      if (source instanceof HTMLVideoElement && source.readyState >= 2) { sourceWidth = source.videoWidth; sourceHeight = source.videoHeight; sourceReady = true; }
      else if (source instanceof HTMLImageElement && source.complete) { sourceWidth = source.naturalWidth; sourceHeight = source.naturalHeight; sourceReady = true; }
      if (sourceReady && sourceWidth > 0 && sourceHeight > 0) {
        if (!videoTextureRef.current || videoTextureRef.current.width !== sourceWidth || videoTextureRef.current.height !== sourceHeight) {
          videoTextureRef.current?.destroy();
          videoTextureRef.current = device.createTexture({ size: [sourceWidth, sourceHeight, 1], format: preferredImageFormat(device), usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
          textureResourcesRef.current = { sampler: device.createSampler({ magFilter: 'linear', minFilter: 'linear' }), view: videoTextureRef.current.createView() };
          refreshBindGroup(device);
        }
        try { if (videoTextureRef.current) device.queue.copyExternalImageToTexture({ source, flipY: true }, { texture: videoTextureRef.current }, [sourceWidth, sourceHeight, 1]); } catch (e) {}
      }
    }

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp: 'clear',
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        storeOp: 'store',
      }],
    });

    // Background pass (bezel/chassis shader)
    const needsBackground = !isSinglePassCompositeShader(shaderFile);
    if (bezelPipelineRef.current && bezelBindGroupRef.current && needsBackground && bezelUniformBufferRef.current) {
      const bezelData = bezelFloatRef.current;
      bezelData[0] = p.canvasMetrics.width; bezelData[1] = p.canvasMetrics.height;
      bezelData[2] = 0;
      bezelData[3] = 0.92; bezelData[4] = 0.93; bezelData[5] = 0.95;
      bezelData[6] = 0.88; bezelData[7] = 0.89; bezelData[8] = 0.91;
      bezelData[9] = 0.015;
      const isCircShader = isCircularLayoutShader(shaderFile);
      bezelData[10] = isCircShader ? 0.0 : 1.0;
      bezelData[11] = isCircShader ? 0.95 : 1.0;
      bezelData[12] = isCircShader ? 0.32 : 0.0;
      bezelData[13] = isCircShader ? 0.0 : 0.02;
      bezelData[14] = p.dimFactor ?? 1.0;
      bezelData[15] = p.isPlaying ? 1.0 : 0.0;
      bezelData[16] = 1.0; bezelData[17] = 0.5;
      bezelData[18] = p.bpm ?? 120.0;
      const bezelUint = bezelUintRef.current;
      bezelUint[19] = p.isLooping ? 1 : 0;
      bezelUint[20] = 0;
      bezelUint[21] = Math.floor(p.playheadRow);
      bezelUint[22] = 0;
      bezelData[20] = GRID_RECT.x; bezelData[21] = GRID_RECT.y;
      bezelData[22] = GRID_RECT.w; bezelData[23] = GRID_RECT.h;
      device.queue.writeBuffer(bezelUniformBufferRef.current, 0, bezelBufferDataRef.current, 0, 96);
      pass.setPipeline(bezelPipelineRef.current);
      pass.setBindGroup(0, bezelBindGroupRef.current);
      pass.draw(6, 1, 0, 0);
    }

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    const numRows = p.matrix?.numRows ?? DEFAULT_ROWS;
    const rawChannels = p.matrix?.numChannels ?? DEFAULT_CHANNELS;
    const numChannels = p.padTopChannel ? rawChannels + 1 : rawChannels;
    let totalInstances = numRows * numChannels;

    const isUIShader = shaderFile.includes('v0.45');
    if (isUIShader) totalInstances += 3; // UI_BUTTON_COUNT in shader

    if (totalInstances > 0) {
      if (isSinglePassCompositeShader(shaderFile)) {
        if (shaderFile.includes('v0.45')) {
          pass.draw(6, totalInstances, 0, 0);
        } else {
          pass.draw(6, 1, 0, totalInstances);
          pass.draw(6, totalInstances, 0, 0);
        }
      } else {
        pass.draw(6, totalInstances, 0, 0);
      }
    }
    pass.end();
    device.queue.submit([encoder.finish()]);

    // Update debug info
    const isOverlayActive = shaderFile.includes('v0.21') || shaderFile.includes('v0.38') || shaderFile.includes('v0.39') || shaderFile.includes('v0.40') || shaderFile.includes('v0.42') || shaderFile.includes('v0.43') || shaderFile.includes('v0.44') || shaderFile.includes('v0.45') || shaderFile.includes('v0.46') || shaderFile.includes('v0.47') || shaderFile.includes('v0.48') || shaderFile.includes('v0.49') || shaderFile.includes('v0.50');
    if (!isOverlayActive) {
      const layoutModeName = isCircularLayoutShader(shaderFile) ? 'CIRCULAR (WebGPU)' :
        p.isHorizontal ? 'HORIZONTAL (WebGPU)' : 'STANDARD (WebGPU)';
      setDebugInfo((prev: DebugInfo) => ({
        ...prev,
        layoutMode: layoutModeName,
        uniforms: {
          shader: shaderFile,
          numRows: p.matrix?.numRows ?? DEFAULT_ROWS,
          numChannels,
          totalInstances,
          playheadRow: (p.playbackStateRef?.current?.playheadRow ?? p.playheadRow).toFixed(2),
        },
        errors: [],
      }));
    }
  }, [shaderFile, setDebugInfo, refreshBindGroup]); // reads renderParamsRef; shaderFile is stable per init cycle

  return { gpuReady, render, deviceRef };
}
