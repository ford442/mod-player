import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ChannelShadowState, PatternMatrix } from '../types';

const EMPTY_CHANNEL: ChannelShadowState = { volume: 0, pan: 0, freq: 0, trigger: 0, noteAge: 0, activeEffect: 0, effectValue: 0, isMuted: 0 };
type LayoutType = 'simple' | 'texture' | 'extended';

const DEFAULT_ROWS = 64;
const DEFAULT_CHANNELS = 8;

const alignTo = (value: number, alignment: number) => Math.ceil(value / alignment) * alignment;
const getLayoutType = (shaderFile: string): LayoutType => {
  if (shaderFile === 'patternShaderv0.12.wgsl') return 'texture';
  if (shaderFile === 'patternv0.13.wgsl' || shaderFile === 'patternv0.14.wgsl' || shaderFile === 'patternv0.16.wgsl' || shaderFile === 'patternv0.17.wgsl' || shaderFile === 'patternv0.18.wgsl' || shaderFile === 'patternv0.19.wgsl' || shaderFile === 'patternv0.20.wgsl' || shaderFile === 'patternv0.21.wgsl') return 'extended';
  return 'simple';
};

const createUniformPayload = (
  layoutType: LayoutType,
  params: {
    numRows: number;
    numChannels: number;
    playheadRow: number;
    isPlaying: boolean;
    cellW: number;
    cellH: number;
    canvasW: number;
    canvasH: number;
    tickOffset: number;
    bpm: number;
    timeSec: number;
    beatPhase: number;
    groove: number;
    kickTrigger: number;
    activeChannels: number;
    isModuleLoaded: boolean;
  }
): ArrayBuffer => {
  if (layoutType === 'extended') {
    const buffer = new ArrayBuffer(64);
    const uint = new Uint32Array(buffer);
    const float = new Float32Array(buffer);
    uint[0] = Math.max(0, params.numRows) >>> 0;
    uint[1] = Math.max(0, params.numChannels) >>> 0;
    uint[2] = Math.max(0, params.playheadRow) >>> 0;
    uint[3] = params.isPlaying ? 1 : 0;
    float[4] = params.cellW;
    float[5] = params.cellH;
    float[6] = params.canvasW;
    float[7] = params.canvasH;
    float[8] = params.tickOffset;
    float[9] = params.bpm;
    float[10] = params.timeSec;
    float[11] = params.beatPhase;
    float[12] = params.groove;
    float[13] = params.kickTrigger;
    uint[14] = Math.max(0, params.activeChannels) >>> 0;
    uint[15] = params.isModuleLoaded ? 1 : 0;
    return buffer;
  }

  const buffer = new ArrayBuffer(layoutType === 'texture' ? 64 : 32);
  const uint = new Uint32Array(buffer);
  const float = new Float32Array(buffer);
  uint[0] = Math.max(0, params.numRows) >>> 0;
  uint[1] = Math.max(0, params.numChannels) >>> 0;
  uint[2] = Math.max(0, params.playheadRow) >>> 0;
  uint[3] = 0;
  float[4] = params.cellW;
  float[5] = params.cellH;
  float[6] = params.canvasW;
  float[7] = params.canvasH;
  if (layoutType === 'texture') {
    float[8] = 1;
    float[9] = 1;
    float[10] = 0;
    float[11] = 0;
    float[12] = 1;
    float[13] = 1;
  }
  return buffer;
};

const packChannelStates = (channels: ChannelShadowState[], count: number, padTopChannel = false): ArrayBuffer => {
  const totalCount = padTopChannel ? count + 1 : Math.max(1, count);
  const buffer = new ArrayBuffer(totalCount * 32);
  const view = new DataView(buffer);
  const startIdx = padTopChannel ? 1 : 0;

  for (let i = 0; i < count; i++) {
    const ch = channels[i] || EMPTY_CHANNEL;
    const offset = (startIdx + i) * 32;
    view.setFloat32(offset, ch.volume ?? 0, true);
    view.setFloat32(offset + 4, ch.pan ?? 0, true);
    view.setFloat32(offset + 8, ch.freq ?? 0, true);
    view.setUint32(offset + 12, (ch.trigger ?? 0) >>> 0, true);
    view.setFloat32(offset + 16, ch.noteAge ?? 0, true);
    view.setUint32(offset + 20, (ch.activeEffect ?? 0) >>> 0, true);
    view.setFloat32(offset + 24, ch.effectValue ?? 0, true);
    view.setUint32(offset + 28, (ch.isMuted ?? 0) >>> 0, true);
  }
  return buffer;
};

