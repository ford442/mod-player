/**
 * Shader registry — single source of truth for per-shader capabilities.
 *
 * Adding a new shader (e.g. patternv0.56.wgsl) requires ONE block here.
 * All helpers in shaderVersion.ts and geometryConstants.ts derive from this
 * table; the includes()-chains in PatternDisplay.tsx remain authoritative for
 * canvas-size and UI decisions that are intentionally kept there (CLAUDE.md).
 *
 * Field reference
 * ───────────────
 * extendedLayout   – uses 2×u32 per cell (v0.13+); false = standard 1×u32
 * circular         – polar/ring layout; false = horizontal or legacy grid
 * layoutMode       – LAYOUT_MODES value consumed by WebGL overlay
 * background       – chassis/bezel shader fetched for the background pass
 * alphaBlending    – WebGPU pipeline needs premultiplied alpha blend
 * webglHybrid      – renders with WebGL frosted-caps overlay
 * singlePassComposite – non-false: shader owns its own background (the value
 *                       is the chassis file name, kept for legacy callers)
 * supportsStepsLength – uniform slot [24] is stepsLength:u32 (not colorPalette)
 * bloomProfile         – id into BLOOM_PROFILES in utils/bloomProfiles.ts;
 *                        null = no layered bloom (non-LED shaders, legacy paths)
 */

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
}

const C: ShaderMeta = {
  extendedLayout: true,
  circular: true,
  layoutMode: 'circular',
  background: 'bezel.wgsl',
  alphaBlending: true,
  webglHybrid: false,
  singlePassComposite: false,
  supportsStepsLength: false,
  bloomProfile: 'circular-led',
};

export const SHADER_REGISTRY: Readonly<Record<string, ShaderMeta>> = {
  // ── Legacy / standard layout ─────────────────────────────────────────────
  'patternv0.21.wgsl': {
    extendedLayout: true,
    circular: false,
    layoutMode: 'horizontal_32',
    background: 'chassis_frosted.wgsl',
    alphaBlending: false,
    webglHybrid: true,
    singlePassComposite: 'chassis_frosted.wgsl',
    supportsStepsLength: true,
    bloomProfile: null,
  },
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
  },

  // ── v0.37 family — circular with v0.37 chassis ───────────────────────────
  'patternv0.37.wgsl': {
    extendedLayout: true,
    circular: true,
    layoutMode: 'circular',
    background: 'chassisv0.37.wgsl',
    alphaBlending: false,
    webglHybrid: false,
    singlePassComposite: false,
    supportsStepsLength: false,
    bloomProfile: null,
  },
  'patternv0.38.wgsl': {
    extendedLayout: true,
    circular: true,
    layoutMode: 'circular',
    background: 'chassisv0.37.wgsl',
    alphaBlending: true,
    webglHybrid: true,
    singlePassComposite: false,
    supportsStepsLength: false,
    bloomProfile: null,
  },

  // ── v0.39/v0.40 — horizontal with frosted chassis ─────────────────────────
  'patternv0.39.wgsl': {
    extendedLayout: true,
    circular: false,
    layoutMode: 'horizontal_32',
    background: 'chassisv0.37.wgsl',
    alphaBlending: false,
    webglHybrid: true,
    singlePassComposite: false,
    supportsStepsLength: true,
    bloomProfile: null,
  },
  'patternv0.40.wgsl': {
    extendedLayout: true,
    circular: false,
    layoutMode: 'horizontal_32',
    background: 'chassis_frosted.wgsl',
    alphaBlending: true,
    webglHybrid: true,
    singlePassComposite: 'chassis_frosted.wgsl',
    supportsStepsLength: true,
    bloomProfile: null,
  },

  // ── v0.42 — circular, single-pass frosted ────────────────────────────────
  'patternv0.42.wgsl': {
    extendedLayout: true,
    circular: true,
    layoutMode: 'circular',
    background: 'chassis_frosted.wgsl',
    alphaBlending: true,
    webglHybrid: true,
    singlePassComposite: 'chassis_frosted.wgsl',
    supportsStepsLength: false,
    bloomProfile: 'circular-led',
  },

  // ── v0.43/v0.44 — horizontal, single-pass frosted ────────────────────────
  'patternv0.43.wgsl': {
    extendedLayout: true,
    circular: false,
    layoutMode: 'horizontal_32',
    background: 'chassis_frosted.wgsl',
    alphaBlending: true,
    webglHybrid: false,
    singlePassComposite: 'chassis_frosted.wgsl',
    supportsStepsLength: false,
    bloomProfile: null,
  },
  'patternv0.44.wgsl': {
    extendedLayout: true,
    circular: false,
    layoutMode: 'horizontal_32',
    background: 'chassis_frosted.wgsl',
    alphaBlending: true,
    webglHybrid: false,
    singlePassComposite: 'chassis_frosted.wgsl',
    supportsStepsLength: false,
    bloomProfile: null,
  },

  // ── v0.45 family — circular LED shaders ──────────────────────────────────
  'patternv0.45.wgsl':  { ...C },
  'patternv0.45b.wgsl': { ...C, webglHybrid: true },
  'patternv0.46.wgsl':  { ...C, webglHybrid: true },
  'patternv0.47.wgsl':  { ...C },
  'patternv0.48.wgsl':  { ...C },
  'patternv0.49.wgsl':  { ...C },

  // ── v0.50/v0.51 — three-emitter LED ──────────────────────────────────────
  'patternv0.50.wgsl':  { ...C, bloomProfile: 'three-emitter' },
  'patternv0.51.wgsl':  { ...C, bloomProfile: 'three-emitter' },

  // ── v0.55 — three-emitter LED + oscilloscope trace ────────────────────────
  'patternv0.55.wgsl':  { ...C, bloomProfile: 'three-emitter-osc' },
};

/** Look up metadata for a shader, or null if the filename is not registered. */
export function getShaderMeta(shaderFile: string): ShaderMeta | null {
  return SHADER_REGISTRY[shaderFile] ?? null;
}
