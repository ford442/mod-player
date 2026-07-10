/**
 * Shader registry — **single source of truth** for per-shader capabilities.
 *
 * Adding a new shader requires:
 *   1. The WGSL file under shaders/ (+ public/shaders via sync)
 *   2. One block in SHADER_REGISTRY below
 *   3. An entry in appConfig.ts SHADER_GROUPS (UI picker)
 *
 * Do **not** add `shaderFile.includes('v0.XX')` chains in PatternDisplay,
 * useWebGPURender, or related files. Read capabilities via getShaderMeta /
 * resolveShaderMeta / helpers in shaderVersion.ts.
 *
 * Field reference
 * ───────────────
 * extendedLayout      – 2×u32 per cell (v0.13+); false = standard 1×u32
 * circular            – polar/ring layout
 * layoutMode          – LAYOUT_MODES consumer ('circular' | 'horizontal_32')
 * background          – chassis/bezel WGSL for background pass
 * alphaBlending       – WebGPU pipeline premultiplied alpha
 * webglHybrid         – WebGL frosted overlay on WebGPU chassis
 * singlePassComposite – chassis filename if shader owns background, else false
 * supportsStepsLength – slot [24] is stepsLength:u32 (not colorPalette)
 * bloomProfile        – BLOOM_PROFILES id or null
 * liteRecommended     – preferred on mobile / ?lite=1
 * padTopChannel       – reserve channel 0 as header/pad for packing
 * canvasSize          – logical render size (before DPR)
 * hitTestProfile      – embedded transport hit-testing layout
 * oscilloscope        – binding 6 oscilloscope texture (v0.55)
 * instrumentPalette   – binding 7 palette texture (v0.52–54, v0.56)
 * highPrecisionPacking– PackedA/PackedB + DURA/TRIG packing
 * playheadRowAsFloat  – uniform slot [2] is f32 (not u32)
 * strictPlayheadSustain – playhead-scrolled sustain (v0.45b / v0.30b)
 * bezelTexture        – chassis bezel image variant
 * patternTexture      – main pattern bind texture kind
 * bareCanvasChrome    – no outer metal frame CSS chrome
 * showChannelInvertButton – HTML invert toggle overlay
 * circularRowPaging   – page rows by numRows (v0.46 overlay parity)
 * polarOuterRadiusFactor – ring outer radius × minDim
 * stepsDrivenVisibleRows – cap visible rows with stepsLength (v0.50+)
 * cellSizeMode        – how to compute cellW/cellH for uniforms
 * uiExtraInstances    – extra draw instances (embedded UI quads)
 * nightModeBezel      – v0.35 night-mode bezel color path
 * chassisControlEncoding – frosted f32 vs chassisv0.37 u32 control slots
 */

export type HitTestProfile = 'none' | 'polar-ui' | 'square-ui';
export type BezelTextureKind = 'round' | 'square' | 'none';
export type PatternTextureKind = 'button' | 'button-v30' | 'video' | 'none';
export type CellSizeMode = 'props' | 'gridRect' | 'fullCanvas';
export type ChassisControlEncoding = 'none' | 'frosted-f32' | 'chassis37-u32';

export interface CanvasSizeSpec {
  width: number;
  height: number;
}

export interface ShaderMeta {
  extendedLayout: boolean;
  circular: boolean;
  /** Matches LAYOUT_MODES in geometryConstants.ts */
  layoutMode: 'circular' | 'horizontal_32';
  background: string;
  alphaBlending: boolean;
  webglHybrid: boolean;
  singlePassComposite: string | false;
  supportsStepsLength: boolean;
  /** Bloom post-process profile id, or null to use BloomPostProcessor default. */
  bloomProfile: string | null;
  /** Recommended for lite/mobile mode — simple layout, low GPU cost. */
  liteRecommended?: boolean;