interface PatternDisplayProps {
  matrix: PatternMatrix | null;
  playheadRow: number;
  cellWidth?: number;
  cellHeight?: number;
  shaderFile?: string;
  // Live playback uniforms
  isPlaying?: boolean;
  bpm?: number;
  timeSec?: number;
  tickOffset?: number; // 0..1 fractional progress between rows
  channels?: ChannelShadowState[];
  beatPhase?: number;
  grooveAmount?: number;
  kickTrigger?: number;
  activeChannels?: number;
  isModuleLoaded?: boolean;
}

const clampPlayhead = (value: number, numRows: number) => {
  if (numRows <= 0) return 0;
  return Math.min(Math.max(Math.floor(value), 0), numRows - 1);
};

// Parse helpers
const parsePackedB = (text: string) => {
  // volType: 1=volume, 2=pan, 0=none
  let volType = 0, volValue = 0;
  let effCode = 0, effParam = 0;
  // volume: vNN (decimal) 0..64 or 0..127; pan: pNN 0..64
  const volMatch = text.match(/v(\d{1,3})/i);
  if (volMatch) {
    volType = 1;
    const v = Math.min(255, Math.round((parseInt(volMatch[1], 10) / 64) * 255));
    volValue = isFinite(v) ? v : 0;
  }
  const panMatch = text.match(/p(\d{1,3})/i);
  if (panMatch) {
    volType = 2;
    const p = Math.min(255, Math.round((parseInt(panMatch[1], 10) / 64) * 255));
    volValue = isFinite(p) ? p : 0;
  }
  // effect like XYY or C80, letter + two hex digits
  const effMatch = text.match(/([A-Za-z])[ ]*([0-9A-Fa-f]{2})/);
  if (effMatch) {
    effCode = effMatch[1].toUpperCase().charCodeAt(0) & 0xff;
    effParam = parseInt(effMatch[2], 16) & 0xff;
  } else {
    // numeric effect code like 1xx style
    const effNum = text.match(/([0-9])[ ]*([0-9A-Fa-f]{2})/);
    if (effNum) {
      effCode = ('0'.charCodeAt(0) + (parseInt(effNum[1], 10) & 0xf)) & 0xff;
      effParam = parseInt(effNum[2], 16) & 0xff;
    }
  }
  return ((volType & 0xff) << 24) | ((volValue & 0xff) << 16) | ((effCode & 0xff) << 8) | (effParam & 0xff);
};

const packPatternMatrix = (matrix: PatternMatrix | null, padTopChannel = false): Uint32Array => {
  // If no matrix, create a dummy grid of zeros
  const rawChannels = matrix?.numChannels ?? DEFAULT_CHANNELS;
  const numRows = matrix?.numRows ?? DEFAULT_ROWS;
  const numChannels = padTopChannel ? rawChannels + 1 : rawChannels;

  const packed = new Uint32Array(numRows * numChannels * 2);

  if (!matrix) {
      // Return zeroed buffer
      return packed;
  }

  const { rows } = matrix;
  const startCol = padTopChannel ? 1 : 0;

  for (let r = 0; r < numRows; r++) {
    const rowCells = rows[r] || [];
    for (let c = 0; c < rawChannels; c++) {
      const offset = (r * numChannels + (c + startCol)) * 2;
      const cell = rowCells[c];
      if (!cell || !cell.text) {
        packed[offset] = 0;
        packed[offset + 1] = 0;
        continue;
      }

      const text = cell.text.trim();
      const upper = text.toUpperCase();
      const notePart = upper.slice(0, 3).padEnd(3, '\u0000');
      const instMatch = text.match(/(\d{1,3})$/);
      const instByte = instMatch ? Math.min(255, parseInt(instMatch[1], 10)) : 0;

      const n0 = notePart.charCodeAt(0) & 0xff;
      const n1 = notePart.charCodeAt(1) & 0xff;
      const n2 = notePart.charCodeAt(2) & 0xff;

      packed[offset] = (n0 << 24) | (n1 << 16) | (n2 << 8) | instByte;
      packed[offset + 1] = parsePackedB(text) >>> 0;
    }
  }

  return packed;
};

