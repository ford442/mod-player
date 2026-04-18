// Shader version detection utilities for PatternDisplay.
// These pure functions encode the load-bearing version-detection chains from CLAUDE.md.
// DO NOT reorder or remove version strings — they are tightly coupled to shader features.

// Shaders that support the WebGL frosted caps overlay.
// Standalone visualizer shaders (v0.47–v0.50) and full-screen shaders (v0.43, v0.44)
// are excluded — they render their own caps or are incompatible with the overlay layout.
export const WEBGL_HYBRID_SHADERS = new Set([
  'patternv0.21.wgsl',
  'patternv0.38.wgsl',
  'patternv0.39.wgsl',
  'patternv0.40.wgsl',
  'patternv0.42.wgsl',
  'patternv0.45b.wgsl',
  'patternv0.46.wgsl',
]);

export type LayoutType = 'standard' | 'extended' | 'texture';

export const getLayoutType = (shaderFile: string): LayoutType => {
  // v0.13+ use extended layout (2x uint32 per cell)
  if (shaderFile.includes('v0.13') || shaderFile.includes('v0.14') || shaderFile.includes('v0.15') || shaderFile.includes('v0.16') || shaderFile.includes('v0.17') || shaderFile.includes('v0.18') || shaderFile.includes('v0.19') || shaderFile.includes('v0.20') || shaderFile.includes('v0.21') || shaderFile.includes('v0.23') || shaderFile.includes('v0.24') || shaderFile.includes('v0.25') || shaderFile.includes('v0.26') || shaderFile.includes('v0.27') || shaderFile.includes('v0.28') || shaderFile.includes('v0.29') || shaderFile.includes('v0.30') || shaderFile.includes('v0.31') || shaderFile.includes('v0.32') || shaderFile.includes('v0.33') || shaderFile.includes('v0.34') || shaderFile.includes('v0.35') || shaderFile.includes('v0.36') || shaderFile.includes('v0.37') || shaderFile.includes('v0.38') || shaderFile.includes('v0.39') || shaderFile.includes('v0.40') || shaderFile.includes('v0.42') || shaderFile.includes('v0.43') || shaderFile.includes('v0.44') || shaderFile.includes('v0.45') || shaderFile.includes('v0.46') || shaderFile.includes('v0.47') || shaderFile.includes('v0.48') || shaderFile.includes('v0.49') || shaderFile.includes('v0.50')) return 'extended';
  return 'standard';
};

export const isSinglePassCompositeShader = (shaderFile: string): string | false => {
  // Shaders that do their own background composition in one pass.
  // v0.45, v0.46, v0.47, v0.48, v0.49 are NOT single-pass — they need the external chassis_frosted background.
  if (shaderFile.includes('v0.21') || shaderFile.includes('v0.40') || shaderFile.includes('v0.42') || shaderFile.includes('v0.43') || shaderFile.includes('v0.44')) return 'chassis_frosted.wgsl';
  return false;
};

export const isCircularLayoutShader = (shaderFile: string): boolean => {
  // v0.39 and v0.40 are NOT circular (horizontal). v0.38, v0.45, v0.46 ARE circular.
  return shaderFile.includes('v0.25') || shaderFile.includes('v0.26') || shaderFile.includes('v0.35') || shaderFile.includes('v0.37') || shaderFile.includes('v0.38') || shaderFile.includes('v0.42') || shaderFile.includes('v0.45') || shaderFile.includes('v0.46') || shaderFile.includes('v0.47') || shaderFile.includes('v0.48') || shaderFile.includes('v0.49') || shaderFile.includes('v0.50');
};

export const shouldUseBackgroundPass = (shaderFile: string): boolean => {
  return !isSinglePassCompositeShader(shaderFile);
};

export const getBackgroundShaderFile = (shaderFile: string): string => {
  if (shaderFile.includes('v0.23') || shaderFile.includes('v0.24')) return 'chassis_video.wgsl';
  // Horizontal layouts: procedural frosted chassis (opaque white panel)
  if (shaderFile.includes('v0.21') || shaderFile.includes('v0.40') || shaderFile.includes('v0.42') || shaderFile.includes('v0.43') || shaderFile.includes('v0.44')) return 'chassis_frosted.wgsl';
  // Circular layouts: actual hardware bezel photo so the dark inner circle and
  // white frame show through the transparent pattern cells
  if (shaderFile.includes('v0.45') || shaderFile.includes('v0.46') || shaderFile.includes('v0.47') || shaderFile.includes('v0.48') || shaderFile.includes('v0.49') || shaderFile.includes('v0.50')) return 'bezel.wgsl';
  if (shaderFile.includes('v0.37') || shaderFile.includes('v0.38') || shaderFile.includes('v0.39')) return 'chassisv0.37.wgsl';
  if (shaderFile.includes('v0.27') || shaderFile.includes('v0.28') || shaderFile.includes('v0.30') || shaderFile.includes('v0.31') || shaderFile.includes('v0.32') || shaderFile.includes('v0.33') || shaderFile.includes('v0.34') || shaderFile.includes('v0.35') || shaderFile.includes('v0.36')) return 'chassisv0.1.wgsl';
  return 'bezel.wgsl';
};

export const shouldEnableAlphaBlending = (shaderFile: string): boolean => {
  return shaderFile.includes('v0.35') || shaderFile.includes('v0.38') || shaderFile.includes('v0.40') || shaderFile.includes('v0.42') || shaderFile.includes('v0.43') || shaderFile.includes('v0.44') || shaderFile.includes('v0.45') || shaderFile.includes('v0.46') || shaderFile.includes('v0.47') || shaderFile.includes('v0.48') || shaderFile.includes('v0.49') || shaderFile.includes('v0.50');
};