  // ── Capabilities previously inferred via includes() ────────────────
  padTopChannel: boolean;
  canvasSize: CanvasSizeSpec;
  hitTestProfile: HitTestProfile;
  oscilloscope: boolean;
  instrumentPalette: boolean;
  highPrecisionPacking: boolean;
  playheadRowAsFloat: boolean;
  strictPlayheadSustain: boolean;
  bezelTexture: BezelTextureKind;
  patternTexture: PatternTextureKind;
  bareCanvasChrome: boolean;
  showChannelInvertButton: boolean;
  circularRowPaging: boolean;
  polarOuterRadiusFactor: number;
  stepsDrivenVisibleRows: boolean;
  cellSizeMode: CellSizeMode;
  uiExtraInstances: number;
  nightModeBezel: boolean;
  chassisControlEncoding: ChassisControlEncoding;
}

/** Default outer ring factor (matches POLAR_RINGS.OUTER_RADIUS). */
export const DEFAULT_POLAR_OUTER = 0.45;
/** v0.45 (non-b) shrinks outer ring for embedded UI. */
export const POLAR_OUTER_V045 = 0.40;

const SIZE_1024: CanvasSizeSpec = { width: 1024, height: 1024 };

/** Shared circular LED defaults (v0.45–v0.57 family). */
function circularLed(overrides: Partial<ShaderMeta> = {}): ShaderMeta {
  return {
    extendedLayout: true,
    circular: true,
    layoutMode: 'circular',
    background: 'bezel.wgsl',
    alphaBlending: true,
    webglHybrid: false,
    singlePassComposite: false,
    supportsStepsLength: false,
    bloomProfile: 'circular-led',
    padTopChannel: true,
    canvasSize: SIZE_1024,
    hitTestProfile: 'none',
    oscilloscope: false,
    instrumentPalette: false,
    highPrecisionPacking: true,
    playheadRowAsFloat: true,
    strictPlayheadSustain: false,
    bezelTexture: 'round',
    patternTexture: 'button',
    bareCanvasChrome: false,
    showChannelInvertButton: false,
    circularRowPaging: false,
    polarOuterRadiusFactor: DEFAULT_POLAR_OUTER,
    stepsDrivenVisibleRows: false,
    cellSizeMode: 'gridRect',
    uiExtraInstances: 0,
    nightModeBezel: false,
    chassisControlEncoding: 'none',
    ...overrides,
  };
}

function horizontalPanel(overrides: Partial<ShaderMeta> = {}): ShaderMeta {
  return {
    extendedLayout: true,
    circular: false,
    layoutMode: 'horizontal_32',
    background: 'chassis_frosted.wgsl',
    alphaBlending: true,
    webglHybrid: false,
    singlePassComposite: 'chassis_frosted.wgsl',
    supportsStepsLength: false,
    bloomProfile: null,
    padTopChannel: true,
    canvasSize: SIZE_1024,
    hitTestProfile: 'none',
    oscilloscope: false,
    instrumentPalette: false,
    highPrecisionPacking: true,
    playheadRowAsFloat: true,
    strictPlayheadSustain: false,
    bezelTexture: 'square',
    patternTexture: 'button',
    bareCanvasChrome: true,
    showChannelInvertButton: false,
    circularRowPaging: false,
    polarOuterRadiusFactor: DEFAULT_POLAR_OUTER,
    stepsDrivenVisibleRows: false,
    cellSizeMode: 'gridRect',
    uiExtraInstances: 0,
    nightModeBezel: false,
    chassisControlEncoding: 'frosted-f32',
    ...overrides,
  };
}

