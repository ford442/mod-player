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
