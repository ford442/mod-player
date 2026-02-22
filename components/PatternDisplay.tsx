import React, { useEffect, useRef, useState, useMemo } from 'react';
import { ChannelShadowState, PatternMatrix } from '../types';

const DEFAULT_ROWS = 64;
const DEFAULT_CHANNELS = 4;

// Bezel inset for v0.40/v0.43 shaders - exact square bezel bounds
const BEZEL_INSET = { x: 160, y: 160, w: 705, h: 725 };
// Normalized grid rect for shader (x, y, w, h)
const GRID_RECT = {
  x: BEZEL_INSET.x / 1024,
  y: BEZEL_INSET.y / 1024,
  w: BEZEL_INSET.w / 1024,
  h: BEZEL_INSET.h / 1024
};
const EMPTY_CHANNEL: ChannelShadowState = {
  
  volume: 1.0, pan: 0.5, freq: 440, trigger: 0, noteAge: 1000,
  activeEffect: 0, effectValue: 0, isMuted: 0
};
const PLAYHEAD_EPSILON = 0.0001;
const alignTo = (val: number, align: number) => Math.floor((val + align - 1) / align) * align;

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
  if (shaderFile.includes('v0.21') || shaderFile.includes('v0.40') || shaderFile.includes('v0.42') || shaderFile.includes('v0.43') || shaderFile.includes('v0.44') || shaderFile.includes('v0.45') || shaderFile.includes('v0.46') || shaderFile.includes('v0.47') || shaderFile.includes('v0.48') || shaderFile.includes('v0.49')) return 'chassis_frosted.wgsl';
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
    // gridRect for bezel alignment (v0.40/v0.43+)
    const gridRect = params.gridRect ?? GRID_RECT;
    float[20] = gridRect.x;
    float[21] = gridRect.y;
    float[22] = gridRect.w;
    float[23] = gridRect.h;
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
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [webgpuAvailable, setWebgpuAvailable] = useState(true);
  const [localTime, setLocalTime] = useState(0);
  const [invertChannels, setInvertChannels] = useState(false);
  const [clickedButton, setClickedButton] = useState<number>(0);
  const [gpuReady, setGpuReady] = useState(false);

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
    if (shaderFile.includes('v0.21') || shaderFile.includes('v0.37') || shaderFile.includes('v0.38') || shaderFile.includes('v0.39') || shaderFile.includes('v0.40') || shaderFile.includes('v0.42') || shaderFile.includes('v0.43') || shaderFile.includes('v0.44') || shaderFile.includes('v0.45') || shaderFile.includes('v0.46')) return { width: 1024, height: 1024 };

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
    if (!glCanvasRef.current) return;
    const gl = glCanvasRef.current.getContext('webgl2', { alpha: true, premultipliedAlpha: false });
    if (!gl) return;
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
    uniform float u_playhead;
    uniform int u_invertChannels;
    uniform int u_layoutMode; // 1=Circ, 2=Horiz32, 3=Horiz64
    uniform highp usampler2D u_noteData;

    const float PI = 3.14159265359;

    void main() {
        int id = gl_InstanceID;
        int col = id % int(u_cols); // Track Index
        int row = id / int(u_cols); // Step Index

        // 1. Check for Note Data
        uint note = texelFetch(u_noteData, ivec2(col, row), 0).r;
        v_hasNote = (note > 0u) ? 1.0 : 0.0;

        // 2. Calculate Scale/Size
        float scale = (note > 0u) ? 0.92 : 0.0; // Hide empty steps, shrink valid ones slightly for gap

        // 3. Playhead Logic
        float stepsPerPage = (u_layoutMode == 3) ? 64.0 : 32.0;
        float relativePlayhead = mod(u_playhead, stepsPerPage);

        float distToPlayhead = abs(float(row) - relativePlayhead);
        distToPlayhead = min(distToPlayhead, stepsPerPage - distToPlayhead);
        float activation = 1.0 - smoothstep(0.0, 1.5, distToPlayhead);
        scale *= 1.0 + (0.15 * activation); // Pop effect with smooth falloff
        v_active = activation;

        // 4. Positioning Logic
        if (u_layoutMode == 2 || u_layoutMode == 3) {
            float xPos = float(row) * u_cellSize.x;
            float yPos = float(col) * u_cellSize.y;

            vec2 center = vec2(xPos, yPos) + u_cellSize * 0.5 + u_offset;
            // Use standard quad positions (-0.5 to 0.5)
            vec2 pos = center + (a_pos * u_cellSize * scale);

            vec2 ndc = (pos / u_resolution) * 2.0 - 1.0;
            ndc.y = -ndc.y;
            gl_Position = vec4(ndc, 0.0, 1.0);

        } else {
            int ringIndex = col;
            if (u_invertChannels == 0) { ringIndex = int(u_cols) - 1 - col; }

            vec2 center = u_resolution * 0.5;
            float minDim = min(u_resolution.x, u_resolution.y);
            float maxRadius = minDim * 0.45;
            float minRadius = minDim * 0.15;
            float ringDepth = (maxRadius - minRadius) / u_cols;
            float radius = minRadius + float(ringIndex) * ringDepth;

            float totalSteps = 64.0;
            float anglePerStep = (2.0 * PI) / totalSteps;
            float theta = -1.570796 + float(row) * anglePerStep;

            float circumference = 2.0 * PI * radius;
            float arcLength = circumference / totalSteps;
            float btnW = arcLength * 0.95;
            float btnH = ringDepth * 0.95;

            vec2 localPos = a_pos * vec2(btnW, btnH) * scale;

            // Rotate
            float rotAng = theta + 1.570796;
            float cA = cos(rotAng); float sA = sin(rotAng);
            float rotX = localPos.x * cA - localPos.y * sA;
            float rotY = localPos.x * sA + localPos.y * cA;

            float worldX = center.x + cos(theta) * radius + rotX;
            float worldY = center.y + sin(theta) * radius + rotY;

            vec2 ndc = vec2((worldX / u_resolution.x) * 2.0 - 1.0, 1.0 - (worldY / u_resolution.y) * 2.0);
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
        }
    };
    capImg.src = 'unlit-button.png';

        glResourcesRef.current = {
      program: prog, vao, texture: tex, capTexture: capTex, buffer: buf,
      uniforms: {
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
      }
    };

    return () => {
      gl.deleteProgram(prog);
      gl.deleteVertexArray(vao);
      gl.deleteBuffer(buf);
      gl.deleteTexture(tex);
    };
  };

  useEffect(() => {
    return initWebGL();
  }, [shaderFile]);

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
    const textureName = (shaderFile.includes('v0.39') || shaderFile.includes('v0.40') || shaderFile.includes('v0.43') || shaderFile.includes('v0.44')) ? 'bezel-square.png' : 'bezel.png';

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

        const uniformSize = layoutType === 'extended' ? 96 : (layoutType === 'texture' ? 64 : 32);
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

    const { program, vao, texture, uniforms } = res;
    const { width, height } = canvasMetrics;
    const cols = padTopChannel ? (matrix.numChannels || DEFAULT_CHANNELS) + 1 : (matrix.numChannels || DEFAULT_CHANNELS);
    const rows = matrix.numRows || DEFAULT_ROWS;

    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    
    gl.useProgram(program);
    gl.bindVertexArray(vao);

    gl.uniform2f(uniforms.u_resolution, width, height);
    gl.uniform1f(uniforms.u_cols, cols);
    gl.uniform1f(uniforms.u_rows, rows);
    gl.uniform1f(uniforms.u_playhead, playheadRow);
    gl.uniform1i(uniforms.u_invertChannels, invertChannels ? 1 : 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1i(uniforms.u_noteData, 0);

    if (res.capTexture) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, res.capTexture);
        gl.uniform1i(uniforms.u_capTexture, 1);
    }

    // Geometry & Layout Configuration
    let effectiveCellW = cellWidth;
    let effectiveCellH = cellHeight;
    let layoutMode = 1; // Default Circular

    if (shaderFile.includes('v0.40') || shaderFile.includes('v0.43') || shaderFile.includes('v0.46')) {
        // Horizontal 32
        effectiveCellW = 705.0 / 32.0;
        effectiveCellH = 725.0 / cols;
        gl.uniform2f(uniforms.u_offset, 160.0, 160.0);
        layoutMode = 2;
    } else if (shaderFile.includes('v0.44')) {
        // Horizontal 64
        effectiveCellW = 705.0 / 64.0;
        effectiveCellH = 725.0 / cols;
        gl.uniform2f(uniforms.u_offset, 160.0, 160.0);
        layoutMode = 3;
    } else if (shaderFile.includes('v0.39')) {
        // Full Screen Horizontal
        effectiveCellW = canvasMetrics.width / 32.0;
        effectiveCellH = canvasMetrics.height / cols;
        gl.uniform2f(uniforms.u_offset, 0.0, 0.0);
        layoutMode = 2;
    } else if (shaderFile.includes('v0.45')) {
        // Circular with UI
        gl.uniform2f(uniforms.u_offset, 0.0, 0.0);
        layoutMode = 1;
    } else {
        // Default Circular
        gl.uniform2f(uniforms.u_offset, 0.0, 0.0);
        layoutMode = 1;
    }

    gl.uniform2f(uniforms.u_cellSize, effectiveCellW, effectiveCellH);
    gl.uniform1i(uniforms.u_layoutMode, layoutMode);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const totalInstances = rows * cols;
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, totalInstances);

    gl.bindVertexArray(null);
  }

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
      const computedTickOffset = tickRow - Math.floor(tickRow);
      const fractionalTick = Math.min(
        1,
        Math.max(0, Number.isFinite(computedTickOffset) ? computedTickOffset : tickOffset)
      );
      const effectiveTime = isModuleLoaded ? timeSec : localTime;

      // v0.39 and v0.40 Override: Ensure uniform payload reflects the auto-calculated dimensions
      let effectiveCellW = cellWidth;
      let effectiveCellH = cellHeight;
      if (shaderFile.includes('v0.21') || shaderFile.includes('v0.40') || shaderFile.includes('v0.43') || shaderFile.includes('v0.44') || shaderFile.includes('v0.45') || shaderFile.includes('v0.46') || shaderFile.includes('v0.47') || shaderFile.includes('v0.48') || shaderFile.includes('v0.49')) {
          effectiveCellW = 705.0 / 32.0;
          effectiveCellH = 725.0 / numChannels;
      } else if (shaderFile.includes('v0.39')) {
          effectiveCellW = canvasMetrics.width / 32.0;
          effectiveCellH = canvasMetrics.height / numChannels; // Approx
      }

      const uniformByteLength = fillUniformPayload(layoutTypeRef.current, {
        numRows,
        numChannels,
        playheadRow: tickRow,
        playheadRowAsFloat: shaderFile.includes('v0.42') || shaderFile.includes('v0.43') || shaderFile.includes('v0.44') || shaderFile.includes('v0.45') || shaderFile.includes('v0.46') || shaderFile.includes('v0.47') || shaderFile.includes('v0.48') || shaderFile.includes('v0.49'),
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
        gridRect: GRID_RECT,
      }, uniformUintRef.current, uniformFloatRef.current);
      device.queue.writeBuffer(uniformBufferRef.current, 0, uniformBufferDataRef.current, 0, uniformByteLength);
    }

    if (bezelUniformBufferRef.current) {
      const buf = bezelFloatRef.current;
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
      const uint32View = bezelUintRef.current;
      uint32View[19] = isLooping ? 1 : 0;
      uint32View[20] = 0;
      buf[21] = playheadRow;
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
          clearValue: { r: 0.98, g: 0.98, b: 0.98, a: 1 },
          storeOp: 'store',
      }],
    });

    // v0.45, v0.46, v0.47, v0.48, v0.49 need background pass since they only render UI strip
    const needsBackground = !isSinglePassCompositeShader(shaderFile) || shaderFile.includes('v0.45') || shaderFile.includes('v0.46') || shaderFile.includes('v0.47') || shaderFile.includes('v0.48') || shaderFile.includes('v0.49');
    if (bezelPipelineRef.current && bezelBindGroupRef.current && needsBackground) {
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
    const loop = (time: number) => {
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

      if (renderRef.current) {

        renderRef.current();
      }
    };

    animationFrameRef.current = requestAnimationFrame(loop);

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isModuleLoaded, isPlaying]);

  return (
    <div className={`pattern-display relative ${padTopChannel && !shaderFile.includes('v0.40') && !shaderFile.includes('v0.43') && !shaderFile.includes('v0.44') ? 'p-8 rounded-xl bg-[#18181a] shadow-2xl border border-[#333]' : ''}`}>
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
          maxWidth: '100%',
          maxHeight: '100%',
          width: 'auto',
          height: 'auto',
          objectFit: 'contain',
          aspectRatio: `${canvasMetrics.width} / ${canvasMetrics.height}`,
          position: 'relative',
          
        }}
      />
      <canvas
          ref={glCanvasRef}
          width={canvasMetrics.width}
          height={canvasMetrics.height}
          className="absolute top-0 left-0"
          style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              aspectRatio: `${canvasMetrics.width} / ${canvasMetrics.height}`,
              zIndex: 2,
              pointerEvents: 'none',
          }}
      />
      


      {!webgpuAvailable && <div className="error">WebGPU not available in this browser.</div>}
    </div>
  );
};