export const SHADER_REGISTRY: Readonly<Record<string, ShaderMeta>> = {
  // ── Legacy / standard layout ─────────────────────────────────────────────
  'patternv0.21.wgsl': horizontalPanel({
    alphaBlending: false,
    webglHybrid: true,
    singlePassComposite: 'chassis_frosted.wgsl',
    supportsStepsLength: true,
    highPrecisionPacking: false,
    bareCanvasChrome: false,
    liteRecommended: true,
  }),
  'patternv0.23.wgsl': {
    extendedLayout: true,
    circular: false,
    layoutMode: 'circular',
    background: 'chassis_video.wgsl',
    alphaBlending: false,
    webglHybrid: false,
    singlePassComposite: false,
    supportsStepsLength: false,
    bloomProfile: null,
    padTopChannel: false,
    canvasSize: SIZE_1024,
    hitTestProfile: 'none',
    oscilloscope: false,
    instrumentPalette: false,
    highPrecisionPacking: false,
    playheadRowAsFloat: true,
    strictPlayheadSustain: false,
    bezelTexture: 'none',
    patternTexture: 'video',
    bareCanvasChrome: false,
    showChannelInvertButton: false,
    circularRowPaging: false,
    polarOuterRadiusFactor: DEFAULT_POLAR_OUTER,
    stepsDrivenVisibleRows: false,
    cellSizeMode: 'props',
    uiExtraInstances: 0,
    nightModeBezel: false,
    chassisControlEncoding: 'none',
  },
  'patternv0.24.wgsl': {
    extendedLayout: true,
    circular: false,
    layoutMode: 'circular',
    background: 'chassis_video.wgsl',
    alphaBlending: false,
    webglHybrid: false,
    singlePassComposite: false,
    supportsStepsLength: false,
    bloomProfile: null,
    padTopChannel: false,
    canvasSize: SIZE_1024,
    hitTestProfile: 'none',
    oscilloscope: false,
    instrumentPalette: false,
    highPrecisionPacking: false,
    playheadRowAsFloat: true,
    strictPlayheadSustain: false,
    bezelTexture: 'none',
    patternTexture: 'video',
    bareCanvasChrome: false,
    showChannelInvertButton: false,
    circularRowPaging: false,
    polarOuterRadiusFactor: DEFAULT_POLAR_OUTER,
    stepsDrivenVisibleRows: false,
    cellSizeMode: 'props',
    uiExtraInstances: 0,
    nightModeBezel: false,
    chassisControlEncoding: 'none',
  },
  'patternv0.30.wgsl': {
    extendedLayout: true,
    circular: false,
    layoutMode: 'circular',
    background: 'chassisv0.1.wgsl',
    alphaBlending: false,
    webglHybrid: false,
    singlePassComposite: false,
    supportsStepsLength: false,
    bloomProfile: null,
    padTopChannel: false,
    canvasSize: SIZE_1024,
    hitTestProfile: 'none',
    oscilloscope: false,
    instrumentPalette: false,
    highPrecisionPacking: false,
    playheadRowAsFloat: true,
    strictPlayheadSustain: false,
    bezelTexture: 'round',
    patternTexture: 'button-v30',
    bareCanvasChrome: false,
    showChannelInvertButton: false,
    circularRowPaging: false,
    polarOuterRadiusFactor: DEFAULT_POLAR_OUTER,
    stepsDrivenVisibleRows: false,
    cellSizeMode: 'props',
    uiExtraInstances: 0,
    nightModeBezel: false,
    chassisControlEncoding: 'none',
  },
  'patternv0.30b.wgsl': {
    extendedLayout: true,
    circular: false,
    layoutMode: 'circular',
    background: 'chassisv0.1.wgsl',
    alphaBlending: false,
    webglHybrid: false,
    singlePassComposite: false,
    supportsStepsLength: false,
    bloomProfile: null,
    padTopChannel: false,
    canvasSize: SIZE_1024,
    hitTestProfile: 'none',
    oscilloscope: false,
    instrumentPalette: false,
    highPrecisionPacking: true,
    playheadRowAsFloat: true,
    strictPlayheadSustain: true,
    bezelTexture: 'round',
    patternTexture: 'button-v30',
    bareCanvasChrome: false,
    showChannelInvertButton: false,
    circularRowPaging: false,
    polarOuterRadiusFactor: DEFAULT_POLAR_OUTER,
    stepsDrivenVisibleRows: false,
    cellSizeMode: 'props',
    uiExtraInstances: 0,
    nightModeBezel: false,
    chassisControlEncoding: 'none',
  },
  'patternv0.35_bloom.wgsl': {
    extendedLayout: true,
    circular: true,
    layoutMode: 'circular',
    background: 'chassisv0.1.wgsl',
    alphaBlending: true,
    webglHybrid: false,
    singlePassComposite: false,
    supportsStepsLength: false,
    bloomProfile: null,
    padTopChannel: false,
    canvasSize: SIZE_1024,
    hitTestProfile: 'none',
    oscilloscope: false,
    instrumentPalette: false,
    highPrecisionPacking: false,
    playheadRowAsFloat: true,
    strictPlayheadSustain: false,
    bezelTexture: 'round',
    patternTexture: 'button',
    bareCanvasChrome: false,
    showChannelInvertButton: true,
    circularRowPaging: false,
    polarOuterRadiusFactor: DEFAULT_POLAR_OUTER,
    stepsDrivenVisibleRows: false,
    cellSizeMode: 'props',
    uiExtraInstances: 0,
    nightModeBezel: true,
    chassisControlEncoding: 'none',
  },

  // ── v0.37 family — circular with v0.37 chassis ───────────────────────────
  'patternv0.37.wgsl': circularLed({
    background: 'chassisv0.37.wgsl',
    alphaBlending: false,
    bloomProfile: null,
    highPrecisionPacking: true,
    hitTestProfile: 'polar-ui',
    padTopChannel: false,
    cellSizeMode: 'props',
    chassisControlEncoding: 'chassis37-u32',
  }),
  'patternv0.38.wgsl': circularLed({
    background: 'chassisv0.37.wgsl',
    webglHybrid: true,
    bloomProfile: null,
    hitTestProfile: 'polar-ui',
    chassisControlEncoding: 'chassis37-u32',
    showChannelInvertButton: true,
  }),

  // ── v0.39/v0.40 — horizontal with frosted chassis ─────────────────────────
  'patternv0.39.wgsl': horizontalPanel({
    background: 'chassisv0.37.wgsl',
    alphaBlending: false,
    webglHybrid: true,
    singlePassComposite: false,
    supportsStepsLength: true,
    hitTestProfile: 'polar-ui',
    bareCanvasChrome: false,
    showChannelInvertButton: true,
    cellSizeMode: 'fullCanvas',
    chassisControlEncoding: 'chassis37-u32',
  }),
  'patternv0.40.wgsl': horizontalPanel({
    webglHybrid: true,
    supportsStepsLength: true,
    hitTestProfile: 'square-ui',
    bareCanvasChrome: true,
    showChannelInvertButton: true,
  }),

  // ── v0.42 — circular, single-pass frosted ────────────────────────────────
  'patternv0.42.wgsl': circularLed({
    background: 'chassis_frosted.wgsl',
    webglHybrid: true,
    singlePassComposite: 'chassis_frosted.wgsl',
    hitTestProfile: 'polar-ui',
    chassisControlEncoding: 'frosted-f32',
  }),

  // ── v0.43/v0.44 — horizontal, single-pass frosted ────────────────────────
  'patternv0.43.wgsl': horizontalPanel({
    hitTestProfile: 'square-ui',
    showChannelInvertButton: true,
  }),
  'patternv0.44.wgsl': horizontalPanel({
    hitTestProfile: 'square-ui',
    showChannelInvertButton: true,
  }),

  // ── v0.45 family — circular LED shaders ──────────────────────────────────
  'patternv0.45.wgsl': circularLed({
    hitTestProfile: 'square-ui',
    polarOuterRadiusFactor: POLAR_OUTER_V045,
    uiExtraInstances: 3,
  }),
  'patternv0.45b.wgsl': circularLed({
    webglHybrid: true,
    strictPlayheadSustain: true,
  }),
  'patternv0.46.wgsl': circularLed({
    webglHybrid: true,
    hitTestProfile: 'square-ui',
    circularRowPaging: true,
  }),
  'patternv0.47.wgsl': circularLed(),
  'patternv0.48.wgsl': circularLed(),
  'patternv0.49.wgsl': circularLed(),

  // ── v0.50/v0.51 — three-emitter LED ──────────────────────────────────────
  'patternv0.50.wgsl': circularLed({
    bloomProfile: 'three-emitter',
    stepsDrivenVisibleRows: true,
  }),
  'patternv0.50b.wgsl': circularLed({
    webglHybrid: true,
    bloomProfile: 'three-emitter',
    stepsDrivenVisibleRows: true,
  }),
  'patternv0.51.wgsl': circularLed({
    bloomProfile: 'three-emitter',
    stepsDrivenVisibleRows: true,
  }),

  // ── v0.55 — three-emitter LED + oscilloscope trace ────────────────────────
  'patternv0.55.wgsl': circularLed({
    bloomProfile: 'three-emitter-osc',
    oscilloscope: true,
    stepsDrivenVisibleRows: true,
  }),

  // ── v0.52/v0.53/v0.54 — Night dark-theme circular three-emitter LED trio ───
  'patternv0.52.wgsl': circularLed({
    bloomProfile: 'three-emitter',
    instrumentPalette: true,
    stepsDrivenVisibleRows: true,
  }),
  'patternv0.53.wgsl': circularLed({
    bloomProfile: 'three-emitter',
    instrumentPalette: true,
    stepsDrivenVisibleRows: true,
  }),
  'patternv0.54.wgsl': circularLed({
    bloomProfile: 'three-emitter',
    instrumentPalette: true,
    stepsDrivenVisibleRows: true,
  }),

  // ── v0.56 — three-emitter LED + per-instrument palette ────────────────────
  'patternv0.56.wgsl': circularLed({
    bloomProfile: 'three-emitter',
    instrumentPalette: true,
    stepsDrivenVisibleRows: true,
  }),

  // ── v0.57 — three-emitter LED + per-step volume/velocity reactivity ───────
  'patternv0.57.wgsl': circularLed({
    bloomProfile: 'three-emitter',
    stepsDrivenVisibleRows: true,
  }),
};

