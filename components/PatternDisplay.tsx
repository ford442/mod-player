import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { ChannelShadowState, PatternMatrix } from '../types';
import {
  GRID_RECT,
  POLAR_RINGS,
  LAYOUT_MODES,
  CAP_CONFIG,
  calculateHorizontalCellSize,
  calculateCapScale,
  getLayoutModeFromShader,
  type LayoutMode
} from '../utils/geometryConstants';

const DEFAULT_ROWS = 64;
const DEFAULT_CHANNELS = 4;

const EMPTY_CHANNEL: ChannelShadowState = {
  
  volume: 1.0, pan: 0.5, freq: 440, trigger: 0, noteAge: 1000,
  activeEffect: 0, effectValue: 0, isMuted: 0
};
const PLAYHEAD_EPSILON = 0.0001;
const alignTo = (val: number, align: number) => Math.floor((val + align - 1) / align) * align;

// Step counts for WebGL2 overlay layout modes (must match shader constants)
// Shader Helper Functions
type LayoutType = 'standard' | 'extended' | 'texture';

const getLayoutType = (shaderFile: string): LayoutType => {
  // v0.12 removed
  // v0.13+ use extended layout (2x uint32 per cell)
  if (shaderFile.includes('v0.13') || shaderFile.includes('v0.14') || shaderFile.includes('v0.15') || shaderFile.includes('v0.16') || shaderFile.includes('v0.17') || shaderFile.includes('v0.18') || shaderFile.includes('v0.19') || shaderFile.includes('v0.20') || shaderFile.includes('v0.21') || shaderFile.includes('v0.23') || shaderFile.includes('v0.24') || shaderFile.includes('v0.25') || shaderFile.includes('v0.26') || shaderFile.includes('v0.27') || shaderFile.includes('v0.28') || shaderFile.includes('v0.29') || shaderFile.includes('v0.30') || shaderFile.includes('v0.31') || shaderFile.includes('v0.32') || shaderFile.includes('v0.33') || shaderFile.includes('v0.34') || shaderFile.includes('v0.35') || shaderFile.includes('v0.36') || shaderFile.includes('v0.37') || shaderFile.includes('v0.38') || shaderFile.includes('v0.39') || shaderFile.includes('v0.40') || shaderFile.includes('v0.42') || shaderFile.includes('v0.43') || shaderFile.includes('v0.44') || shaderFile.includes('v0.45') || shaderFile.includes('v0.46') || shaderFile.includes('v0.47') || shaderFile.includes('v0.48') || shaderFile.includes('v0.49')) return 'extended';
  return 'standard';
};


const isSinglePassCompositeShader = (shaderFile: string) => {
  // Shaders that do their own background composition in one pass
  // v0.45, v0.46, v0.47, v0.48, v0.49 are NOT single-pass — they need the external chassis_frosted background
  if (shaderFile.includes('v0.21') || shaderFile.includes('v0.40') || shaderFile.includes('v0.42') || shaderFile.includes('v0.43') || shaderFile.includes('v0.44')) return 'chassis_frosted.wgsl';
  return false;
};

const isCircularLayoutShader = (shaderFile: string) => {
  // v0.39 and v0.40 are NOT circular (they're horizontal). v0.38 IS circular. v0.45 IS circular. v0.46 IS circular.
  return shaderFile.includes('v0.25') || shaderFile.includes('v0.26') || shaderFile.includes('v0.35') || shaderFile.includes('v0.37') || shaderFile.includes('v0.38') || shaderFile.includes('v0.45') || shaderFile.includes('v0.46') || shaderFile.includes('v0.47') || shaderFile.includes('v0.48') || shaderFile.includes('v0.49');
};

const shouldUseBackgroundPass = (shaderFile: string) => {
  return !isSinglePassCompositeShader(shaderFile);
};

const getBackgroundShaderFile = (shaderFile: string): string => {
  if (shaderFile.includes('v0.23') || shaderFile.includes('v0.24')) return 'chassis_video.wgsl';
  // Use the new frosted shader for the latest layout
  if (shaderFile.includes('v0.21') || shaderFile.includes('v0.40') || shaderFile.includes('v0.42') || shaderFile.includes('v0.43') || shaderFile.includes('v0.44') || shaderFile.includes('v0.45') || shaderFile.includes('v0.46') || shaderFile.includes('v0.47') || shaderFile.includes('v0.48') || shaderFile.includes('v0.49')) return 'chassis_frosted.wgsl';
  
  if (shaderFile.includes('v0.37') || shaderFile.includes('v0.38') || shaderFile.includes('v0.39')) return 'chassisv0.37.wgsl';
  if (shaderFile.includes('v0.27') || shaderFile.includes('v0.28') || shaderFile.includes('v0.30') || shaderFile.includes('v0.31') || shaderFile.includes('v0.32') || shaderFile.includes('v0.33') || shaderFile.includes('v0.34') || shaderFile.includes('v0.35') || shaderFile.includes('v0.36')) return 'chassisv0.1.wgsl';
  return 'bezel.wgsl';
};
const shouldEnableAlphaBlending = (shaderFile: string) => {
  return shaderFile.includes("v0.35") || shaderFile.includes("v0.38") || shaderFile.includes("v0.40") || shaderFile.includes("v0.42") || shaderFile.includes("v0.43") || shaderFile.includes("v0.44") || shaderFile.includes("v0.45") || shaderFile.includes("v0.46") || shaderFile.includes("v0.47") || shaderFile.includes("v0.48") || shaderFile.includes("v0.49");
};


const fillUniformPayload = (
  layoutType: LayoutType,
  params: {
    numRows: number;
    numChannels: number;
    playheadRow: number;
    playheadRowAsFloat?: boolean;
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
    activeChannels: number[];
    isModuleLoaded: boolean;
    bloomIntensity?: number;
    bloomThreshold?: number;
    invertChannels?: boolean;
    dimFactor?: number;
  analyserNode?: AnalyserNode | null;
    gridRect?: { x: number; y: number; w: number; h: number };
  },
  uint: Uint32Array,
  float: Float32Array
): number => {
  if (layoutType === 'extended') {
    uint[0] = Math.max(0, params.numRows) >>> 0;
    uint[1] = Math.max(0, params.numChannels) >>> 0;
    if (params.playheadRowAsFloat) {
      float[2] = Math.max(0, params.playheadRow);
    } else {
      uint[2] = Math.max(0, params.playheadRow) >>> 0;
    }
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
    uint[14] = params.activeChannels.reduce((mask, ch) => mask | (1 << ch), 0) >>> 0;
    uint[15] = params.isModuleLoaded ? 1 : 0;
    float[16] = params.bloomIntensity ?? 1.0;
    float[17] = params.bloomThreshold ?? 0.8;
    uint[18] = params.invertChannels ? 1 : 0;
    float[19] = params.dimFactor ?? 1.0;
    // Grid bounds for unified WebGL/WebGPU alignment
    // Use individual components for easier WGSL struct alignment
    float[20] = params.gridRect?.x ?? GRID_RECT.x;
    float[21] = params.gridRect?.y ?? GRID_RECT.y;
    float[22] = params.gridRect?.w ?? GRID_RECT.w;
    float[23] = params.gridRect?.h ?? GRID_RECT.h;
    return 96;
  }

  uint[0] = Math.max(0, params.numRows) >>> 0;
  uint[1] = Math.max(0, params.numChannels) >>> 0;
  if (params.playheadRowAsFloat) {
    float[2] = Math.max(0, params.playheadRow);
  } else {
    uint[2] = Math.max(0, params.playheadRow) >>> 0;
  }
  uint[3] = 0;
  float[4] = params.cellW;
  float[5] = params.cellH;
  float[6] = params.canvasW;
  float[7] = params.canvasH;
  if (layoutType === 'texture') {
    float[8] = 1; float[9] = 1; float[10] = 0; float[11] = 0; float[12] = 1; float[13] = 1;
    return 64;
  }
  return 32;
};

