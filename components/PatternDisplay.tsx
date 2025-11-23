import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ChannelShadowState, PatternMatrix } from '../types';

const MIN_STORAGE = new Uint32Array([0, 0]);
const EMPTY_CHANNEL: ChannelShadowState = { volume: 0, pan: 0, freq: 0, trigger: 0, noteAge: 0, activeEffect: 0, effectValue: 0, isMuted: 0 };
type LayoutType = 'simple' | 'texture' | 'extended';

const alignTo = (value: number, alignment: number) => Math.ceil(value / alignment) * alignment;
const getLayoutType = (shaderFile: string): LayoutType => {
  if (shaderFile === 'patternShaderv0.12.wgsl') return 'texture';
  if (shaderFile === 'patternv0.13.wgsl' || shaderFile === 'patternv0.14.wgsl') return 'extended';
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
    uint[15] = 0;
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

const packChannelStates = (channels: ChannelShadowState[], count: number): ArrayBuffer => {
  const buffer = new ArrayBuffer(Math.max(1, count) * 32);
  const view = new DataView(buffer);
  for (let i = 0; i < count; i++) {
    const ch = channels[i] || EMPTY_CHANNEL;
    const offset = i * 32;
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

const packPatternMatrix = (matrix: PatternMatrix | null): Uint32Array => {
  if (!matrix || matrix.numRows <= 0 || matrix.numChannels <= 0) {
    return MIN_STORAGE.slice();
  }

  const { numRows, numChannels, rows } = matrix;
  const packed = new Uint32Array(numRows * numChannels * 2);

  for (let r = 0; r < numRows; r++) {
    const rowCells = rows[r] || [];
    for (let c = 0; c < numChannels; c++) {
      const offset = (r * numChannels + c) * 2;
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

export const PatternDisplay: React.FC<PatternDisplayProps> = ({ matrix, playheadRow, cellWidth = 18, cellHeight = 14, shaderFile = 'patternv0.12.wgsl', bpm = 120, timeSec = 0, tickOffset = 0, grooveAmount = 0, kickTrigger = 0, activeChannels = 0, channels = [], isPlaying = false, beatPhase = 0 }) => {
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

  const [webgpuAvailable, setWebgpuAvailable] = useState(true);
  const [gpuReady, setGpuReady] = useState(false);

  const isHorizontal = shaderFile.includes('v0.12') || shaderFile.includes('v0.13') || shaderFile.includes('v0.14');

  const canvasMetrics = useMemo(() => {
    const channelsCount = Math.max(1, matrix?.numChannels ?? 1);
    const rows = Math.max(1, matrix?.numRows ?? 1);
    return isHorizontal
      ? { width: Math.ceil(rows * cellWidth), height: Math.ceil(channelsCount * cellHeight) }
      : { width: Math.ceil(channelsCount * cellWidth), height: Math.ceil(rows * cellHeight) };
  }, [matrix, cellWidth, cellHeight, isHorizontal]);

  const render = () => {
    const device = deviceRef.current;
    const context = contextRef.current;
    const pipeline = pipelineRef.current;
    const bindGroup = bindGroupRef.current;
    if (!device || !context || !pipeline || !bindGroup || !uniformBufferRef.current || !cellsBufferRef.current) return;

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
    const totalInstances = (matrix?.numRows ?? 0) * (matrix?.numChannels ?? 0);
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

  const ensureButtonTexture = async (device: GPUDevice) => {
    if (textureResourcesRef.current) return;
    const img = new Image();
    img.src = './public/unlit-button.png';
    await img.decode();
    const bitmap = await createImageBitmap(img);
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

        cellsBufferRef.current = createBufferWithData(device, MIN_STORAGE, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
        if (layoutType === 'extended') {
          const numRows = matrix?.numRows ?? 1;
          rowFlagsBufferRef.current = createBufferWithData(device, buildRowFlags(numRows), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
          const channelsCount = Math.max(1, matrix?.numChannels ?? 1);
          const emptyChannels = packChannelStates([], channelsCount);
          channelsBufferRef.current = createBufferWithData(device, emptyChannels, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
        }

        const needsTexture = layoutType === 'texture' || layoutType === 'extended';
        if (needsTexture) {
          await ensureButtonTexture(device);
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
    };
  }, [matrix, shaderFile]);

  // Update buffers and re-render when matrix or playheadRow changes
  useEffect(() => {
    const device = deviceRef.current;
    if (!device || !gpuReady) return;

    // Update cells buffer
    if (matrix) {
      if (cellsBufferRef.current) {
        cellsBufferRef.current.destroy();
      }
      cellsBufferRef.current = createBufferWithData(device, packPatternMatrix(matrix), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
      refreshBindGroup(device);
    } else if (!cellsBufferRef.current) {
      cellsBufferRef.current = createBufferWithData(device, MIN_STORAGE, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
      refreshBindGroup(device);
    }

    // Update uniform buffer with playhead and timing information
    const uniformBuffer = uniformBufferRef.current;
    if (uniformBuffer) {
      const numRows = matrix?.numRows ?? 0;
      const rowLimit = Math.max(1, numRows);
      const tickRow = clampPlayhead(playheadRow, rowLimit);
      const fractionalTick = Math.min(1, Math.max(0, tickOffset));
      const uniformPayload = createUniformPayload(layoutTypeRef.current, {
        numRows,
        numChannels: matrix?.numChannels ?? 0,
        playheadRow: tickRow,
        isPlaying,
        cellW: cellWidth,
        cellH: cellHeight,
        canvasW: canvasMetrics.width,
        canvasH: canvasMetrics.height,
        tickOffset: fractionalTick,
        bpm,
        timeSec,
        beatPhase,
        groove: Math.min(1, Math.max(0, grooveAmount)),
        kickTrigger,
        activeChannels,
      });
      device.queue.writeBuffer(uniformBuffer, 0, uniformPayload);
    }

    const layoutType = layoutTypeRef.current;
    if (layoutType === 'extended') {
      const count = Math.max(1, matrix?.numChannels ?? 1);
      const packedBuffer = packChannelStates(channels, count);
      if (!channelsBufferRef.current || channelsBufferRef.current.size < packedBuffer.byteLength) {
        channelsBufferRef.current?.destroy();
        channelsBufferRef.current = createBufferWithData(device, packedBuffer, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
        refreshBindGroup(device);
      } else {
        device.queue.writeBuffer(channelsBufferRef.current, 0, packedBuffer);
      }

      const flags = buildRowFlags(Math.max(1, matrix?.numRows ?? 1));
      if (!rowFlagsBufferRef.current || rowFlagsBufferRef.current.size < flags.byteLength) {
        rowFlagsBufferRef.current?.destroy();
        rowFlagsBufferRef.current = createBufferWithData(device, flags, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
        refreshBindGroup(device);
      } else {
        device.queue.writeBuffer(rowFlagsBufferRef.current, 0, flags.buffer, flags.byteOffset, flags.byteLength);
      }
    }

    render();
  }, [matrix, playheadRow, timeSec, bpm, tickOffset, grooveAmount, kickTrigger, activeChannels, gpuReady, channels, canvasMetrics, isPlaying, beatPhase]);

  return (
    <div className="pattern-display">
      <canvas ref={canvasRef} width={canvasMetrics.width} height={canvasMetrics.height} />
      {!webgpuAvailable && <div className="error">WebGPU not available in this browser.</div>}
    </div>
  );
};