/** Look up metadata for a shader, or null if the filename is not registered. */
export function getShaderMeta(shaderFile: string): ShaderMeta | null {
  return SHADER_REGISTRY[shaderFile] ?? null;
}

/**
 * Resolve meta for any filename: registry hit, or thin legacy inference for
 * unknown/experimental shaders (never used for production SHADER_GROUPS ids).
 */
export function resolveShaderMeta(shaderFile: string): ShaderMeta {
  const hit = SHADER_REGISTRY[shaderFile];
  if (hit) return hit;
  return inferLegacyMeta(shaderFile);
}

/**
 * Best-effort defaults for unregistered filenames so the app does not crash.
 * Prefer registering the shader explicitly.
 */
export function inferLegacyMeta(shaderFile: string): ShaderMeta {
  const name = shaderFile.toLowerCase();
  const isVideo = name.includes('v0.20') || name.includes('v0.23') || name.includes('v0.24') || name.includes('v0.25');
  const isLegacyU32 =
    name.includes('v0.11') || name.includes('v0.12') || name.includes('v0.13');
  return circularLed({
    circular: !name.includes('v0.21') && !name.includes('v0.39') && !name.includes('v0.40'),
    layoutMode:
      name.includes('v0.21') || name.includes('v0.39') || name.includes('v0.40')
        ? 'horizontal_32'
        : 'circular',
    alphaBlending: !isLegacyU32,
    highPrecisionPacking: !isLegacyU32 && !name.includes('v0.21'),
    playheadRowAsFloat: !isLegacyU32,
    patternTexture: isVideo ? 'video' : 'button',
    padTopChannel: true,
    bloomProfile: null,
  });
}

/** Return the first lite-recommended shader id, or a safe fallback. */
export function getLiteRecommendedShader(): string {
  for (const [id, meta] of Object.entries(SHADER_REGISTRY)) {
    if (meta.liteRecommended) return id;
  }
  return 'patternv0.21.wgsl';
}

/** All registered shader filenames (stable order). */
export function listRegisteredShaders(): string[] {
  return Object.keys(SHADER_REGISTRY);
}
