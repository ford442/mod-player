import React, { useEffect, useRef, useState } from 'react';
import type { ChannelShadowState, PatternMatrix } from '../types';

const EMPTY_CHANNEL: ChannelShadowState = { volume: 0, pan: 0, freq: 0, trigger: 0, noteAge: 0, activeEffect: 0, effectValue: 0, isMuted: 0 };
type LayoutType = 'simple' | 'texture' | 'extended';

const DEFAULT_ROWS = 128;
const DEFAULT_CHANNELS = 32;

const alignTo = (value: number, alignment: number) => Math.ceil(value / alignment) * alignment;

const getLayoutType = (shaderFile: string): LayoutType => {
  if (shaderFile === 'patternShaderv0.12.wgsl') return 'texture';
  // Check for extended layout shaders (v0.38, v0.39, and v0.40 included)
  if (shaderFile.includes('v0.13') || shaderFile.includes('v0.14') || shaderFile.includes('v0.15') || shaderFile.includes('v0.16') || shaderFile.includes('v0.17') || shaderFile.includes('v0.18') || shaderFile.includes('v0.19') || shaderFile.includes('v0.20') || shaderFile.includes('v0.21') || shaderFile.includes('v0.23') || shaderFile.includes('v0.24') || shaderFile.includes('v0.25') || shaderFile.includes('v0.26') || shaderFile.includes('v0.27') || shaderFile.includes('v0.28') || shaderFile.includes('v0.29') || shaderFile.includes('v0.30') || shaderFile.includes('v0.31') || shaderFile.includes('v0.32') || shaderFile.includes('v0.33') || shaderFile.includes('v0.34') || shaderFile.includes('v0.35') || shaderFile.includes('v0.36') || shaderFile.includes('v0.37') || shaderFile.includes('v0.38') || shaderFile.includes('v0.39') || shaderFile.includes('v0.40')) return 'extended';
  return 'simple';
};

const isSinglePassCompositeShader = (shaderFile: string) => {
  return shaderFile.includes('v0.29') || shaderFile.includes('v0.26');
};

const shouldEnableAlphaBlending = (shaderFile: string) => {
  return shaderFile.includes('v0.28') || shaderFile.includes('v0.30') || shaderFile.includes('v0.31') || shaderFile.includes('v0.32') || shaderFile.includes('v0.33') || shaderFile.includes('v0.34') || shaderFile.includes('v0.35') || shaderFile.includes('v0.36') || shaderFile.includes('v0.37') || shaderFile.includes('v0.38') || shaderFile.includes('v0.39') || shaderFile.includes('v0.40');
};

const isCircularLayoutShader = (shaderFile: string) => {
  // v0.39 and v0.40 are NOT circular (they're horizontal). v0.38 IS circular.
  return shaderFile.includes('v0.25') || shaderFile.includes('v0.26') || shaderFile.includes('v0.35') || shaderFile.includes('v0.37') || shaderFile.includes('v0.38');
};

const shouldUseBackgroundPass = (shaderFile: string) => {
  return !isSinglePassCompositeShader(shaderFile);
};