const fillChannelStates = (channels: ChannelShadowState[], count: number, view: DataView, padTopChannel = false): void => {
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
  // PERFORMANCE OPTIMIZATION: Ref for high-frequency updates (avoids React re-renders)
  playbackStateRef?: React.MutableRefObject<{
    playheadRow: number;
    currentOrder: number;
    timeSec: number;
    beatPhase: number;
    kickTrigger: number;
    grooveAmount: number;
  }>;
}

const clampPlayhead = (value: number, numRows: number) => {
  if (numRows <= 0) return 0;
  return Math.min(Math.max(value, 0), Math.max(0, numRows - PLAYHEAD_EPSILON));
};

// Parse helpers
const parsePackedB = (text: string) => {
  let volType = 0, volValue = 0;
  let effCode = 0, effParam = 0;
  const volMatch = text.match(/v(\d{1,3})/i);
  if (volMatch?.[1]) {
    volType = 1;
    const v = Math.min(255, Math.round((parseInt(volMatch[1], 10) / 64) * 255));
    volValue = isFinite(v) ? v : 0;
  }
  const panMatch = text.match(/p(\d{1,3})/i);
  if (panMatch?.[1]) {
    volType = 2;
    const p = Math.min(255, Math.round((parseInt(panMatch[1], 10) / 64) * 255));
    volValue = isFinite(p) ? p : 0;
  }
  const effMatch = text.match(/([A-Za-z])[ ]*([0-9A-Fa-f]{2})/);
  if (effMatch?.[1] && effMatch[2]) {
    effCode = effMatch[1].toUpperCase().charCodeAt(0) & 0xff;
    effParam = parseInt(effMatch[2], 16) & 0xff;
  } else {
    const effNum = text.match(/([0-9])[ ]*([0-9A-Fa-f]{2})/);
    if (effNum?.[1] && effNum[2]) {
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
      const instByte = instMatch?.[1] ? Math.min(255, parseInt(instMatch[1], 10)) : 0;
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
    dimFactor = 1.0, analyserNode,
    playbackStateRef,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [webgpuAvailable, setWebgpuAvailable] = useState(true);
  const [localTime, setLocalTime] = useState(0);
  const [invertChannels, setInvertChannels] = useState(false);
  const [clickedButton, setClickedButton] = useState<number>(0);
  const [gpuReady, setGpuReady] = useState(false);

  // Debug overlay state
  const [debugInfo, setDebugInfo] = useState<{
    layoutMode: string;
    errors: string[];
    uniforms: Record<string, number | string>;
    visible: boolean;
  }>({ layoutMode: 'NONE', errors: [], uniforms: {}, visible: true });

  const deviceRef = useRef<GPUDevice | null>(null);
  const contextRef = useRef<GPUCanvasContext | null>(null);
  const pipelineRef = useRef<GPURenderPipeline | null>(null);
  const bindGroupRef = useRef<GPUBindGroup | null>(null);
  const uniformBufferRef = useRef<GPUBuffer | null>(null);
  const cellsBufferRef = useRef<GPUBuffer | null>(null);
  const rowFlagsBufferRef = useRef<GPUBuffer | null>(null);
  const channelsBufferRef = useRef<GPUBuffer | null>(null);
  const useExtendedRef = useRef<boolean>(false);
  const clickTimeoutRef = useRef<number | null>(null);
  const bezelTextureResourcesRef = useRef<{ sampler: GPUSampler; view: GPUTextureView } | null>(null);
  const glResourcesRef = useRef<{ program: WebGLProgram; vao: WebGLVertexArrayObject; texture: WebGLTexture; capTexture?: WebGLTexture; buffer: WebGLBuffer; uniforms: any } | null>(null);
  const animationFrameRef = useRef<number>();
  const textureResourcesRef = useRef<{ sampler: GPUSampler; view: GPUTextureView } | null>(null);
  const layoutTypeRef = useRef<LayoutType>('standard');
  const videoRef = useRef<HTMLVideoElement | HTMLImageElement | null>(null);
  const videoTextureRef = useRef<GPUTexture | null>(null);
  
  // Bezel/Chassis Pass Refs
  const bezelPipelineRef = useRef<GPURenderPipeline | null>(null);
  const bezelBindGroupRef = useRef<GPUBindGroup | null>(null);
  const bezelUniformBufferRef = useRef<GPUBuffer | null>(null);

  // WebGL Overlay Refs
  const glContextRef = useRef<WebGL2RenderingContext | null>(null);

  const renderRef = useRef<() => void>();

  // Persistent Buffers for Performance
  const uniformBufferDataRef = useRef(new ArrayBuffer(96));
  const uniformUintRef = useRef(new Uint32Array(uniformBufferDataRef.current));
  const uniformFloatRef = useRef(new Float32Array(uniformBufferDataRef.current));
  const freqDataRef = useRef(new Uint8Array(256));

  const bezelBufferDataRef = useRef(new ArrayBuffer(128)); // Enough for the Float32Array(24) and beyond
  const bezelFloatRef = useRef(new Float32Array(bezelBufferDataRef.current));
  const bezelUintRef = useRef(new Uint32Array(bezelBufferDataRef.current));

  const channelBufferDataRef = useRef<ArrayBuffer | null>(null);
  const channelDataViewRef = useRef<DataView | null>(null);

  // Canvas sizing state - stores actual buffer dimensions
  const canvasSizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  const resizeTimeoutRef = useRef<number | null>(null);

  // Use effective values if passed, otherwise default
  const numChannels = matrix?.numChannels ?? DEFAULT_CHANNELS;

  // Some older shaders have a reserved header/ring channel (index 0)
  // v0.16, v0.17, v0.21, v0.38, v0.39, v0.40, v0.42, v0.43, v0.44, v0.45, v0.46 need padding
  const padTopChannel = shaderFile.includes('v0.16') || shaderFile.includes('v0.17') || shaderFile.includes('v0.21') || shaderFile.includes('v0.38') || shaderFile.includes('v0.39') || shaderFile.includes('v0.40') || shaderFile.includes('v0.42') || shaderFile.includes('v0.43') || shaderFile.includes('v0.44') || shaderFile.includes('v0.45') || shaderFile.includes('v0.46') || shaderFile.includes('v0.49');

  // Specific canvas sizing for different layouts
  const isHorizontal = shaderFile.includes('v0.13') || shaderFile.includes('v0.14') || shaderFile.includes('v0.16') || shaderFile.includes('v0.17') || shaderFile.includes('v0.21') || shaderFile.includes('v0.39') || shaderFile.includes('v0.40');
  
  const canvasMetrics = useMemo(() => {
    // Force specific resolutions for certain chassis to match background images
    if (shaderFile.includes('v0.27') || shaderFile.includes('v0.28')) return { width: 1024, height: 1008 };
    if (shaderFile.includes('v0.21') || shaderFile.includes('v0.37') || shaderFile.includes('v0.38') || shaderFile.includes('v0.39') || shaderFile.includes('v0.40') || shaderFile.includes('v0.42') || shaderFile.includes('v0.43') || shaderFile.includes('v0.44') || shaderFile.includes('v0.45') || shaderFile.includes('v0.46') || shaderFile.includes('v0.47') || shaderFile.includes('v0.48') || shaderFile.includes('v0.49')) return { width: 1024, height: 1024 };

    if (isHorizontal) {
       return { width: 1024, height: 1024 }; // Square for horizontal layouts usually
    }
    // Circular layouts often benefit from square
    if (shaderFile.includes('v0.25') || shaderFile.includes('v0.30') || shaderFile.includes('v0.35')) return { width: 1024, height: 1024 };

    // Standard waterfall
    return {
      width: Math.max(800, numChannels * cellWidth),
      height: 600
    };
  }, [shaderFile, isHorizontal, numChannels, cellWidth]);

  // Handle Video Sources
  useEffect(() => {
    if (externalVideoSource) {
      videoRef.current = externalVideoSource;
    } else {
      // Default placeholder if none provided
      // In a real app we might load a default texture or just null
    }
  }, [externalVideoSource]);

  // Click handler for Glass UI interaction
  // WebGL Overlay Setup (Glass Effects)
  const initWebGL = () => {
    console.group('🔧 initWebGL');
    
    // Clean up existing WebGL resources first
    if (glContextRef.current && glResourcesRef.current) {
      const oldGl = glContextRef.current;
      const oldRes = glResourcesRef.current;
      try {
        oldGl.deleteProgram(oldRes.program);
        oldGl.deleteVertexArray(oldRes.vao);
        oldGl.deleteBuffer(oldRes.buffer);
        oldGl.deleteTexture(oldRes.texture);
        if (oldRes.capTexture) oldGl.deleteTexture(oldRes.capTexture);
        
        // Clear the canvas to prevent ghosting from previous shader mode
        oldGl.clearColor(0, 0, 0, 0);
        oldGl.clear(oldGl.COLOR_BUFFER_BIT | oldGl.DEPTH_BUFFER_BIT);
        
        console.log('✅ Cleaned up previous WebGL resources and cleared canvas');
      } catch (e) {
        console.warn('⚠️ Error cleaning up WebGL:', e);
      }
      glResourcesRef.current = null;
    }
    
    if (!glCanvasRef.current) {
      console.warn('⚠️ No glCanvasRef');
      console.groupEnd();
      return;
    }
    
    let gl: WebGL2RenderingContext | null = null;
    try {
      gl = glCanvasRef.current.getContext('webgl2', { alpha: true, premultipliedAlpha: false });
      if (!gl) {
        console.error('❌ Failed to get WebGL2 context');
        console.groupEnd();
        return;
      }
      console.log('✅ Got WebGL2 context');
    } catch (e) {
      console.error('❌ WebGL2 context error:', e);
      console.groupEnd();
      return;
    }
    
    glContextRef.current = gl;

    const vsSource = `#version 300 es
    precision highp float;

    in vec2 a_pos;
    in vec2 a_uv;

    out vec2 v_uv;
    out float v_active;  // 1.0 if Playhead matches this step
    out float v_hasNote; // 1.0 if Note data exists here

    uniform vec2 u_resolution;
    uniform vec2 u_cellSize;
    uniform vec2 u_offset;
    uniform float u_cols;
    uniform float u_rows;
    uniform float u_playhead;
    uniform int u_invertChannels;
    uniform int u_layoutMode; // 1=Circ, 2=Horiz32, 3=Horiz64
    uniform highp usampler2D u_noteData;

    const float PI = 3.14159265359;
    const float INNER_RADIUS = 0.3;  // From POLAR_RINGS
    const float OUTER_RADIUS = 0.9;  // From POLAR_RINGS
    const float CAP_SCALE_FACTOR = 0.88; // From CAP_CONFIG

    void main() {
        int id = gl_InstanceID;
        int col = id % int(u_cols); // Track Index
        int row = id / int(u_cols); // Step Index

        // 1. Check for Note Data
        uint note = texelFetch(u_noteData, ivec2(col, row), 0).r;
        v_hasNote = (note > 0u) ? 1.0 : 0.0;

        // 2. Calculate Cap Scale
        // Scale is derived from u_cellSize with CAP_SCALE_FACTOR (0.88) for pixel-perfect fit
        float capScale = min(u_cellSize.x, u_cellSize.y) * CAP_SCALE_FACTOR;
        if (note == 0u) capScale = 0.0; // Hide empty steps

        // 3. Playhead Logic
        float stepsPerPage = (u_layoutMode == 3) ? 64.0 : 32.0;
        float relativePlayhead = mod(u_playhead, stepsPerPage);

        float distToPlayhead = abs(float(row) - relativePlayhead);
        distToPlayhead = min(distToPlayhead, stepsPerPage - distToPlayhead);
        float activation = 1.0 - smoothstep(0.0, 1.5, distToPlayhead);
        capScale *= 1.0 + (0.2 * activation); // Pop effect with smooth falloff
        v_active = activation;

        // 4. Positioning Logic
        if (u_layoutMode == 2 || u_layoutMode == 3) {
            // --- HORIZONTAL LAYOUT (32-step or 64-step) ---
            // Pixel-perfect centered caps using shared constants
            // a_pos is in [-0.5, 0.5] range, we center it at [0.5, 0.5] within each cell
            float i = float(row); // step index
            float j = float(col); // track index
            
            // Calculate cell position
            float cellX = u_offset.x + i * u_cellSize.x;
            float cellY = u_offset.y + j * u_cellSize.y;
            
            // Center the cap within the cell using a_pos * capScale + cellCenter
            vec2 centered = a_pos * capScale + vec2(cellX + u_cellSize.x * 0.5, cellY + u_cellSize.y * 0.5);
            
            // Convert to NDC
            vec2 ndc = (centered / u_resolution) * 2.0 - 1.0;
            ndc.y = -ndc.y;
            gl_Position = vec4(ndc, 0.0, 1.0);

        } else {
            // --- CIRCULAR LAYOUT ---
            // Use exact radii from shared constants: INNER_RADIUS=0.3, OUTER_RADIUS=0.9
            
            float numTracks = u_cols;
            
            // Calculate track index with inversion support
            float trackIndex = float(col);
            if (u_invertChannels == 0) { trackIndex = numTracks - 1.0 - trackIndex; }
            
            // Normalized radius for this track (centered in track band)
            float trackWidth = (OUTER_RADIUS - INNER_RADIUS) / numTracks;
            float normalizedRadius = INNER_RADIUS + (trackIndex + 0.5) * trackWidth;
            
            // Full circle angle
            float totalSteps = 64.0;
            float anglePerStep = (2.0 * PI) / totalSteps;
            float theta = -1.570796 + float(row) * anglePerStep;
            
            // Convert polar to cartesian in normalized space [0,1]
            vec2 center = vec2(0.5, 0.5);
            vec2 normPos = center + vec2(cos(theta), sin(theta)) * normalizedRadius * 0.5;
            
            // Calculate btnW and btnH from angular arc length and radial width
            float arcLength = normalizedRadius * anglePerStep;
            float btnW = arcLength * CAP_SCALE_FACTOR;
            float btnH = trackWidth * 0.92;
            
            // Local position with rotation
            vec2 localPos = a_pos * vec2(btnW, btnH);
            float rotAng = theta + 1.570796;
            float cA = cos(rotAng); float sA = sin(rotAng);
            float rotX = localPos.x * cA - localPos.y * sA;
            float rotY = localPos.x * sA + localPos.y * cA;
            
            // Map to pixel space for NDC conversion
            vec2 pixelPos = normPos * u_resolution + vec2(rotX, rotY) * u_resolution;
            
            vec2 ndc = (pixelPos / u_resolution) * 2.0 - 1.0;
            ndc.y = -ndc.y;
            gl_Position = vec4(ndc, 0.0, 1.0);
        }

        // Pass standard UV (0-1) for texture mapping
        v_uv = a_pos + 0.5;
    }
    `;

    // Only compile if using a glass shader
    const isOverlayShader = shaderFile.includes('v0.38') || shaderFile.includes('v0.39') || shaderFile.includes('v0.40') || shaderFile.includes('v0.42') || shaderFile.includes('v0.43') || shaderFile.includes('v0.44') || shaderFile.includes('v0.45') || shaderFile.includes('v0.46');
    if (!isOverlayShader) return;

    const fsSource = `#version 300 es
    precision highp float;

    in vec2 v_uv;
    in float v_active;  // Playhead Hit
    in float v_hasNote; // Note Exists

    uniform sampler2D u_capTexture;

    out vec4 fragColor;

    void main() {
        // Read the "Frosted Glass" texture
        vec4 cap = texture(u_capTexture, v_uv);

        // Base Lighting (Idle)
        // If note exists, glow Blue. If not, invisible.
        vec3 lightColor = vec3(0.0);
        float intensity = 0.0;

        if (v_hasNote > 0.5) {
            // IDLE STATE: Cool Blue Data Glow
            lightColor = vec3(0.0, 0.6, 1.0);
            intensity = 0.8;
        }

        // Active Lighting (Hit)
        vec3 activeColor = vec3(1.0, 0.5, 0.1);
        float activeIntensity = 1.5; // Bloom boost
        lightColor = mix(lightColor, activeColor, v_active);
        intensity = mix(intensity, activeIntensity, v_active);

        // Apply Light to Material
        vec3 finalRGB = cap.rgb * lightColor * intensity;

        // Final Output
        fragColor = vec4(finalRGB, cap.a * 0.9); // 0.9 alpha for translucency

        if (fragColor.a < 0.01) discard;
    }
    `;

    const createShader = (type: number, src: string, name: string) => {
      try {
        const s = gl!.createShader(type)!;
        gl!.shaderSource(s, src);
        gl!.compileShader(s);
        if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS)) {
          const log = gl!.getShaderInfoLog(s);
          console.error(`❌ ${name} Shader Error:`, log);
          gl!.deleteShader(s);
          return null;
        }
        console.log(`✅ ${name} shader compiled`);
        return s;
      } catch (e) {
        console.error(`❌ ${name} shader exception:`, e);
        return null;
      }
    };

    const vs = createShader(gl.VERTEX_SHADER, vsSource, 'Vertex');
    const fs = createShader(gl.FRAGMENT_SHADER, fsSource, 'Fragment');
    if(!vs || !fs) {
      console.error('❌ Shader compilation failed');
      console.groupEnd();
      return;
    }

    let prog: WebGLProgram | null = null;
    try {
      prog = gl.createProgram()!;
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.error("❌ GL Link Error:", gl.getProgramInfoLog(prog));
        console.groupEnd();
        return;
      }
      console.log('✅ Shader program linked');
    } catch (e) {
      console.error('❌ Program linking exception:', e);
      console.groupEnd();
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

    const capTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, capTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const capImg = new Image();
    capImg.onload = () => {
        if (!glCanvasRef.current) return;
        const currentGl = glContextRef.current;
        if (currentGl) {
            currentGl.bindTexture(currentGl.TEXTURE_2D, capTex);
            currentGl.texImage2D(currentGl.TEXTURE_2D, 0, currentGl.RGBA, currentGl.RGBA, currentGl.UNSIGNED_BYTE, capImg);
            console.log('✅ Cap texture loaded');
        }
    };
    capImg.onerror = () => {
        console.warn('⚠️ Failed to load cap texture');
    };
    capImg.src = `./unlit-button.png`;

    try {
      const uniformLocs = {
        u_resolution: gl.getUniformLocation(prog, 'u_resolution'),
        u_cellSize: gl.getUniformLocation(prog, 'u_cellSize'),
        u_offset: gl.getUniformLocation(prog, 'u_offset'),
        u_cols: gl.getUniformLocation(prog, 'u_cols'),
        u_rows: gl.getUniformLocation(prog, 'u_rows'),
        u_playhead: gl.getUniformLocation(prog, 'u_playhead'),
        u_layoutMode: gl.getUniformLocation(prog, 'u_layoutMode'),
        u_invertChannels: gl.getUniformLocation(prog, 'u_invertChannels'),
        u_noteData: gl.getUniformLocation(prog, 'u_noteData'),
        u_capTexture: gl.getUniformLocation(prog, 'u_capTexture'),
      };
      
      // Log shader info for debugging
      console.log(`[WebGL] Shader: ${shaderFile}, Layout: ${getLayoutType(shaderFile)}`);
      
      // Check for null uniforms
      const nullUniforms = Object.entries(uniformLocs)
        .filter(([_, loc]) => loc === null)
        .map(([name, _]) => name);
      if (nullUniforms.length > 0) {
        console.warn(`[WebGL] Missing uniforms in ${shaderFile}:`, nullUniforms);
      }
      
      glResourcesRef.current = {
        program: prog, vao, texture: tex, capTexture: capTex, buffer: buf,
        uniforms: uniformLocs,
      };
      console.log('✅ WebGL resources initialized');
    } catch (e) {
      console.error('❌ Error setting up uniforms:', e);
    }

    console.groupEnd();

    return () => {
      try {
        gl.deleteProgram(prog);
        gl.deleteVertexArray(vao);
        gl.deleteBuffer(buf);
        gl.deleteTexture(tex);
      } catch (e) {
        console.warn('Cleanup error:', e);
      }
    };
  };

  useEffect(() => {
    return initWebGL();
  }, [shaderFile]);

  // Keyboard toggle for debug overlay (press 'D' to toggle)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'd' || e.key === 'D') {
        setDebugInfo(prev => ({ ...prev, visible: !prev.visible }));
        console.log('🔍 Debug overlay:', debugInfo.visible ? 'OFF' : 'ON');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [debugInfo.visible]);

  // === UNIFIED CANVAS RESIZE HANDLING ===
  // This function properly syncs canvas buffer size with CSS display size * devicePixelRatio
  const syncCanvasSize = useCallback((canvas: HTMLCanvasElement, glCanvas: HTMLCanvasElement | null) => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2); // Cap at 2x for performance
    const container = containerRef.current;
    if (!container) return;

    // Get the container's content box size
    const containerRect = container.getBoundingClientRect();
    const containerWidth = containerRect.width;
    const containerHeight = containerRect.height;

    // Calculate target dimensions maintaining aspect ratio
    const aspectRatio = canvasMetrics.width / canvasMetrics.height;
    let displayWidth = containerWidth;
    let displayHeight = containerHeight;

    // Fit within container while preserving aspect ratio
    const containerAspect = containerWidth / containerHeight;
    if (containerAspect > aspectRatio) {
      // Container is wider - constrain by height
      displayWidth = containerHeight * aspectRatio;
    } else {
      // Container is taller - constrain by width
      displayHeight = containerWidth / aspectRatio;
    }

    // Round to avoid sub-pixel rendering issues
    displayWidth = Math.floor(displayWidth);
    displayHeight = Math.floor(displayHeight);

    // Calculate buffer size (display size * DPR)
    const bufferWidth = Math.max(1, Math.floor(displayWidth * dpr));
    const bufferHeight = Math.max(1, Math.floor(displayHeight * dpr));

    // Only update if dimensions changed
    if (canvas.width !== bufferWidth || canvas.height !== bufferHeight) {
      canvas.width = bufferWidth;
      canvas.height = bufferHeight;
      canvasSizeRef.current = { width: bufferWidth, height: bufferHeight, dpr };
      console.log(`🖥️ Canvas resized: ${displayWidth}x${displayHeight} (buffer: ${bufferWidth}x${bufferHeight}, DPR: ${dpr})`);
    }

    // Sync WebGL overlay canvas
    if (glCanvas) {
      if (glCanvas.width !== bufferWidth || glCanvas.height !== bufferHeight) {
        glCanvas.width = bufferWidth;
        glCanvas.height = bufferHeight;
      }
    }
  }, [canvasMetrics]);

  // Debounced resize handler
  const handleResize = useCallback(() => {
    const canvas = canvasRef.current;
    const glCanvas = glCanvasRef.current;
    if (!canvas) return;

    // Debounce to avoid excessive reconfiguration
    if (resizeTimeoutRef.current !== null) {
      window.clearTimeout(resizeTimeoutRef.current);
    }

    resizeTimeoutRef.current = window.setTimeout(() => {
      syncCanvasSize(canvas, glCanvas);
      
      // Reconfigure WebGPU context if available
      if (contextRef.current && deviceRef.current) {
        try {
          contextRef.current.configure({
            device: deviceRef.current,
            format: navigator.gpu.getPreferredCanvasFormat(),
            alphaMode: 'premultiplied'
          });
          console.log('🔄 WebGPU context reconfigured after resize');
        } catch (e) {
          console.error('❌ WebGPU context reconfiguration failed:', e);
        }
      }
      
      resizeTimeoutRef.current = null;
    }, 100); // 100ms debounce
  }, [syncCanvasSize]);

  // Set up ResizeObserver for container
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    // Initial sync
    syncCanvasSize(canvas, glCanvasRef.current);

    // Set up ResizeObserver on the container (not the canvas)
    const resizeObserver = new ResizeObserver(() => {
      // Use requestAnimationFrame to batch resize handling
      requestAnimationFrame(() => {
        handleResize();
      });
    });

    resizeObserver.observe(container);

    // Also listen to window resize for DPR changes
    const handleWindowResize = () => {
      handleResize();
    };
    window.addEventListener('resize', handleWindowResize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleWindowResize);
      if (resizeTimeoutRef.current !== null) {
        window.clearTimeout(resizeTimeoutRef.current);
      }
    };
  }, [handleResize, syncCanvasSize]);

  // === WEBGL2 DATA UPLOAD ===
  useEffect(() => {
    if (!shaderFile.includes('v0.38') && !shaderFile.includes('v0.39') && !shaderFile.includes('v0.40') && !shaderFile.includes('v0.43') && !shaderFile.includes('v0.44') && !shaderFile.includes('v0.45') && !shaderFile.includes('v0.46')) return;

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



  const loadBezelTexture = async (device: GPUDevice) => {
    if (bezelTextureResourcesRef.current) return;
    
    // v0.39 and v0.40 use square bezel, others use round/custom
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
    const textureUrl = shaderFile.includes('v0.30') ? `./unlit-button-2.png` : 'https://test.1ink.us/xm-player/unlit-button.png';
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
        
        // Initial configuration - will be updated by resize handler
        context.configure({ 
          device, 
          format,
          alphaMode: 'premultiplied'
        });

        textureResourcesRef.current = null;
        bezelTextureResourcesRef.current = null;

        const shaderBase = './';
        const shaderSource = await fetch(`${shaderBase}shaders/${shaderFile}`).then(res => res.text());
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
            const backgroundSource = await fetch(`${shaderBase}shaders/${backgroundShaderFile}`).then(res => res.text());
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

        const isHighPrec = shaderFile.includes('v0.36') || shaderFile.includes('v0.37') || shaderFile.includes('v0.38') || shaderFile.includes('v0.39') || shaderFile.includes('v0.40') || shaderFile.includes('v0.43') || shaderFile.includes('v0.44') || shaderFile.includes('v0.45') || shaderFile.includes('v0.46') || shaderFile.includes('v0.48') || shaderFile.includes('v0.49');
        const packFunc = isHighPrec ? packPatternMatrixHighPrecision : packPatternMatrix;
        cellsBufferRef.current = createBufferWithData(device, packFunc(matrix, padTopChannel), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);

        if (layoutType === 'extended') {
          const numRows = matrix?.numRows ?? DEFAULT_ROWS;
          rowFlagsBufferRef.current = createBufferWithData(device, buildRowFlags(numRows), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
          const channelsCount = Math.max(1, matrix?.numChannels ?? DEFAULT_CHANNELS);
          const totalCount = padTopChannel ? channelsCount + 1 : channelsCount;
          const requiredSize = totalCount * 32;
          const buffer = new ArrayBuffer(requiredSize);
          fillChannelStates([], channelsCount, new DataView(buffer), padTopChannel);
          channelsBufferRef.current = createBufferWithData(device, buffer, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
        }

        const needsTexture = layoutType === 'texture' || layoutType === 'extended';
        if (needsTexture) {
          const isVideoShader = shaderFile.includes('v0.20') || shaderFile.includes('v0.23') || shaderFile.includes('v0.24') || shaderFile.includes('v0.25');
          if (isVideoShader) ensureVideoPlaceholder(device); else await ensureButtonTexture(device);
        }

        refreshBindGroup(device);
        
        // Trigger initial resize to set correct canvas dimensions
        const glCanvas = glCanvasRef.current;
        if (canvas && glCanvas) {
          syncCanvasSize(canvas, glCanvas);
        }
        
        setGpuReady(true);
      } catch (error) { console.error('Failed to initialize WebGPU pattern display', error); if (!cancelled) setWebgpuAvailable(false); }
    };
    init();
    return () => {
      cancelled = true; 
      setGpuReady(false);
      
      // Clean up WebGL resources first
      if (glContextRef.current && glResourcesRef.current) {
        const gl = glContextRef.current;
        const res = glResourcesRef.current;
        try {
          gl.deleteProgram(res.program);
          gl.deleteVertexArray(res.vao);
          gl.deleteBuffer(res.buffer);
          gl.deleteTexture(res.texture);
          if (res.capTexture) gl.deleteTexture(res.capTexture);
        } catch (e) {}
        glResourcesRef.current = null;
      }
      
      // Clean up WebGPU resources
      bindGroupRef.current = null; 
      pipelineRef.current = null;
      if (bezelUniformBufferRef.current) { 
        try { bezelUniformBufferRef.current.destroy(); } catch (e) {}
        bezelUniformBufferRef.current = null; 
      }
      bezelBindGroupRef.current = null; 
      bezelPipelineRef.current = null; 
      bezelTextureResourcesRef.current = null;
      if (clickTimeoutRef.current !== null) { 
        window.clearTimeout(clickTimeoutRef.current); 
        clickTimeoutRef.current = null; 
      }
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
      glContextRef.current = null;
    };
  }, [shaderFile, syncCanvasSize]);

  useEffect(() => {
    const device = deviceRef.current;
    if (!device || !gpuReady) return;
    if (cellsBufferRef.current) cellsBufferRef.current.destroy();
    const isHighPrec = shaderFile.includes('v0.36') || shaderFile.includes('v0.37') || shaderFile.includes('v0.38') || shaderFile.includes('v0.39') || shaderFile.includes('v0.40') || shaderFile.includes('v0.43') || shaderFile.includes('v0.44') || shaderFile.includes('v0.45') || shaderFile.includes('v0.46') || shaderFile.includes('v0.48') || shaderFile.includes('v0.49');
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
        const totalCount = padTopChannel ? count + 1 : count;
        const requiredSize = totalCount * 32;

        if (!channelBufferDataRef.current || channelBufferDataRef.current.byteLength < requiredSize) {
            channelBufferDataRef.current = new ArrayBuffer(requiredSize);
            channelDataViewRef.current = new DataView(channelBufferDataRef.current);
        }

        fillChannelStates(channels, count, channelDataViewRef.current!, padTopChannel);

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
  }, [channels, matrix?.numChannels, gpuReady, padTopChannel]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    console.log('handleCanvasClick called');
    if (!shaderFile.includes('v0.37') && !shaderFile.includes('v0.38') && !shaderFile.includes('v0.39') && !shaderFile.includes('v0.40') && !shaderFile.includes('v0.42') && !shaderFile.includes('v0.43') && !shaderFile.includes('v0.44') && !shaderFile.includes('v0.45') && !shaderFile.includes('v0.46')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const pX = (x / rect.width) - 0.5;
    const pY = 0.5 - (y / rect.height); // Invert Y to match shader SDF coord system (up is positive)

    const isV40 = shaderFile.includes('v0.40') || shaderFile.includes('v0.43') || shaderFile.includes('v0.44') || shaderFile.includes('v0.45') || shaderFile.includes('v0.46');

    const flashButton = (buttonId: number) => {
      if (clickTimeoutRef.current !== null) window.clearTimeout(clickTimeoutRef.current);
      setClickedButton(buttonId);
      clickTimeoutRef.current = window.setTimeout(() => { setClickedButton(0); clickTimeoutRef.current = null; }, 200) as number;
    };

    // OPEN Button (Top Right)
    if (Math.abs(pX - 0.26) < 0.05 && Math.abs(pY - 0.42) < 0.05) {
        flashButton(2); // ID 2 = Open
        fileInputRef.current?.click();
        return;
    }

    // LOOP Button (Top Left)
    if (Math.abs(pX + 0.26) < 0.05 && Math.abs(pY - 0.42) < 0.05) {
        flashButton(1);
        onLoopToggle?.();
        return;
    }

    // PREV/NEXT (Below Display)
    if (Math.abs(pY - 0.32) < 0.04) {
        if (Math.abs(pX + 0.12) < 0.04) { // Prev
             flashButton(5);
             if (onSeek) onSeek(Math.max(0, playheadRow - 16)); // Jump back small amount
             return;
        }
        if (Math.abs(pX - 0.12) < 0.04) { // Next
             flashButton(6);
             if (onSeek) onSeek(playheadRow + 16);
             return;
        }
    }
    
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

    const playY = isV40 ? -0.45 : -0.40; // Moved down for v0.40
    const stopY = isV40 ? -0.45 : -0.40; // Moved down for v0.40

    if (dist(pX, pY, -0.44, playY) < btnRadius) { flashButton(3); onPlay?.(); return; }
    if (dist(pX, pY, -0.35, stopY) < btnRadius) { flashButton(4); onStop?.(); return; }
  };

  const drawWebGL = () => {
    const gl = glContextRef.current;
    const res = glResourcesRef.current;
    const isOverlayShader = shaderFile.includes('v0.38') || shaderFile.includes('v0.39') || shaderFile.includes('v0.40') || shaderFile.includes('v0.42') || shaderFile.includes('v0.43') || shaderFile.includes('v0.44') || shaderFile.includes('v0.45') || shaderFile.includes('v0.46');

    if (!gl || !res || !isOverlayShader || !matrix) return;

    const errors: string[] = [];
    const uniformVals: Record<string, number | string> = {};

    try {
      const { program, vao, texture, uniforms } = res;
      const cols = padTopChannel ? (matrix.numChannels || DEFAULT_CHANNELS) + 1 : (matrix.numChannels || DEFAULT_CHANNELS);
      const rows = matrix.numRows || DEFAULT_ROWS;

      // Check for GL errors before starting
      const preError = gl.getError();
      if (preError !== gl.NO_ERROR) {
        errors.push(`Pre-draw GL Error: 0x${preError.toString(16)}`);
      }

      gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      
      gl.useProgram(program);
      gl.bindVertexArray(vao);

      // Upload uniforms with error checking
      // PERFORMANCE OPTIMIZATION: Use live values from ref for smooth animation
      const livePlayheadRow = playbackStateRef?.current?.playheadRow ?? playheadRow;
      
      try {
        gl.uniform2f(uniforms.u_resolution, gl.canvas.width, gl.canvas.height);
        uniformVals['u_resolution'] = `${gl.canvas.width}x${gl.canvas.height}`;
        
        gl.uniform1f(uniforms.u_cols, cols);
        uniformVals['u_cols'] = cols;
        
        gl.uniform1f(uniforms.u_rows, rows);
        uniformVals['u_rows'] = rows;
        
        gl.uniform1f(uniforms.u_playhead, livePlayheadRow);
        uniformVals['u_playhead'] = livePlayheadRow.toFixed(2);
        
        gl.uniform1i(uniforms.u_invertChannels, invertChannels ? 1 : 0);
        uniformVals['u_invertChannels'] = invertChannels ? 1 : 0;
      } catch (e) {
        errors.push(`Uniform upload error: ${e}`);
      }

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(uniforms.u_noteData, 0);

      if (res.capTexture) {
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, res.capTexture);
          gl.uniform1i(uniforms.u_capTexture, 1);
      }

      // Geometry & Layout Configuration using shared constants
      let effectiveCellW = cellWidth;
      let effectiveCellH = cellHeight;
      let layoutMode: LayoutMode = LAYOUT_MODES.CIRCULAR;
      let layoutModeName = 'CIRCULAR';

      // Get layout mode from shader
      layoutMode = getLayoutModeFromShader(shaderFile);

      if (layoutMode === LAYOUT_MODES.HORIZONTAL_32) {
          // Horizontal 32-step
          const metrics = calculateHorizontalCellSize(gl.canvas.width, gl.canvas.height, 32, rows);
          effectiveCellW = metrics.cellW;
          effectiveCellH = metrics.cellH;
          gl.uniform2f(uniforms.u_offset, metrics.offsetX, metrics.offsetY);
          layoutModeName = shaderFile.includes('v0.39') ? '32-STEP (v0.39)' : '32-STEP';
      } else if (layoutMode === LAYOUT_MODES.HORIZONTAL_64) {
          // Horizontal 64-step
          const metrics = calculateHorizontalCellSize(gl.canvas.width, gl.canvas.height, 64, rows);
          effectiveCellW = metrics.cellW;
          effectiveCellH = metrics.cellH;
          gl.uniform2f(uniforms.u_offset, metrics.offsetX, metrics.offsetY);
          layoutModeName = '64-STEP';
      } else {
          // Circular layout
          gl.uniform2f(uniforms.u_offset, 0.0, 0.0);
          layoutModeName = shaderFile.includes('v0.45') ? 'CIRCULAR (v0.45)' : 'CIRCULAR';
      }

      // Calculate cap scale using shared constant formula
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const capScale = calculateCapScale(effectiveCellW, effectiveCellH, pixelRatio);

      gl.uniform2f(uniforms.u_cellSize, effectiveCellW, effectiveCellH);
      gl.uniform1i(uniforms.u_layoutMode, layoutMode);

      uniformVals['u_offset'] = `${(GRID_RECT.x * gl.canvas.width).toFixed(1)}, ${(GRID_RECT.y * gl.canvas.height).toFixed(1)}`;
      uniformVals['u_cellSize'] = `${effectiveCellW.toFixed(1)}, ${effectiveCellH.toFixed(1)}`;
      uniformVals['capScale'] = capScale.toFixed(1);
      uniformVals['pixelRatio'] = pixelRatio;
      uniformVals['GRID_RECT'] = `${GRID_RECT.x.toFixed(3)}, ${GRID_RECT.y.toFixed(3)}, ${GRID_RECT.w.toFixed(3)}, ${GRID_RECT.h.toFixed(3)}`;

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      const stepsForMode = layoutMode === LAYOUT_MODES.HORIZONTAL_32 ? 32 : 
                           layoutMode === LAYOUT_MODES.HORIZONTAL_64 ? 64 : 64;
      const totalInstances = stepsForMode * cols;
      
      uniformVals['totalInstances'] = totalInstances;
      uniformVals['cols'] = cols;
      uniformVals['rows'] = rows;

      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, totalInstances);

      // Check for GL errors after draw
      const postError = gl.getError();
      if (postError !== gl.NO_ERROR) {
        errors.push(`Post-draw GL Error: 0x${postError.toString(16)}`);
      }

      gl.bindVertexArray(null);

      // Update debug info
      setDebugInfo(prev => ({
        ...prev,
        layoutMode: layoutModeName,
        errors,
        uniforms: uniformVals
      }));

      // Console debug output
      console.group(`🔍 PatternDisplay Debug - Mode ${layoutMode}`);
      console.log('Layout:', layoutModeName);
      console.log('GRID_RECT:', GRID_RECT);
      console.log('POLAR_RINGS:', POLAR_RINGS);
      console.log('CAP_CONFIG:', CAP_CONFIG);
      console.log('effectiveCellW/H:', effectiveCellW, effectiveCellH);
      console.log('capScale:', capScale);
      console.log('totalInstances:', totalInstances);
      console.log('Errors:', errors.length > 0 ? errors : 'None');
      console.groupEnd();

    } catch (e) {
      console.error('❌ drawWebGL error:', e);
      errors.push(`Exception: ${e}`);
      setDebugInfo(prev => ({ ...prev, errors }));
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
     const selectedFile = e.target.files?.[0];
     if (selectedFile) onFileSelected?.(selectedFile);
  };

  const render = () => {
    const device = deviceRef.current;
    const context = contextRef.current;
    const pipeline = pipelineRef.current;
    const bindGroup = bindGroupRef.current;
    const canvas = canvasRef.current;
    if (!device || !context || !pipeline || !bindGroup || !uniformBufferRef.current || !cellsBufferRef.current || !canvas) return;

    // Use cached canvas size from resize handler
    const { width: canvasWidth, height: canvasHeight } = canvasSizeRef.current;
    
    // Verify canvas dimensions match our cached values
    if (canvas.width !== canvasWidth || canvas.height !== canvasHeight) {
      // Canvas was resized but our handler hasn't updated yet - skip this frame
      // The resize handler will update on next animation frame
      return;
    }

    if (uniformBufferRef.current) {
      const numRows = matrix?.numRows ?? DEFAULT_ROWS;
      const rawChannels = matrix?.numChannels ?? DEFAULT_CHANNELS;
      const numChannels = padTopChannel ? rawChannels + 1 : rawChannels;
      const rowLimit = Math.max(1, numRows);
      
      // PERFORMANCE OPTIMIZATION: Read from ref for high-frequency values
      // This bypasses React's render cycle for 60fps smooth updates
      const refState = playbackStateRef?.current;
      const livePlayheadRow = refState?.playheadRow ?? playheadRow;
      const liveBeatPhase = refState?.beatPhase ?? beatPhase;
      const liveKickTrigger = refState?.kickTrigger ?? kickTrigger;
      const liveGrooveAmount = refState?.grooveAmount ?? grooveAmount;
      const liveTimeSec = refState?.timeSec ?? timeSec;
      
      const tickRow = clampPlayhead(livePlayheadRow, rowLimit);
      const computedTickOffset = tickRow - Math.floor(tickRow);
      const fractionalTick = Math.min(
        1,
        Math.max(0, Number.isFinite(computedTickOffset) ? computedTickOffset : tickOffset)
      );
      const effectiveTime = isModuleLoaded ? liveTimeSec : localTime;

      // Use ACTUAL canvas dimensions from DOM (not memoized metrics)
      const actualCanvasW = canvas.width;
      const actualCanvasH = canvas.height;

      // v0.39 and v0.40 Override: Ensure uniform payload reflects the auto-calculated dimensions
      let effectiveCellW = cellWidth;
      let effectiveCellH = cellHeight;
      if (shaderFile.includes('v0.21') || shaderFile.includes('v0.40') || shaderFile.includes('v0.43') || shaderFile.includes('v0.44') || shaderFile.includes('v0.45') || shaderFile.includes('v0.46') || shaderFile.includes('v0.47') || shaderFile.includes('v0.48') || shaderFile.includes('v0.49')) {
          effectiveCellW = (GRID_RECT.w * actualCanvasW) / 32.0;
          effectiveCellH = (GRID_RECT.h * actualCanvasH) / numChannels;
      } else if (shaderFile.includes('v0.39')) {
          effectiveCellW = actualCanvasW / 32.0;
          effectiveCellH = actualCanvasH / numChannels;
      }

      const uniformByteLength = fillUniformPayload(layoutTypeRef.current, {
        numRows,
        numChannels,
        playheadRow: tickRow,
        playheadRowAsFloat: shaderFile.includes('v0.40') || shaderFile.includes('v0.42') || shaderFile.includes('v0.43') || shaderFile.includes('v0.44') || shaderFile.includes('v0.45') || shaderFile.includes('v0.46') || shaderFile.includes('v0.47') || shaderFile.includes('v0.48') || shaderFile.includes('v0.49'),
        isPlaying,
        cellW: effectiveCellW,
        cellH: effectiveCellH,
        canvasW: actualCanvasW,
        canvasH: actualCanvasH,
        tickOffset: fractionalTick,
        bpm,
        timeSec: effectiveTime,
        beatPhase: liveBeatPhase,
        groove: Math.min(1, Math.max(0, liveGrooveAmount)),
        kickTrigger: liveKickTrigger,
        activeChannels,
        isModuleLoaded,
        bloomIntensity: bloomIntensity ?? 1.0,
        bloomThreshold: bloomThreshold ?? 0.8,
        invertChannels: invertChannels,
        dimFactor: dimFactor,
        gridRect: GRID_RECT,
      }, uniformUintRef.current, uniformFloatRef.current);
      device.queue.writeBuffer(uniformBufferRef.current, 0, uniformBufferDataRef.current, 0, uniformByteLength);
    }

    if (bezelUniformBufferRef.current) {
      const buf = bezelFloatRef.current;
      // Use actual canvas dimensions
      const actualCanvasW = canvas?.width || canvasMetrics.width;
      const actualCanvasH = canvas?.height || canvasMetrics.height;
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
      buf[14] = dimFactor;
      buf[15] = isPlaying ? 1.0 : 0.0;
      buf[16] = volume;
      buf[17] = pan;
      buf[18] = bpm;
      const uint32View = bezelUintRef.current;
      uint32View[19] = isLooping ? 1 : 0;
      uint32View[20] = 0;
      // Use live playhead from ref for smooth animation
      const livePlayheadRow = playbackStateRef?.current?.playheadRow ?? playheadRow;
      buf[21] = livePlayheadRow;
      uint32View[22] = clickedButton;
      device.queue.writeBuffer(bezelUniformBufferRef.current, 0, bezelBufferDataRef.current, 0, 96); // Float32Array(24) = 96 bytes
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



    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          loadOp: 'clear',
          clearValue: { r: 0, g: 0, b: 0, a: 1 }, // Changed from 0.98 for cleaner composite
          storeOp: 'store',
      }],
    });

    // Render background pass for all shaders that are not self-compositing
    const needsBackground = !isSinglePassCompositeShader(shaderFile);
    if (bezelPipelineRef.current && bezelBindGroupRef.current && needsBackground && bezelUniformBufferRef.current) {
      const bezelData = new Float32Array(24);
      bezelData[0] = canvasMetrics.width;
      bezelData[1] = canvasMetrics.height;
      bezelData[2] = 0; // bezelWidth
      // Colors (using defaults from shader constants or params)
      bezelData[3] = 0.92; bezelData[4] = 0.93; bezelData[5] = 0.95; // surface
      bezelData[6] = 0.88; bezelData[7] = 0.89; bezelData[8] = 0.91; // bezel
      bezelData[9] = 0.015; // screwRadius
      bezelData[10] = 0; // recessKind
      bezelData[11] = 1.0; // recessOuterScale
      bezelData[12] = 1.0; // recessInnerScale
      bezelData[13] = 0.02; // recessCorner
      bezelData[14] = dimFactor ?? 1.0;
      bezelData[15] = isPlaying ? 1.0 : 0.0;
      bezelData[16] = 1.0; // volume
      bezelData[17] = 0.5; // pan
      bezelData[18] = bpm ?? 120.0;
      const bezelUint = new Uint32Array(bezelData.buffer);
      bezelUint[19] = isLooping ? 1 : 0;
      bezelUint[20] = 0; // currentOrder (could pass if needed)
      bezelUint[21] = Math.floor(playheadRow);
      bezelUint[22] = 0; // clickedButton
      // gridRect at index 20 (offset 80 in bytes, but Float32 index 20)
      bezelData[20] = GRID_RECT.x;
      bezelData[21] = GRID_RECT.y;
      bezelData[22] = GRID_RECT.w;
      bezelData[23] = GRID_RECT.h;
      
      device.queue.writeBuffer(bezelUniformBufferRef.current, 0, bezelData);

      pass.setPipeline(bezelPipelineRef.current);
      pass.setBindGroup(0, bezelBindGroupRef.current);
      pass.draw(6, 1, 0, 0);
    }

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    const numRows = matrix?.numRows ?? DEFAULT_ROWS;
    const rawChannels = matrix?.numChannels ?? DEFAULT_CHANNELS;
    const numChannels = padTopChannel ? rawChannels + 1 : rawChannels;
    let totalInstances = numRows * numChannels;

    // Increment instance count for UI-capable shaders
    const isUIShader = shaderFile.includes('v0.45');
    if (isUIShader) {
      totalInstances += 3; // UI_BUTTON_COUNT in shader
    }

    if (totalInstances > 0) {
      if (isSinglePassCompositeShader(shaderFile)) {
        if (shaderFile.includes('v0.45')) {
             pass.draw(6, totalInstances, 0, 0); // All instances in one draw
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
    drawWebGL();
  };

  // Keep a ref to the latest render function to avoid stale closures in the loop
  useEffect(() => {
    renderRef.current = render;
  });

  useEffect(() => {
    let isActive = true;
    const loop = (time: number) => {
      if (!isActive) return;
      animationFrameRef.current = requestAnimationFrame(loop);

      // Update local time if module is not playing/loaded, for idle animations
      if (!isModuleLoaded && !isPlaying) {
        setLocalTime(time / 1000.0);
      }

      if (analyserNode) {
         if (freqDataRef.current.length !== analyserNode.frequencyBinCount) {
             freqDataRef.current = new Uint8Array(analyserNode.frequencyBinCount);
         }
         analyserNode.getByteFrequencyData(freqDataRef.current);
      }

      if (renderRef.current && gpuReady) {
        renderRef.current();
      }
    };

    animationFrameRef.current = requestAnimationFrame(loop);

    return () => {
      isActive = false;
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isModuleLoaded, isPlaying, gpuReady]);

  return (
    <div 
      ref={containerRef}
      className={`pattern-display relative ${padTopChannel && !shaderFile.includes('v0.40') && !shaderFile.includes('v0.43') && !shaderFile.includes('v0.44') ? 'p-8 rounded-xl bg-[#18181a] shadow-2xl border border-[#333]' : ''}`}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
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
            {invertChannels ? "[INNER LOW]" : "[OUTER LOW]"}
        </button>
      )}

      <canvas
        ref={canvasRef}
        width={canvasMetrics.width}
        height={canvasMetrics.height}
        onClick={handleCanvasClick}
        className={`${padTopChannel && !shaderFile.includes('v0.40') && !shaderFile.includes('v0.43') && !shaderFile.includes('v0.44') ? 'rounded bg-black shadow-inner border border-black/50' : ''} cursor-pointer`}
        style={{
          // CSS display size - will be controlled by container
          width: 'auto',
          height: 'auto',
          maxWidth: '100%',
          maxHeight: '100%',
          // Maintain aspect ratio
          aspectRatio: `${canvasMetrics.width} / ${canvasMetrics.height}`,
          objectFit: 'contain',
          position: 'relative',
        }}
      />
      <canvas
          ref={glCanvasRef}
          width={canvasMetrics.width}
          height={canvasMetrics.height}
          className="absolute top-0 left-0 pointer-events-none"
          style={{
            width: 'auto',
            height: 'auto',
            maxWidth: '100%',
            maxHeight: '100%',
            aspectRatio: `${canvasMetrics.width} / ${canvasMetrics.height}`,
            objectFit: 'contain',
            zIndex: 2,
            // Center the overlay canvas
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
          }}
      />
      


      {!webgpuAvailable && <div className="error">WebGPU not available in this browser.</div>}
      
      {/* Debug Overlay Panel */}
      {debugInfo.visible && (
        <div 
          className="fixed top-4 right-4 bg-black/90 border border-green-500/50 rounded p-3 text-xs font-mono z-50 max-w-xs"
          style={{ backdropFilter: 'blur(4px)' }}
        >
          <div className="flex justify-between items-center mb-2">
            <span className="text-green-400 font-bold">🔍 PatternDisplay Debug</span>
            <button 
              onClick={() => setDebugInfo(prev => ({ ...prev, visible: false }))}
              className="text-gray-500 hover:text-white"
            >
              ✕
            </button>
          </div>
          
          <div className="mb-2">
            <span className="text-gray-400">Mode:</span>
            <span className={`ml-2 font-bold ${
              debugInfo.layoutMode.includes('32') ? 'text-blue-400' : 
              debugInfo.layoutMode.includes('64') ? 'text-purple-400' : 'text-orange-400'
            }`}>
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
          
          <div className="text-[9px] text-gray-600 mt-2 pt-1 border-t border-gray-800">
            Press 'D' to toggle
          </div>
        </div>
      )}
    </div>
  );
};