const createBufferWithData = (device: GPUDevice, data: ArrayBufferView | ArrayBuffer, usage: GPUBufferUsageFlags): GPUBuffer => {
  const byteLength = data instanceof ArrayBuffer ? data.byteLength : data.byteLength;
  const buffer = device.createBuffer({
    size: Math.max(16, byteLength),
    usage,
    mappedAtCreation: true,
  });
  const dst = new Uint8Array(buffer.getMappedRange());
  if (data instanceof ArrayBuffer) {
    dst.set(new Uint8Array(data));
  } else {
    dst.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }
  buffer.unmap();
  return buffer;
};

const buildRowFlags = (numRows: number): Uint32Array => {
  const flags = new Uint32Array(numRows);
  for (let r = 0; r < numRows; r++) {
    let f = 0;
    if (r % 4 === 0) f |= 1;      // beat every 4th
    if (r % 16 === 0) f |= 2;     // measure every 16th
    flags[r] = f;
  }
  return flags;
};

export const PatternDisplay: React.FC<PatternDisplayProps> = ({
    matrix,
    playheadRow,
    cellWidth = 18,
    cellHeight = 14,
    shaderFile = 'patternv0.12.wgsl',
    bpm = 120,
    timeSec = 0,
    tickOffset = 0,
    grooveAmount = 0,
    kickTrigger = 0,
    activeChannels = 0,
    channels = [],
    isPlaying = false,
    beatPhase = 0,
    isModuleLoaded = false
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const deviceRef = useRef<GPUDevice | null>(null);
  const contextRef = useRef<GPUCanvasContext | null>(null);
  const pipelineRef = useRef<GPURenderPipeline | null>(null);
  const cellsBufferRef = useRef<GPUBuffer | null>(null);
  const uniformBufferRef = useRef<GPUBuffer | null>(null);
  const rowFlagsBufferRef = useRef<GPUBuffer | null>(null);
  const channelsBufferRef = useRef<GPUBuffer | null>(null);
  const bindGroupRef = useRef<GPUBindGroup | null>(null);
  const layoutTypeRef = useRef<LayoutType>('simple');
  const textureResourcesRef = useRef<{ sampler: GPUSampler; view: GPUTextureView } | null>(null);
  const useExtendedRef = useRef<boolean>(false);
  const animationFrameRef = useRef<number>(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoTextureRef = useRef<GPUTexture | null>(null);
  const videoLoopRef = useRef<number>(0);

  // Video management for v0.20
  useEffect(() => {
    if (shaderFile.includes('v0.20')) {
      const vid = document.createElement('video');
      vid.src = 'clouds.mp4';
      vid.muted = true;
      vid.loop = false;
      vid.playsInline = true;
      vid.crossOrigin = "anonymous";

      let direction = 1;
      const checkLoop = () => {
        if (!vid) return;
        const t = vid.currentTime;
        const d = vid.duration;
        if (d > 0) {
          if (direction === 1 && t >= d - 0.2) {
            direction = -1;
            try { vid.playbackRate = -1.0; } catch (e) { vid.currentTime = 0; }
          } else if (direction === -1 && t <= 0.2) {
            direction = 1;
            try { vid.playbackRate = 1.0; } catch (e) { }
          }
          if (vid.paused) vid.play().catch(() => { });
        }
        videoLoopRef.current = requestAnimationFrame(checkLoop);
      };

      vid.onloadedmetadata = () => {
        vid.play().then(() => {
          cancelAnimationFrame(videoLoopRef.current);
          checkLoop();
        }).catch(e => console.warn("Video play error", e));
      };

      videoRef.current = vid;
      return () => {
        cancelAnimationFrame(videoLoopRef.current);
        vid.pause();
        vid.src = "";
        videoRef.current = null;
        if (videoTextureRef.current) {
          videoTextureRef.current.destroy();
          videoTextureRef.current = null;
        }
      };
    } else {
      videoRef.current = null;
    }
  }, [shaderFile]);

  const [webgpuAvailable, setWebgpuAvailable] = useState(true);
  const [gpuReady, setGpuReady] = useState(false);
  const [localTime, setLocalTime] = useState(0);

  const isHorizontal = shaderFile.includes('v0.12') || shaderFile.includes('v0.13') || shaderFile.includes('v0.14') || shaderFile.includes('v0.16') || shaderFile.includes('v0.17');
  const padTopChannel = shaderFile.includes('v0.16') || shaderFile.includes('v0.17');

  const canvasMetrics = useMemo(() => {
    if (shaderFile.includes('v0.18') || shaderFile.includes('v0.19') || shaderFile.includes('v0.20')) {
      return { width: 1280, height: 1280 };
    }
    const rawChannels = Math.max(1, matrix?.numChannels ?? DEFAULT_CHANNELS);
    const displayChannels = padTopChannel ? rawChannels + 1 : rawChannels;
    const rows = Math.max(1, matrix?.numRows ?? DEFAULT_ROWS);
    return isHorizontal
      ? { width: Math.ceil(rows * cellWidth), height: Math.ceil(displayChannels * cellHeight) }
      : { width: Math.ceil(displayChannels * cellWidth), height: Math.ceil(rows * cellHeight) };
  }, [matrix, cellWidth, cellHeight, isHorizontal, padTopChannel, shaderFile]);

  // Local animation loop when not playing or not loaded
  useEffect(() => {
    if (isModuleLoaded) {
      cancelAnimationFrame(animationFrameRef.current);
      return;
    }

    const startTime = performance.now();
    const loop = () => {
        const now = performance.now();
        setLocalTime((now - startTime) / 1000.0);
        animationFrameRef.current = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(animationFrameRef.current);
  }, [isModuleLoaded]);

  const render = () => {
    const device = deviceRef.current;
    const context = contextRef.current;
    const pipeline = pipelineRef.current;
    const bindGroup = bindGroupRef.current;
    if (!device || !context || !pipeline || !bindGroup || !uniformBufferRef.current || !cellsBufferRef.current) return;

    if (shaderFile.includes('v0.20') && videoRef.current && videoRef.current.readyState >= 2) {
      const vw = videoRef.current.videoWidth;
      const vh = videoRef.current.videoHeight;
      if (vw > 0 && vh > 0) {
        if (!videoTextureRef.current || videoTextureRef.current.width !== vw || videoTextureRef.current.height !== vh) {
          videoTextureRef.current?.destroy();
          const texture = device.createTexture({
            size: [vw, vh, 1],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
          });
          videoTextureRef.current = texture;
          const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
          textureResourcesRef.current = { sampler, view: texture.createView() };
          refreshBindGroup(device);
        }
        try {
          device.queue.copyExternalImageToTexture(
            { source: videoRef.current },
            { texture: videoTextureRef.current },
            [vw, vh, 1]
          );
        } catch (e) {
          // Ignore transient errors when video frame is not yet ready for GPU import
        }
      }
    }

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          loadOp: 'clear',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          storeOp: 'store',
        },
      ],
    });

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    const numRows = matrix?.numRows ?? DEFAULT_ROWS;
    const rawChannels = matrix?.numChannels ?? DEFAULT_CHANNELS;
    const numChannels = padTopChannel ? rawChannels + 1 : rawChannels;
    const totalInstances = numRows * numChannels;

    if (totalInstances > 0) pass.draw(6, totalInstances, 0, 0);
    pass.end();

    device.queue.submit([encoder.finish()]);
  };

  const refreshBindGroup = (device: GPUDevice) => {
    if (!pipelineRef.current || !cellsBufferRef.current || !uniformBufferRef.current) return;
    const layout = pipelineRef.current.getBindGroupLayout(0);
    const layoutType = layoutTypeRef.current;
    const entries: GPUBindGroupEntry[] = [
      { binding: 0, resource: { buffer: cellsBufferRef.current!, size: cellsBufferRef.current!.size } },
      { binding: 1, resource: { buffer: uniformBufferRef.current! } },
    ];

    if (layoutType === 'extended') {
      if (!rowFlagsBufferRef.current || !channelsBufferRef.current || !textureResourcesRef.current) return;
      entries.push(
        { binding: 2, resource: { buffer: rowFlagsBufferRef.current! } },
        { binding: 3, resource: { buffer: channelsBufferRef.current! } },
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
  };

  const ensureVideoPlaceholder = (device: GPUDevice) => {
    if (videoTextureRef.current) return;
    const texture = device.createTexture({
      size: [1, 1, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    // Fill with gray
    const data = new Uint8Array([100, 100, 100, 255]);
    device.queue.writeTexture({ texture }, data, { bytesPerRow: 4 }, { width: 1, height: 1 });
    videoTextureRef.current = texture;
    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    textureResourcesRef.current = { sampler, view: texture.createView() };
  };

  const ensureButtonTexture = async (device: GPUDevice) => {
    if (textureResourcesRef.current) return;

    let bitmap: ImageBitmap;
    try {
      const img = new Image();
      img.src = 'unlit-button.png';
      await img.decode();
      bitmap = await createImageBitmap(img);
    } catch (e) {
      console.warn('Failed to load button texture, using fallback.', e);
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#222';
        ctx.fillRect(0, 0, 1, 1);
      }
      bitmap = await createImageBitmap(canvas);
    }

    const texture = device.createTexture({
      size: [bitmap.width, bitmap.height, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture({ source: bitmap }, { texture }, [bitmap.width, bitmap.height, 1]);
    const sampler = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' });
    textureResourcesRef.current = { sampler, view: texture.createView() };
  };

  // GPU initialization
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!('gpu' in navigator)) {
      setWebgpuAvailable(false);
      return;
    }

    let cancelled = false;

    const init = async () => {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter || cancelled) { setWebgpuAvailable(false); return; }
        const device = await adapter.requestDevice();
        if (!device || cancelled) { setWebgpuAvailable(false); return; }

        const context = canvas.getContext('webgpu') as GPUCanvasContext;
        const format = navigator.gpu.getPreferredCanvasFormat();
        context.configure({ device, format });

        const shaderSource = await fetch(`./shaders/${shaderFile}`).then(res => res.text());
        if (cancelled) return;
        const module = device.createShaderModule({ code: shaderSource });
        if ('getCompilationInfo' in module) {
          module.getCompilationInfo().then(info => {
            info.messages.forEach(msg => {
              const log = msg.type === 'error' ? console.error : console.warn;
              log(`[WGSL ${msg.type}] ${shaderFile}:${msg.lineNum}:${msg.linePos} ${msg.message}`);
            });
          }).catch(() => {});
        }

        const layoutType = getLayoutType(shaderFile);
        layoutTypeRef.current = layoutType;
        useExtendedRef.current = layoutType === 'extended';
        if (layoutType !== 'extended') {
          rowFlagsBufferRef.current?.destroy();
          rowFlagsBufferRef.current = null;
          channelsBufferRef.current?.destroy();
          channelsBufferRef.current = null;
        }
        textureResourcesRef.current = null;

        let bindGroupLayout: GPUBindGroupLayout;
        if (layoutType === 'texture') {
          bindGroupLayout = device.createBindGroupLayout({
            entries: [
              { binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
              { binding: 1, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
              { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
              { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
            ],
          });
        } else if (layoutType === 'extended') {
          bindGroupLayout = device.createBindGroupLayout({
            entries: [
              { binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
              { binding: 1, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
              { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
              { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
              { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
              { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
            ],
          });
        } else {
          bindGroupLayout = device.createBindGroupLayout({
            entries: [
              { binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
              { binding: 1, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
            ],
          });
        }

        let entryVert = 'vs';
        let entryFrag = 'fs';
        try {
          pipelineRef.current = device.createRenderPipeline({
            layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
            vertex: { module, entryPoint: entryVert },
            fragment: { module, entryPoint: entryFrag, targets: [{ format }] },
            primitive: { topology: 'triangle-list' },
          });
        } catch {
          pipelineRef.current = device.createRenderPipeline({
            layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
            vertex: { module, entryPoint: 'vertex_main' },
            fragment: { module, entryPoint: 'fragment_main', targets: [{ format }] },
            primitive: { topology: 'triangle-list' },
          });
        }

        const uniformSize = layoutType === 'simple' ? 32 : 64;
        const uniformBuffer = device.createBuffer({ size: alignTo(uniformSize, 256), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

        deviceRef.current = device;
        contextRef.current = context;
        uniformBufferRef.current = uniformBuffer;

        // Initial buffer creation (handles null matrix now via packPatternMatrix)
        cellsBufferRef.current = createBufferWithData(device, packPatternMatrix(matrix, padTopChannel), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);

        if (layoutType === 'extended') {
          const numRows = matrix?.numRows ?? DEFAULT_ROWS;
          rowFlagsBufferRef.current = createBufferWithData(device, buildRowFlags(numRows), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
          const channelsCount = Math.max(1, matrix?.numChannels ?? DEFAULT_CHANNELS);
          const emptyChannels = packChannelStates([], channelsCount, padTopChannel);
          channelsBufferRef.current = createBufferWithData(device, emptyChannels, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
        }

        const needsTexture = layoutType === 'texture' || layoutType === 'extended';
        if (needsTexture) {
          if (shaderFile.includes('v0.20')) {
            ensureVideoPlaceholder(device);
          } else {
            await ensureButtonTexture(device);
          }
        }

        refreshBindGroup(device);

        setGpuReady(true);
      } catch (error) {
        console.error('Failed to initialize WebGPU pattern display', error);
        if (!cancelled) setWebgpuAvailable(false);
      }
    };

    init();

    return () => {
      cancelled = true;
      setWebgpuAvailable(true);
      setGpuReady(false);
      bindGroupRef.current = null;
      pipelineRef.current = null;
      cellsBufferRef.current = null;
      uniformBufferRef.current = null;
      rowFlagsBufferRef.current = null;
      channelsBufferRef.current = null;
      textureResourcesRef.current = null;
      videoTextureRef.current = null;
      deviceRef.current = null;
      contextRef.current = null;
    };
  }, [matrix, shaderFile]);

  // 1. Matrix & Cell Buffer Management
  useEffect(() => {
    const device = deviceRef.current;
    if (!device || !gpuReady) return;

    if (cellsBufferRef.current) {
        cellsBufferRef.current.destroy();
    }
    cellsBufferRef.current = createBufferWithData(device, packPatternMatrix(matrix, padTopChannel), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);

    // Also update row flags if extended
    if (layoutTypeRef.current === 'extended') {
        const numRows = matrix?.numRows ?? DEFAULT_ROWS;
        const flags = buildRowFlags(numRows);
        if (!rowFlagsBufferRef.current || rowFlagsBufferRef.current.size < flags.byteLength) {
            rowFlagsBufferRef.current?.destroy();
            rowFlagsBufferRef.current = createBufferWithData(device, flags, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
        } else {
            device.queue.writeBuffer(rowFlagsBufferRef.current, 0, flags.buffer, flags.byteOffset, flags.byteLength);
        }
    }

    refreshBindGroup(device);
  }, [matrix, gpuReady]);

  // 2. Channels Buffer Management
  useEffect(() => {
    const device = deviceRef.current;
    if (!device || !gpuReady) return;

    if (layoutTypeRef.current === 'extended') {
        const count = Math.max(1, matrix?.numChannels ?? DEFAULT_CHANNELS);
        const packedBuffer = packChannelStates(channels, count, padTopChannel);
        let recreated = false;

        if (!channelsBufferRef.current || channelsBufferRef.current.size < packedBuffer.byteLength) {
            channelsBufferRef.current?.destroy();
            channelsBufferRef.current = createBufferWithData(device, packedBuffer, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
            recreated = true;
        } else {
            device.queue.writeBuffer(channelsBufferRef.current, 0, packedBuffer);
        }

        if (recreated) {
            refreshBindGroup(device);
        }
    }
  }, [channels, matrix?.numChannels, gpuReady]);

  // 3. Render Loop (Uniforms & Draw)
  useEffect(() => {
    const device = deviceRef.current;
    if (!device || !gpuReady) return;

    // Update uniform buffer
    const uniformBuffer = uniformBufferRef.current;
    if (uniformBuffer) {
      const numRows = matrix?.numRows ?? DEFAULT_ROWS;
      const rawChannels = matrix?.numChannels ?? DEFAULT_CHANNELS;
      const numChannels = padTopChannel ? rawChannels + 1 : rawChannels;
      const rowLimit = Math.max(1, numRows);
      const tickRow = clampPlayhead(playheadRow, rowLimit);
      const fractionalTick = Math.min(1, Math.max(0, tickOffset));

      const effectiveTime = isModuleLoaded ? timeSec : localTime;

      const uniformPayload = createUniformPayload(layoutTypeRef.current, {
        numRows,
        numChannels,
        playheadRow: tickRow,
        isPlaying,
        cellW: cellWidth,
        cellH: cellHeight,
        canvasW: canvasMetrics.width,
        canvasH: canvasMetrics.height,
        tickOffset: fractionalTick,
        bpm,
        timeSec: effectiveTime,
        beatPhase,
        groove: Math.min(1, Math.max(0, grooveAmount)),
        kickTrigger,
        activeChannels,
        isModuleLoaded
      });
      device.queue.writeBuffer(uniformBuffer, 0, uniformPayload);
    }

    render();
  }, [playheadRow, timeSec, localTime, bpm, tickOffset, grooveAmount, kickTrigger, activeChannels, gpuReady, isPlaying, beatPhase, isModuleLoaded, matrix?.numRows, matrix?.numChannels, cellWidth, cellHeight, canvasMetrics]);

  return (
    <div className={`pattern-display relative ${padTopChannel ? 'p-8 rounded-xl bg-[#18181a] shadow-2xl border border-[#333]' : ''}`}>
      {padTopChannel && (
          <>
            {/* Rack Ears / Side Panels */}
            <div className="absolute top-0 bottom-0 left-0 w-8 bg-[#111] border-r border-[#000] flex flex-col justify-between py-4 items-center rounded-l-xl">
               {/* Screws */}
               <div className="w-3 h-3 rounded-full bg-[#222] border border-[#444] shadow-inner flex items-center justify-center"><div className="w-2 h-0.5 bg-[#111] rotate-45"></div></div>
               <div className="w-3 h-3 rounded-full bg-[#222] border border-[#444] shadow-inner flex items-center justify-center"><div className="w-2 h-0.5 bg-[#111] rotate-45"></div></div>
            </div>
            <div className="absolute top-0 bottom-0 right-0 w-8 bg-[#111] border-l border-[#000] flex flex-col justify-between py-4 items-center rounded-r-xl">
               <div className="w-3 h-3 rounded-full bg-[#222] border border-[#444] shadow-inner flex items-center justify-center"><div className="w-2 h-0.5 bg-[#111] rotate-45"></div></div>
               <div className="w-3 h-3 rounded-full bg-[#222] border border-[#444] shadow-inner flex items-center justify-center"><div className="w-2 h-0.5 bg-[#111] rotate-45"></div></div>
            </div>

            {/* Power LED & Text */}
            <div className="absolute top-2 right-12 flex items-center gap-3">
                <div className="text-[10px] font-mono font-bold text-gray-500 tracking-widest uppercase opacity-70">Tracker GPU-9000</div>
                <div className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(255,50,50,0.8)]"></div>
            </div>
          </>
      )}
      <canvas ref={canvasRef} width={canvasMetrics.width} height={canvasMetrics.height} className={padTopChannel ? 'rounded bg-black shadow-inner border border-black/50' : ''} />
      {!webgpuAvailable && <div className="error">WebGPU not available in this browser.</div>}
    </div>
  );
};