const getBackgroundShaderFile = (shaderFile: string): string => {
  // Use the new frosted shader for the latest layout
  if (shaderFile.includes('v0.40')) return 'chassis_frosted.wgsl';
  
  if (shaderFile.includes('v0.37') || shaderFile.includes('v0.38') || shaderFile.includes('v0.39')) return 'chassisv0.37.wgsl';
  if (shaderFile.includes('v0.27') || shaderFile.includes('v0.28') || shaderFile.includes('v0.30') || shaderFile.includes('v0.31') || shaderFile.includes('v0.32') || shaderFile.includes('v0.33') || shaderFile.includes('v0.34') || shaderFile.includes('v0.35') || shaderFile.includes('v0.36')) return 'chassisv0.1.wgsl';
  return 'bezel.wgsl';
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
    bloomIntensity?: number;
    bloomThreshold?: number;
    invertChannels?: boolean;
    dimFactor?: number;
  }
): ArrayBuffer => {
  if (layoutType === 'extended') {
    const buffer = new ArrayBuffer(80);
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
    float[16] = params.bloomIntensity ?? 1.0;
    float[17] = params.bloomThreshold ?? 0.8;
    uint[18] = params.invertChannels ? 1 : 0;
    float[19] = params.dimFactor ?? 1.0;
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
    float[8] = 1; float[9] = 1; float[10] = 0; float[11] = 0; float[12] = 1; float[13] = 1;
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
  isPlaying?: boolean;
  bpm?: number;
  timeSec?: number;
  tickOffset?: number;
  channels?: ChannelShadowState[];
  beatPhase?: number;
  grooveAmount?: number;
  kickTrigger?: number;
  activeChannels?: number;
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
}

const clampPlayhead = (value: number, numRows: number) => {
  if (numRows <= 0) return 0;
  return Math.min(Math.max(Math.floor(value), 0), numRows - 1);
};

// Parse helpers
const parsePackedB = (text: string) => {
  let volType = 0, volValue = 0;
  let effCode = 0, effParam = 0;
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
  const effMatch = text.match(/([A-Za-z])[ ]*([0-9A-Fa-f]{2})/);
  if (effMatch) {
    effCode = effMatch[1].toUpperCase().charCodeAt(0) & 0xff;
    effParam = parseInt(effMatch[2], 16) & 0xff;
  } else {
    const effNum = text.match(/([0-9])[ ]*([0-9A-Fa-f]{2})/);
    if (effNum) {
      effCode = ('0'.charCodeAt(0) + (parseInt(effNum[1], 10) & 0xf)) & 0xff;
      effParam = parseInt(effNum[2], 16) & 0xff;
    }
  }
  return ((volType & 0xff) << 24) | ((volValue & 0xff) << 16) | ((effCode & 0xff) << 8) | (effParam & 0xff);
};

const packPatternMatrix = (matrix: PatternMatrix | null, padTopChannel = false): Uint32Array => {
  const rawChannels = matrix?.numChannels ?? DEFAULT_CHANNELS;
  const numRows = matrix?.numRows ?? DEFAULT_ROWS;
  const numChannels = padTopChannel ? rawChannels + 1 : rawChannels;
  const packed = new Uint32Array(numRows * numChannels * 2);

  if (!matrix) return packed;

  const { rows } = matrix;
  const startCol = padTopChannel ? 1 : 0;

  for (let r = 0; r < numRows; r++) {
    const rowCells = rows[r] || [];
    for (let c = 0; c < rawChannels; c++) {
      const offset = (r * numChannels + (c + startCol)) * 2;
      const cell = rowCells[c];
      if (!cell || !cell.text) continue;

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

const packPatternMatrixHighPrecision = (matrix: PatternMatrix | null, padTopChannel = false): Uint32Array => {
  const rawChannels = matrix?.numChannels ?? DEFAULT_CHANNELS;
  const numRows = matrix?.numRows ?? DEFAULT_ROWS;
  const numChannels = padTopChannel ? rawChannels + 1 : rawChannels;
  const packed = new Uint32Array(numRows * numChannels * 2);

  if (!matrix) return packed;

  const { rows } = matrix;
  const startCol = padTopChannel ? 1 : 0;

  for (let r = 0; r < numRows; r++) {
    const rowCells = rows[r] || [];
    for (let c = 0; c < rawChannels; c++) {
      const offset = (r * numChannels + (c + startCol)) * 2;
      const cell = rowCells[c];
      if (!cell) continue;

      const note = cell.note || 0;
      const inst = cell.inst || 0;
      const volCmd = cell.volCmd || 0;
      const volVal = cell.volVal || 0;
      const effCmd = cell.effCmd || 0;
      const effVal = cell.effVal || 0;

      packed[offset] = ((note & 0xFF) << 24) | ((inst & 0xFF) << 16) | ((volCmd & 0xFF) << 8) | (volVal & 0xFF);
      packed[offset + 1] = ((effCmd & 0xFF) << 8) | (effVal & 0xFF);
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
    if (r % 4 === 0) f |= 1;
    if (r % 16 === 0) f |= 2;
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
    isModuleLoaded = false,
    bloomIntensity = 1.0,
    bloomThreshold = 0.8,
    externalVideoSource = null,
    volume = 1.0,
    pan = 0.0,
    isLooping = false,
    onPlay,
    onStop,
    onFileSelected,
    onLoopToggle,
    onSeek,
    onVolumeChange,
    onPanChange,
    totalRows = 64,
    dimFactor = 1.0,
}) => {
  // ... (State hooks unchanged)
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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
  const renderRef = useRef<(() => void) | null>(null);
  const videoRef = useRef<HTMLVideoElement | HTMLImageElement | null>(null);
  const videoTextureRef = useRef<GPUTexture | null>(null);
  const videoLoopRef = useRef<number>(0);
  
  const bezelPipelineRef = useRef<GPURenderPipeline | null>(null);
  const bezelUniformBufferRef = useRef<GPUBuffer | null>(null);
  const bezelBindGroupRef = useRef<GPUBindGroup | null>(null);
  const bezelTextureResourcesRef = useRef<{ sampler: GPUSampler; view: GPUTextureView } | null>(null);
  
  // WebGL2 Overlay Resources
  const glCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const glContextRef = useRef<WebGL2RenderingContext | null>(null);
  const glResourcesRef = useRef<{
    program: WebGLProgram;
    vao: WebGLVertexArrayObject;
    texture: WebGLTexture;
    buffer: WebGLBuffer;
  } | null>(null);

  const clickTimeoutRef = useRef<number | null>(null);

  // ... (Video management and WebGPU init effects unchanged - omitted for brevity as they are identical to previous)
  
  // (Paste your existing useEffects here, they are unchanged)
  useEffect(() => {
    const isVideoShader = shaderFile.includes('v0.20') || shaderFile.includes('v0.23') || shaderFile.includes('v0.24') || shaderFile.includes('v0.25');
    cancelAnimationFrame(videoLoopRef.current);
    videoRef.current = null;

    if (externalVideoSource) {
      videoRef.current = externalVideoSource;
      return;
    }

    if (isVideoShader) {
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
      };
    }
  }, [shaderFile, externalVideoSource]);

  const [webgpuAvailable, setWebgpuAvailable] = useState(true);
  const [gpuReady, setGpuReady] = useState(false);
  const [localTime, setLocalTime] = useState(0);
  const [invertChannels, setInvertChannels] = useState(false);
  const [clickedButton, setClickedButton] = useState(0);

  const isHorizontal = shaderFile.includes('v0.12') || shaderFile.includes('v0.13') || shaderFile.includes('v0.14') || shaderFile.includes('v0.16') || shaderFile.includes('v0.17') || shaderFile.includes('v0.21') || shaderFile.includes('v0.39') || shaderFile.includes('v0.40');
  
  // NOTE: v0.38, v0.39, and v0.40 added here to pad channel 0, ensuring music is channels 1-32
  const padTopChannel = shaderFile.includes('v0.16') || shaderFile.includes('v0.17') || shaderFile.includes('v0.21') || shaderFile.includes('v0.38') || shaderFile.includes('v0.39') || shaderFile.includes('v0.40');

  const computeLogicalCanvasMetrics = () => {
    // Force Square for v0.37, v0.38, v0.39, and v0.40 (Square Bezel)
    if (shaderFile.includes('v0.37') || shaderFile.includes('v0.38') || shaderFile.includes('v0.39') || shaderFile.includes('v0.40')) return { width: 1024, height: 1024 };
    if (shaderFile.includes('v0.26') || shaderFile.includes('v0.27') || shaderFile.includes('v0.28') || shaderFile.includes('v0.29') || shaderFile.includes('v0.30') || shaderFile.includes('v0.31') || shaderFile.includes('v0.32') || shaderFile.includes('v0.33') || shaderFile.includes('v0.34') || shaderFile.includes('v0.35') || shaderFile.includes('v0.36')) {
      return { width: 2048, height: 2016 };
    }
    if (isCircularLayoutShader(shaderFile)) return { width: 1280, height: 1280 };
    if (shaderFile.includes('v0.18') || shaderFile.includes('v0.19') || shaderFile.includes('v0.20') || shaderFile.includes('v0.23') || shaderFile.includes('v0.24') || shaderFile.includes('v0.25')) {
      return { width: 1280, height: 1280 };
    }
    const rawChannels = Math.max(1, matrix?.numChannels ?? DEFAULT_CHANNELS);
    const displayChannels = padTopChannel ? rawChannels + 1 : rawChannels;
    const rows = Math.max(1, matrix?.numRows ?? DEFAULT_ROWS);
    return isHorizontal
      ? { width: Math.ceil(rows * cellWidth), height: Math.ceil(displayChannels * cellHeight) }
      : { width: Math.ceil(displayChannels * cellWidth), height: Math.ceil(rows * cellHeight) };
  };

  const [canvasMetrics, setCanvasMetrics] = React.useState(() => computeLogicalCanvasMetrics());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const computeAndSetSize = () => {
      const logical = computeLogicalCanvasMetrics();
      const dpr = window.devicePixelRatio || 1;
      let targetW: number, targetH: number;
      const isFixed = (logical.width === 2048 && logical.height === 2016) || (logical.width === 1024 && logical.height === 1008) || (logical.width === 1280 && logical.height === 1280) || (logical.width === 1024 && logical.height === 1024);

      if (isFixed) {
        targetW = logical.width;
        targetH = logical.height;
      } else {
        const rect = canvas.getBoundingClientRect();
        targetW = Math.max(1, Math.round(rect.width * dpr));
        targetH = Math.max(1, Math.round(rect.height * dpr));
      }

      setCanvasMetrics(prev => {
        if (prev.width === targetW && prev.height === targetH) return prev;
        return { width: targetW, height: targetH };
      });
    };

    let ro: ResizeObserver | null = null;
    if ((window as any).ResizeObserver) {
      ro = new (window as any).ResizeObserver(() => computeAndSetSize());
      if (ro) ro.observe(canvas);
    } else {
      window.addEventListener('resize', computeAndSetSize);
    }
    computeAndSetSize();
    return () => {
      if (ro) ro.disconnect();
      else window.removeEventListener('resize', computeAndSetSize);
    };
  }, [shaderFile, matrix?.numRows, matrix?.numChannels, cellWidth, cellHeight, isHorizontal, padTopChannel]);

  // Update WebGPU uniforms when canvas size changes
  useEffect(() => {
    const device = deviceRef.current;
    const uniformBuffer = uniformBufferRef.current;
    if (!device || !uniformBuffer) return;
    const floatBuf = new Float32Array([canvasMetrics.width, canvasMetrics.height]);
    try {
      device.queue.writeBuffer(uniformBuffer, 6 * 4, floatBuf.buffer, floatBuf.byteOffset, floatBuf.byteLength);
    } catch (e) {
      device.queue.writeBuffer(uniformBuffer, 0, floatBuf.buffer, floatBuf.byteOffset, floatBuf.byteLength);
    }
  }, [canvasMetrics]);

  // === WEBGL2 INITIALIZATION (Overlay for v0.38, v0.39, & v0.40) ===
  useEffect(() => {
    const isOverlayShader = shaderFile.includes('v0.38') || shaderFile.includes('v0.39') || shaderFile.includes('v0.40');
    
    if (!isOverlayShader) {
        const gl = glContextRef.current;
        if (gl) { /* gl cleanup implicitly handled by browser */ }
        glContextRef.current = null;
        glResourcesRef.current = null;
        return;
    }

    const canvas = glCanvasRef.current;
    if (!canvas) return;
    
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, antialias: true });
    if (!gl) {
      console.warn("WebGL2 not available for overlay");
      return;
    }
    glContextRef.current = gl;

    // Compile Vertex & Fragment Shaders for the "Glass Cap"
    const vsSource = `#version 300 es
    layout(location=0) in vec2 a_pos; // unit quad -0.5..0.5
    
    uniform vec2 u_resolution;
    uniform vec2 u_cellSize;
    uniform vec2 u_offset; // Global offset (pixel space)
    uniform float u_cols;
    uniform float u_rows;
    uniform float u_playhead;
    uniform int u_layoutMode; // 1=Circular, 2=Horizontal
    uniform int u_invertChannels; 
    uniform mediump usampler2D u_noteData; // R8UI Texture

    out vec2 v_uv;
    out float v_active;

    #define PI 3.14159265

    void main() {
        int id = gl_InstanceID;
        int col = id % int(u_cols);
        int row = id / int(u_cols);
        
        // Fetch note from texture: x=col (channel), y=row (time).
        // Since padTopChannel is true for v0.38/39, col=0 is header, 1-32 is music.
        uint note = texelFetch(u_noteData, ivec2(col, row), 0).r;
        
        if (note == 0u) {
            gl_Position = vec4(0.0);
            return;
        }

        if (u_layoutMode == 2) {
            // --- v0.39 / v0.40: PAGED STATIC HORIZONTAL GRID ---
            // Page Logic: Grid shows a window of 32 steps (e.g. 0-31, 32-63)
            // If the note row is not in the current window, discard.
            
            float stepsPerPage = 32.0;
            float pageStart = floor(u_playhead / stepsPerPage) * stepsPerPage;
            
            float localRow = float(row) - pageStart;
            
            // If active note is outside current page view, clip it
            if (localRow < 0.0 || localRow >= stepsPerPage) {
                gl_Position = vec4(0.0);
                return;
            }
            
            // X = Time (localRow), Y = Channel (col)
            float xPos = localRow * u_cellSize.x;
            float yPos = float(col) * u_cellSize.y;
            
            // Adjust to cell centers (a_pos is -0.5..0.5)
            vec2 capSize = u_cellSize * 0.9;
            vec2 center = vec2(xPos, yPos) + u_cellSize * 0.5 + u_offset;
            
            vec2 pos = center + (a_pos * capSize);
            
            // NDC conversion (0..W -> -1..1, 0..H -> 1..-1)
            vec2 ndc = (pos / u_resolution) * 2.0 - 1.0;
            ndc.y = -ndc.y; // Flip Y (0 top)
            
            gl_Position = vec4(ndc, 0.0, 1.0);
            
        } else {
            // --- v0.38: CIRCULAR LAYOUT ---
            int ringIndex = col;
            if (u_invertChannels == 0) {
                ringIndex = int(u_cols) - 1 - col;
            }

            vec2 center = u_resolution * 0.5;
            float minDim = min(u_resolution.x, u_resolution.y);
            
            float maxRadius = minDim * 0.45;
            float minRadius = minDim * 0.15;
            float ringDepth = (maxRadius - minRadius) / u_cols;
            
            float radius = minRadius + float(ringIndex) * ringDepth;
            
            float totalSteps = 64.0;
            float anglePerStep = (2.0 * PI) / totalSteps;
            float theta = -1.570796 + float(row % 64) * anglePerStep;
            
            float circumference = 2.0 * PI * radius;
            float arcLength = circumference / totalSteps;
            
            // Fuller Square Size (0.95)
            float btnW = arcLength * 0.95; 
            float btnH = ringDepth * 0.95;
            
            vec2 localPos = a_pos * vec2(btnW, btnH);
            
            float rotAng = theta + 1.570796;
            float cA = cos(rotAng);
            float sA = sin(rotAng);
            
            float rotX = localPos.x * cA - localPos.y * sA;
            float rotY = localPos.x * sA + localPos.y * cA;
            
            float worldX = center.x + cos(theta) * radius + rotX;
            float worldY = center.y + sin(theta) * radius + rotY;
            
            vec2 ndc = vec2((worldX / u_resolution.x) * 2.0 - 1.0, 1.0 - (worldY / u_resolution.y) * 2.0);
            gl_Position = vec4(ndc, 0.0, 1.0);
        }

        v_uv = a_pos + 0.5;
        v_active = 1.0;
    }`;

    const fsSource = `#version 300 es
    precision mediump float;
    in vec2 v_uv;
    in float v_active;
    out vec4 fragColor;
    
    void main() {
        vec2 p = v_uv - 0.5;
        float r = length(p) * 2.0;
        
        vec2 d = abs(p) * 2.0;
        float box = max(d.x, d.y);
        
        // Rectangular/Square Shape (Sharper edges)
        float alphaMask = 1.0 - smoothstep(0.9, 1.0, box);
        
        float spec = 0.0;
        vec2 specPos = p - vec2(-0.2, -0.2);
        if (length(specPos) < 0.25) {
            spec = smoothstep(0.25, 0.0, length(specPos)) * 0.6;
        }
        
        vec3 tint = vec3(0.8, 0.9, 1.0);
        float opacity = 0.25 + (1.0 - r) * 0.1; 
        
        vec3 col = tint + vec3(spec);
        fragColor = vec4(col, (opacity + spec) * alphaMask);
    }
    `;

    const createShader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error("GL Shader Error", gl.getShaderInfoLog(s));
        gl.deleteShader(s);
        return null;
      }
      return s;
    };

    const vs = createShader(gl.VERTEX_SHADER, vsSource);
    const fs = createShader(gl.FRAGMENT_SHADER, fsSource);
    if(!vs || !fs) return;

    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error("GL Link Error", gl.getProgramInfoLog(prog));
      return;
    }

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 
      -0.5, 0.5, 0.5, -0.5, 0.5, 0.5
    ]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    glResourcesRef.current = { program: prog, vao, texture: tex, buffer: buf };

    return () => {
      gl.deleteProgram(prog);
      gl.deleteVertexArray(vao);
      gl.deleteBuffer(buf);
      gl.deleteTexture(tex);
    };
  }, [shaderFile]); 

  // === WEBGL2 DATA UPLOAD ===
  useEffect(() => {
    if (!shaderFile.includes('v0.38') && !shaderFile.includes('v0.39') && !shaderFile.includes('v0.40')) return;

    const gl = glContextRef.current;
    const res = glResourcesRef.current;
    if (!gl || !res || !matrix) return;

    const rows = matrix.numRows;
    const rawCols = matrix.numChannels;
    const cols = padTopChannel ? rawCols + 1 : rawCols;
    const startCol = padTopChannel ? 1 : 0;

    const data = new Uint8Array(rows * cols); 
    
    for(let r=0; r<rows; r++) {
       const rowData = matrix.rows[r] || [];
       for(let c=0; c<rawCols; c++) {
           const cell = rowData[c];
           const hasNote = cell && cell.note !== undefined && cell.note > 0;
           // X=Col(Channel), Y=Row(Time)
           const texIndex = r * cols + (c + startCol);
           data[texIndex] = hasNote ? 255 : 0;
       }
    }

    gl.bindTexture(gl.TEXTURE_2D, res.texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, cols, rows, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, data);
  }, [matrix, padTopChannel, shaderFile]);

  // === WEBGL2 RENDER FUNCTION ===
  const drawWebGL = () => {
    if (!shaderFile.includes('v0.38') && !shaderFile.includes('v0.39') && !shaderFile.includes('v0.40')) return;

    const gl = glContextRef.current;
    const res = glResourcesRef.current;
    if (!gl || !res || !matrix) return;

    if (glCanvasRef.current && (glCanvasRef.current.width !== canvasMetrics.width || glCanvasRef.current.height !== canvasMetrics.height)) {
        glCanvasRef.current.width = canvasMetrics.width;
        glCanvasRef.current.height = canvasMetrics.height;
        gl.viewport(0, 0, canvasMetrics.width, canvasMetrics.height);
    }

    gl.clearColor(0,0,0,0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(res.program);

    const rawCols = matrix.numChannels;
    const cols = padTopChannel ? rawCols + 1 : rawCols;
    const rows = matrix.numRows;

    const uRes = gl.getUniformLocation(res.program, 'u_resolution');
    const uCell = gl.getUniformLocation(res.program, 'u_cellSize');
    const uOffset = gl.getUniformLocation(res.program, 'u_offset');
    const uCols = gl.getUniformLocation(res.program, 'u_cols');
    const uRows = gl.getUniformLocation(res.program, 'u_rows');
    const uPlay = gl.getUniformLocation(res.program, 'u_playhead');
    const uInvert = gl.getUniformLocation(res.program, 'u_invertChannels');
    const uLayout = gl.getUniformLocation(res.program, 'u_layoutMode');
    const uTex = gl.getUniformLocation(res.program, 'u_noteData');
    
    gl.uniform2f(uRes, canvasMetrics.width, canvasMetrics.height);
    
    // v0.39 and v0.40 Override: Fit 32 steps exactly into canvas width (or active area)
    let effectiveCellW = cellWidth;
    let effectiveCellH = cellHeight;
    if (shaderFile.includes('v0.40')) {
        // v0.40: Fits in the blank area (705x725)
        effectiveCellW = 705.0 / 32.0;
        effectiveCellH = 725.0 / cols;
        gl.uniform2f(uOffset, 160.0, 160.0);
    } else if (shaderFile.includes('v0.39')) {
        effectiveCellW = canvasMetrics.width / 32.0;
        effectiveCellH = canvasMetrics.height / cols;
        gl.uniform2f(uOffset, 0.0, 0.0);
    } else {
        gl.uniform2f(uOffset, 0.0, 0.0);
    }
    gl.uniform2f(uCell, effectiveCellW, effectiveCellH);

    gl.uniform1f(uCols, cols);
    gl.uniform1f(uRows, rows);
    
    // Set Layout Mode: 1=Circular(0.38), 2=Horizontal(0.39, 0.40)
    gl.uniform1i(uLayout, (shaderFile.includes('v0.39') || shaderFile.includes('v0.40')) ? 2 : 1);
    gl.uniform1i(uInvert, invertChannels ? 1 : 0);
    
    const totalPlayhead = playheadRow + (tickOffset || 0);
    gl.uniform1f(uPlay, totalPlayhead);
    
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, res.texture);
    gl.uniform1i(uTex, 0);

    gl.bindVertexArray(res.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, rows * cols);
  };

  const loadBezelTexture = async (device: GPUDevice) => {
    if (bezelTextureResourcesRef.current) return;
    
    // v0.39 and v0.40 use square bezel, others use round/custom
    const textureName = (shaderFile.includes('v0.39') || shaderFile.includes('v0.40')) ? 'bezel-square.png' : 'bezel.png';

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
  
  // (ensureButtonTexture, ensureVideoPlaceholder, preferredImageFormat, refreshBindGroup, WebGPU init effects unchanged...)
  const ensureButtonTexture = async (device: GPUDevice) => {
    if (textureResourcesRef.current) return;
    const textureUrl = shaderFile.includes('v0.30') ? 'unlit-button-2.png' : 'https://test.1ink.us/xm-player/unlit-button.png';
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
    const filterMode: GPUFilterMode = 'nearest';
    const sampler = device.createSampler({ magFilter: filterMode, minFilter: filterMode });
    textureResourcesRef.current = { sampler, view: texture.createView() };
  };

  const ensureVideoPlaceholder = (device: GPUDevice) => {
    if (videoTextureRef.current) return;
    const fmt = preferredImageFormat(device);
    const texture = device.createTexture({
      size: [1, 1, 1],
      format: fmt,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    if (fmt === 'rgba32float') {
      const data = new Float32Array([100.0/255.0, 100.0/255.0, 100.0/255.0, 1.0]);
      device.queue.writeTexture({ texture }, data, { bytesPerRow: 16 }, { width: 1, height: 1 });
    } else {
      const data = new Uint8Array([100, 100, 100, 255]);
      device.queue.writeTexture({ texture }, data, { bytesPerRow: 4 }, { width: 1, height: 1 });
    }
    videoTextureRef.current = texture;
    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    textureResourcesRef.current = { sampler, view: texture.createView() };
  };

  const preferredImageFormat = (device: GPUDevice) => {
    return device.features.has('float32-filterable') ? ('rgba32float' as GPUTextureFormat) : ('rgba8unorm' as GPUTextureFormat);
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
  
  // (WebGPU initialization effect is unchanged)
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
        context.configure({ device, format });

        textureResourcesRef.current = null;
        bezelTextureResourcesRef.current = null;

        const shaderSource = await fetch(`./shaders/${shaderFile}`).then(res => res.text());
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

        const uniformSize = layoutType === 'simple' ? 32 : 64;
        const uniformBuffer = device.createBuffer({ size: alignTo(uniformSize, 256), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

        if (shouldUseBackgroundPass(shaderFile)) {
          try {
            const backgroundShaderFile = getBackgroundShaderFile(shaderFile);
            const backgroundSource = await fetch(`./shaders/${backgroundShaderFile}`).then(res => res.text());
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

        const isHighPrec = shaderFile.includes('v0.36') || shaderFile.includes('v0.37') || shaderFile.includes('v0.38') || shaderFile.includes('v0.39') || shaderFile.includes('v0.40');
        const packFunc = isHighPrec ? packPatternMatrixHighPrecision : packPatternMatrix;
        cellsBufferRef.current = createBufferWithData(device, packFunc(matrix, padTopChannel), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);

        if (layoutType === 'extended') {
          const numRows = matrix?.numRows ?? DEFAULT_ROWS;
          rowFlagsBufferRef.current = createBufferWithData(device, buildRowFlags(numRows), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
          const channelsCount = Math.max(1, matrix?.numChannels ?? DEFAULT_CHANNELS);
          const emptyChannels = packChannelStates([], channelsCount, padTopChannel);
          channelsBufferRef.current = createBufferWithData(device, emptyChannels, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
        }

        const needsTexture = layoutType === 'texture' || layoutType === 'extended';
        if (needsTexture) {
          const isVideoShader = shaderFile.includes('v0.20') || shaderFile.includes('v0.23') || shaderFile.includes('v0.24') || shaderFile.includes('v0.25');
          if (isVideoShader) ensureVideoPlaceholder(device); else await ensureButtonTexture(device);
        }

        refreshBindGroup(device);
        setGpuReady(true);
      } catch (error) { console.error('Failed to initialize WebGPU pattern display', error); if (!cancelled) setWebgpuAvailable(false); }
    };
    init();
    return () => {
      cancelled = true; setWebgpuAvailable(true); setGpuReady(false);
      bindGroupRef.current = null; pipelineRef.current = null;
      if (bezelUniformBufferRef.current) { bezelUniformBufferRef.current.destroy(); bezelUniformBufferRef.current = null; }
      bezelBindGroupRef.current = null; bezelPipelineRef.current = null; bezelTextureResourcesRef.current = null;
      if (clickTimeoutRef.current !== null) { window.clearTimeout(clickTimeoutRef.current); clickTimeoutRef.current = null; }
      cellsBufferRef.current = null; uniformBufferRef.current = null; rowFlagsBufferRef.current = null; channelsBufferRef.current = null; textureResourcesRef.current = null;
      if (videoTextureRef.current) { const deviceToWait = deviceRef.current; if(deviceToWait) deviceToWait.queue.onSubmittedWorkDone().then(() => { try { videoTextureRef.current?.destroy(); } catch (e) {} videoTextureRef.current = null; }).catch(()=>{ try { videoTextureRef.current?.destroy(); } catch (e) {} videoTextureRef.current = null; }); else { try { videoTextureRef.current.destroy(); } catch (e) {} videoTextureRef.current = null; } }
      deviceRef.current = null; contextRef.current = null;
    };
  }, [shaderFile]);

  // (The rest of useEffects for updating buffers are unchanged)
  useEffect(() => {
    const device = deviceRef.current;
    if (!device || !gpuReady) return;
    if (cellsBufferRef.current) cellsBufferRef.current.destroy();
    const isHighPrec = shaderFile.includes('v0.36') || shaderFile.includes('v0.37') || shaderFile.includes('v0.38') || shaderFile.includes('v0.39') || shaderFile.includes('v0.40');
    const packFunc = isHighPrec ? packPatternMatrixHighPrecision : packPatternMatrix;
    cellsBufferRef.current = createBufferWithData(device, packFunc(matrix, padTopChannel), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
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
        if (recreated) refreshBindGroup(device);
    }
  }, [channels, matrix?.numChannels, gpuReady]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!shaderFile.includes('v0.37') && !shaderFile.includes('v0.38') && !shaderFile.includes('v0.39') && !shaderFile.includes('v0.40')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const u = x / rect.width;
    const v = y / rect.height;
    const pX = u - 0.5;
    const pY = 0.5 - v;
    
    const isV40 = shaderFile.includes('v0.40');

    // Updated: New Horizontal Volume Slider (Top Right)
    const volSliderX = isV40 ? 0.08 : 0.28; // Moved inward for v0.40
    const volSliderY = 0.415;
    const volSliderW = 0.18;
    const volSliderH = 0.05; // Hit area
    
    if (Math.abs(pX - volSliderX) < volSliderW * 0.5 && Math.abs(pY - volSliderY) < volSliderH * 0.5) {
      // Calculate normalized value (0 to 1) along horizontal axis
      const relX = (pX - volSliderX) / (volSliderW * 0.9); // -0.5 to 0.5 range
      const volValue = relX + 0.5;
      onVolumeChange?.(Math.max(0, Math.min(1, volValue)));
      return;
    }
    
    // Existing Panning Slider
    const sliderRightX = 0.42;
    const sliderY = -0.2;
    const sliderH = 0.2;
    const sliderClickRadius = 0.03;

    if (Math.abs(pX - sliderRightX) < sliderClickRadius && Math.abs(pY - sliderY) < sliderH * 0.5) {
      const panValue = (pY - sliderY) / (sliderH * 0.45);
      onPanChange?.(Math.max(-1, Math.min(1, panValue)));
      return;
    }
    
    // Seek Bar
    const barY = -0.45; const barWidth = 0.6; const barCenterX = 0.1; const barHeight = 0.03;
    if (Math.abs(pY - barY) < barHeight && Math.abs(pX - barCenterX) < barWidth / 2) {
       const relX = pX - (barCenterX - barWidth/2);
       if (onSeek) onSeek(Math.floor(Math.max(0, Math.min(1, relX / barWidth)) * (totalRows || 64)));
       return;
    }
    
    // Buttons
    const btnRadius = 0.045;
    const dist = (x1: number, y1: number, x2: number, y2: number) => Math.sqrt((x1-x2)**2 + (y1-y2)**2);
    const flashButton = (buttonId: number) => {
      if (clickTimeoutRef.current !== null) window.clearTimeout(clickTimeoutRef.current);
      setClickedButton(buttonId);
      clickTimeoutRef.current = window.setTimeout(() => { setClickedButton(0); clickTimeoutRef.current = null; }, 200) as number;
    };

    const loopX = isV40 ? -0.24 : -0.44; // Moved inward for v0.40
    const openX = isV40 ? 0.24 : 0.44;   // Moved inward for v0.40
    const playY = isV40 ? -0.45 : -0.40; // Moved down for v0.40
    const stopY = isV40 ? -0.45 : -0.40; // Moved down for v0.40

    if (dist(pX, pY, loopX, 0.42) < btnRadius) { flashButton(1); onLoopToggle?.(); return; }
    if (dist(pX, pY, openX, 0.42) < btnRadius) { flashButton(2); fileInputRef.current?.click(); return; }
    if (dist(pX, pY, -0.44, playY) < btnRadius) { flashButton(3); onPlay?.(); return; }
    if (dist(pX, pY, -0.35, stopY) < btnRadius) { flashButton(4); onStop?.(); return; }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
     if (e.target.files && e.target.files.length > 0) onFileSelected?.(e.target.files[0]);
  };

  const render = () => {
    // (render function unchanged)
    const device = deviceRef.current;
    const context = contextRef.current;
    const pipeline = pipelineRef.current;
    const bindGroup = bindGroupRef.current;
    if (!device || !context || !pipeline || !bindGroup || !uniformBufferRef.current || !cellsBufferRef.current) return;

    if (uniformBufferRef.current) {
      const numRows = matrix?.numRows ?? DEFAULT_ROWS;
      const rawChannels = matrix?.numChannels ?? DEFAULT_CHANNELS;
      const numChannels = padTopChannel ? rawChannels + 1 : rawChannels;
      const rowLimit = Math.max(1, numRows);
      const tickRow = clampPlayhead(playheadRow, rowLimit);
      const fractionalTick = Math.min(1, Math.max(0, tickOffset));
      const effectiveTime = isModuleLoaded ? timeSec : localTime;

      // v0.39 and v0.40 Override: Ensure uniform payload reflects the auto-calculated dimensions
      let effectiveCellW = cellWidth;
      let effectiveCellH = cellHeight;
      if (shaderFile.includes('v0.40')) {
          effectiveCellW = 705.0 / 32.0;
          effectiveCellH = 725.0 / numChannels;
      } else if (shaderFile.includes('v0.39')) {
          effectiveCellW = canvasMetrics.width / 32.0;
          effectiveCellH = canvasMetrics.height / numChannels; // Approx
      }

      const uniformPayload = createUniformPayload(layoutTypeRef.current, {
        numRows,
        numChannels,
        playheadRow: tickRow,
        isPlaying,
        cellW: effectiveCellW,
        cellH: effectiveCellH,
        canvasW: canvasMetrics.width,
        canvasH: canvasMetrics.height,
        tickOffset: fractionalTick,
        bpm,
        timeSec: effectiveTime,
        beatPhase,
        groove: Math.min(1, Math.max(0, grooveAmount)),
        kickTrigger,
        activeChannels,
        isModuleLoaded,
        bloomIntensity: bloomIntensity ?? 1.0,
        bloomThreshold: bloomThreshold ?? 0.8,
        invertChannels: invertChannels,
        dimFactor: dimFactor,
      });
      device.queue.writeBuffer(uniformBufferRef.current, 0, uniformPayload);
    }

    if (bezelUniformBufferRef.current) {
      const buf = new Float32Array(24);
      buf[0] = canvasMetrics.width; buf[1] = canvasMetrics.height;
      const minDim = Math.min(canvasMetrics.width, canvasMetrics.height);
      const circularLayout = isCircularLayoutShader(shaderFile);
      buf[2] = minDim * (circularLayout ? 0.05 : 0.07);
      buf[3] = 0.98; buf[4] = 0.98; buf[5] = 0.98;
      buf[6] = 0.92; buf[7] = 0.92; buf[8] = 0.93;
      buf[9] = 0.02;
      if (shaderFile.includes('v0.35')) { buf[10] = 0.0; buf[11] = 0.95; buf[12] = 0.32; } 
      else { buf[10] = circularLayout ? 0.0 : 1.0; buf[11] = circularLayout ? 1.0 : 1.25; buf[12] = circularLayout ? 1.0 : 0.0; }
      buf[13] = 0.10;
      buf[14] = dimFactor;
      buf[15] = isPlaying ? 1.0 : 0.0;
      buf[16] = volume;
      buf[17] = pan;
      buf[18] = bpm;
      const uint32View = new Uint32Array(buf.buffer);
      uint32View[19] = isLooping ? 1 : 0;
      uint32View[20] = 0;
      uint32View[21] = playheadRow;
      uint32View[22] = clickedButton;
      device.queue.writeBuffer(bezelUniformBufferRef.current, 0, buf.buffer, buf.byteOffset, buf.byteLength);
    }

    const isVideoShader = shaderFile.includes('v0.20') || shaderFile.includes('v0.23') || shaderFile.includes('v0.24') || shaderFile.includes('v0.25');
    if (isVideoShader && videoRef.current) {
         const source = videoRef.current;
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
            try { if (videoTextureRef.current) device.queue.copyExternalImageToTexture({ source, flipY: true }, { texture: videoTextureRef.current }, [sourceWidth, sourceHeight, 1]); } catch(e) {}
         }
    }

    drawWebGL();

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          loadOp: 'clear',
          clearValue: { r: 0.98, g: 0.98, b: 0.98, a: 1 },
          storeOp: 'store',
      }],
    });

    if (bezelPipelineRef.current && bezelBindGroupRef.current) {
      pass.setPipeline(bezelPipelineRef.current);
      pass.setBindGroup(0, bezelBindGroupRef.current);
      pass.draw(6, 1, 0, 0);
    }

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    const numRows = matrix?.numRows ?? DEFAULT_ROWS;
    const rawChannels = matrix?.numChannels ?? DEFAULT_CHANNELS;
    const numChannels = padTopChannel ? rawChannels + 1 : rawChannels;
    const totalInstances = numRows * numChannels;

    if (totalInstances > 0) {
      if (isSinglePassCompositeShader(shaderFile)) {
        pass.draw(6, 1, 0, totalInstances);
        pass.draw(6, totalInstances, 0, 0);
      } else {
        pass.draw(6, totalInstances, 0, 0);
      }
    }
    pass.end();
    device.queue.submit([encoder.finish()]);
  };

  // Keep a ref to the latest render function to avoid stale closures in the loop
  useEffect(() => {
    renderRef.current = render;
  });

  useEffect(() => {
    const loop = (time: number) => {
      animationFrameRef.current = requestAnimationFrame(loop);

      // Update local time if module is not playing/loaded, for idle animations
      if (!isModuleLoaded && !isPlaying) {
        setLocalTime(time / 1000.0);
      }

      if (renderRef.current) {
        renderRef.current();
      }
    };

    animationFrameRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isModuleLoaded, isPlaying]);

  return (
    <div className={`pattern-display relative ${padTopChannel && !shaderFile.includes('v0.40') ? 'p-8 rounded-xl bg-[#18181a] shadow-2xl border border-[#333]' : ''}`}>
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

      {(shaderFile.includes('v0.35') || shaderFile.includes('v0.37') || shaderFile.includes('v0.38') || shaderFile.includes('v0.39') || shaderFile.includes('v0.40')) && (
        <button
            onClick={() => setInvertChannels(p => !p)}
            className="absolute top-2 left-12 px-2 py-1 bg-[#222] text-xs font-mono text-gray-400 border border-[#444] rounded hover:bg-[#333] hover:text-white transition-colors"
        >
            {invertChannels ? "[INNER LOW]" : "[OUTER LOW]"}
        </button>
      )}

      <canvas
        ref={canvasRef}
        width={canvasMetrics.width}
        height={canvasMetrics.height}
        onClick={handleCanvasClick}
        className={`${padTopChannel && !shaderFile.includes('v0.40') ? 'rounded bg-black shadow-inner border border-black/50' : ''} cursor-pointer`}
        style={{
          maxWidth: '100%',
          maxHeight: '100%',
          width: 'auto',
          height: 'auto',
          objectFit: 'contain',
          aspectRatio: `${canvasMetrics.width} / ${canvasMetrics.height}`,
          position: 'relative',
          zIndex: 1
        }}
      />
      
      {(shaderFile.includes('v0.38') || shaderFile.includes('v0.39') || shaderFile.includes('v0.40')) && (
        <canvas
          ref={glCanvasRef}
          width={canvasMetrics.width}
          height={canvasMetrics.height}
          style={{
            position: 'absolute',
            top: (padTopChannel && !shaderFile.includes('v0.40')) ? '2rem' : 0,
            left: (padTopChannel && !shaderFile.includes('v0.40')) ? '2rem' : 0,
            width: 'auto',
            height: 'auto',
            maxWidth: '100%',
            maxHeight: '100%',
            aspectRatio: `${canvasMetrics.width} / ${canvasMetrics.height}`,
            pointerEvents: 'none',
            zIndex: 2,
            mixBlendMode: 'normal'
          }}
        />
      )}

      {!webgpuAvailable && <div className="error">WebGPU not available in this browser.</div>}
    </div>
  );
};
