// Shader version detection utilities for PatternDisplay.
// All per-shader capabilities live in shaderRegistry.ts.
// These helpers are thin wrappers kept for backward-compatible call-sites.

import { SHADER_REGISTRY, getShaderMeta } from './shaderRegistry';

// ---------------------------------------------------------------------------
// WEBGL_HYBRID_SHADERS — kept as a Set for O(1) membership tests at call sites
// that use Set.has() directly (PatternDisplay.tsx, useWebGLOverlay.ts).
// Derived from the registry so it never needs manual updates.
// ---------------------------------------------------------------------------
export const WEBGL_HYBRID_SHADERS = new Set(
  Object.entries(SHADER_REGISTRY)
    .filter(([, meta]) => meta.webglHybrid)
    .map(([filename]) => filename)
);

export type LayoutType = 'standard' | 'extended' | 'texture';

export const getLayoutType = (shaderFile: string): LayoutType => {
  const meta = getShaderMeta(shaderFile);
  if (meta) return meta.extendedLayout ? 'extended' : 'standard';
  // Fallback: unknown shaders default to extended (v0.13+ convention)
  return 'extended';
};

export const isSinglePassCompositeShader = (shaderFile: string): string | false => {
  const meta = getShaderMeta(shaderFile);
  return meta ? meta.singlePassComposite : false;
};

export const isCircularLayoutShader = (shaderFile: string): boolean => {
  const meta = getShaderMeta(shaderFile);
  return meta ? meta.circular : true; // unknown shaders default circular
};

export const shouldUseBackgroundPass = (shaderFile: string): boolean => {
  return !isSinglePassCompositeShader(shaderFile);
};

export const getBackgroundShaderFile = (shaderFile: string): string => {
  const meta = getShaderMeta(shaderFile);
  return meta ? meta.background : 'bezel.wgsl';
};

export const shouldEnableAlphaBlending = (shaderFile: string): boolean => {
  const meta = getShaderMeta(shaderFile);
  return meta ? meta.alphaBlending : true; // unknown shaders default to alpha blend
};

/**
 * Returns true for shaders that use uniform slot [24] as `stepsLength: u32`.
 * All other shaders use slot [24] as `colorPalette: u32`.
 */
export const supportsStepsLength = (shaderFile: string): boolean => {
  const meta = getShaderMeta(shaderFile);
  return meta ? meta.supportsStepsLength : false;
};

/** Returns true if the shader is tagged as recommended for lite/mobile mode. */
export const isLiteRecommendedShader = (shaderFile: string): boolean => {
  const meta = getShaderMeta(shaderFile);
  return meta?.liteRecommended ?? false;
};

/** Shaders that use packPatternMatrixHighPrecision (DURA + TRIG-001 trigger flag). */
const HIGH_PRECISION_SHADER_MARKERS = [
  'v0.30b', 'v0.36', 'v0.37', 'v0.38', 'v0.39', 'v0.40', 'v0.42', 'v0.43', 'v0.44',
  'v0.45', 'v0.46', 'v0.47', 'v0.48', 'v0.49', 'v0.50', 'v0.50b', 'v0.51', 'v0.55',
  'v0.56', 'v0.57',
] as const;

export const usesHighPrecisionPacking = (shaderFile: string): boolean =>
  HIGH_PRECISION_SHADER_MARKERS.some((marker) => shaderFile.includes(marker));

/**
 * v0.45b uses playhead-scrolled sustain (note-on cell drives duration window).
 * All other high-precision shaders use static trigger nodes + dim sustain tails.
 */
export const usesStrictPlayheadSustainMode = (shaderFile: string): boolean =>
  shaderFile.includes('v0.45b') || shaderFile.includes('v0.30b');

/** Shaders that read playheadRow as f32 in the uniform buffer (slot [2]). */
export const usesPlayheadRowAsFloat = (shaderFile: string): boolean =>
  shaderFile.includes('v0.30b') ||
  shaderFile.includes('v0.21') || shaderFile.includes('v0.39') ||
  shaderFile.includes('v0.40') || shaderFile.includes('v0.42') ||
  shaderFile.includes('v0.43') || shaderFile.includes('v0.44') ||
  shaderFile.includes('v0.45') || shaderFile.includes('v0.46') ||
  shaderFile.includes('v0.47') || shaderFile.includes('v0.48') ||
  shaderFile.includes('v0.49') || shaderFile.includes('v0.50') ||
  shaderFile.includes('v0.51') || shaderFile.includes('v0.55') ||
  shaderFile.includes('v0.56') || shaderFile.includes('v0.57');
