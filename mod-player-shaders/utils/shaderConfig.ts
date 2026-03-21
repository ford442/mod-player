// utils/shaderConfig.ts
// Shader version detection and configuration
// WARNING: All the shaderFile.includes('v0.XX') chains are load-bearing.
// Do NOT change the logic - only moved here for organization.

export type LayoutType = 'standard' | 'extended' | 'texture';
export type LayoutMode = 'circular' | 'horizontal';

export interface ShaderConfig {
  layoutType: LayoutType;
  layoutMode: LayoutMode;
  isHighPrecision: boolean;
  hasChassisPass: boolean;
  hasUIControls: boolean;
  padTopChannel: boolean;
  isOverlayActive: boolean;
  isHorizontal: boolean;
  enableAlphaBlending: boolean;
  playheadRowAsFloat: boolean;
  canvasSize: { width: number; height: number };
  backgroundShader: string | false;
}

/**
 * Determine the layout type based on shader file name.
 * v0.13+ use extended layout (2x uint32 per cell)
 */
export const getLayoutType = (shaderFile: string): LayoutType => {
  // v0.12 removed
  // v0.13+ use extended layout
  if (shaderFile.includes('v0.13') || shaderFile.includes('v0.14') || shaderFile.includes('v0.15') || 
      shaderFile.includes('v0.16') || shaderFile.includes('v0.17') || shaderFile.includes('v0.18') || 
      shaderFile.includes('v0.19') || shaderFile.includes('v0.20') || shaderFile.includes('v0.21') || 
      shaderFile.includes('v0.23') || shaderFile.includes('v0.24') || shaderFile.includes('v0.25') || 
      shaderFile.includes('v0.26') || shaderFile.includes('v0.27') || shaderFile.includes('v0.28') || 
      shaderFile.includes('v0.29') || shaderFile.includes('v0.30') || shaderFile.includes('v0.31') || 
      shaderFile.includes('v0.32') || shaderFile.includes('v0.33') || shaderFile.includes('v0.34') || 
      shaderFile.includes('v0.35') || shaderFile.includes('v0.36') || shaderFile.includes('v0.37') || 
      shaderFile.includes('v0.38') || shaderFile.includes('v0.39') || shaderFile.includes('v0.40') || 
      shaderFile.includes('v0.42') || shaderFile.includes('v0.43') || shaderFile.includes('v0.44') || 
      shaderFile.includes('v0.45') || shaderFile.includes('v0.46') || shaderFile.includes('v0.47') || 
      shaderFile.includes('v0.48') || shaderFile.includes('v0.49')) {
    return 'extended';
  }
  return 'standard';
};

/**
 * Check if shader is a single-pass composite shader that handles its own background
 */
export const isSinglePassCompositeShader = (shaderFile: string): string | false => {
  // Shaders that do their own background composition in one pass
  // v0.45, v0.46, v0.47, v0.48, v0.49 are NOT single-pass - they need external chassis
  if (shaderFile.includes('v0.21') || shaderFile.includes('v0.40') || 
      shaderFile.includes('v0.42') || shaderFile.includes('v0.43') || 
      shaderFile.includes('v0.44')) {
    return 'chassis_frosted.wgsl';
  }
  return false;
};

/**
 * Check if shader uses circular layout
 * v0.39 and v0.40 are NOT circular (they're horizontal). v0.38 IS circular.
 */
export const isCircularLayoutShader = (shaderFile: string): boolean => {
  return shaderFile.includes('v0.25') || shaderFile.includes('v0.26') || 
         shaderFile.includes('v0.35') || shaderFile.includes('v0.37') || 
         shaderFile.includes('v0.38') || shaderFile.includes('v0.45') || 
         shaderFile.includes('v0.46') || shaderFile.includes('v0.47') || 
         shaderFile.includes('v0.48') || shaderFile.includes('v0.49');
};

/**
 * Check if shader should use a background pass
 */
export const shouldUseBackgroundPass = (shaderFile: string): boolean => {
  return !isSinglePassCompositeShader(shaderFile);
};

/**
 * Get the appropriate background shader file for a given pattern shader
 */
export const getBackgroundShaderFile = (shaderFile: string): string => {
  if (shaderFile.includes('v0.23') || shaderFile.includes('v0.24')) return 'chassis_video.wgsl';
  
  // Horizontal layouts: procedural frosted chassis
  if (shaderFile.includes('v0.21') || shaderFile.includes('v0.40') || 
      shaderFile.includes('v0.42') || shaderFile.includes('v0.43') || 
      shaderFile.includes('v0.44')) {
    return 'chassis_frosted.wgsl';
  }
  
  // Circular layouts: hardware bezel photo
  if (shaderFile.includes('v0.45') || shaderFile.includes('v0.46') || 
      shaderFile.includes('v0.47') || shaderFile.includes('v0.48') || 
      shaderFile.includes('v0.49')) {
    return 'bezel.wgsl';
  }
  
  if (shaderFile.includes('v0.37') || shaderFile.includes('v0.38') || 
      shaderFile.includes('v0.39')) {
    return 'chassisv0.37.wgsl';
  }
  
  if (shaderFile.includes('v0.27') || shaderFile.includes('v0.28') || 
      shaderFile.includes('v0.30') || shaderFile.includes('v0.31') || 
      shaderFile.includes('v0.32') || shaderFile.includes('v0.33') || 
      shaderFile.includes('v0.34') || shaderFile.includes('v0.35') || 
      shaderFile.includes('v0.36')) {
    return 'chassisv0.1.wgsl';
  }
  
  return 'bezel.wgsl';
};

/**
 * Check if alpha blending should be enabled
 */
export const shouldEnableAlphaBlending = (shaderFile: string): boolean => {
  return shaderFile.includes("v0.35") || shaderFile.includes("v0.38") || 
         shaderFile.includes("v0.40") || shaderFile.includes("v0.42") || 
         shaderFile.includes("v0.43") || shaderFile.includes("v0.44") || 
         shaderFile.includes("v0.45") || shaderFile.includes("v0.46") || 
         shaderFile.includes("v0.47") || shaderFile.includes("v0.48") || 
         shaderFile.includes("v0.49");
};

/**
 * Check if overlay/WebGL is active for this shader
 */
export const isOverlayActive = (shaderFile: string): boolean => {
  return shaderFile.includes('v0.38') || shaderFile.includes('v0.39') || 
         shaderFile.includes('v0.40') || shaderFile.includes('v0.42') || 
         shaderFile.includes('v0.43') || shaderFile.includes('v0.44') || 
         shaderFile.includes('v0.45') || shaderFile.includes('v0.46');
};

/**
 * Check if top channel padding is needed
 * v0.16, v0.17, v0.21, v0.38, v0.39, v0.40, v0.42, v0.43, v0.44, v0.45, v0.46 need padding
 */
export const shouldPadTopChannel = (shaderFile: string): boolean => {
  return shaderFile.includes('v0.16') || shaderFile.includes('v0.17') || 
         shaderFile.includes('v0.21') || shaderFile.includes('v0.38') || 
         shaderFile.includes('v0.39') || shaderFile.includes('v0.40') || 
         shaderFile.includes('v0.42') || shaderFile.includes('v0.43') || 
         shaderFile.includes('v0.44') || shaderFile.includes('v0.45') || 
         shaderFile.includes('v0.46') || shaderFile.includes('v0.49');
};

/**
 * Check if horizontal layout
 */
export const isHorizontalLayout = (shaderFile: string): boolean => {
  return shaderFile.includes('v0.13') || shaderFile.includes('v0.14') || 
         shaderFile.includes('v0.16') || shaderFile.includes('v0.17') || 
         shaderFile.includes('v0.21') || shaderFile.includes('v0.39') || 
         shaderFile.includes('v0.40');
};

/**
 * Check if high precision data packing should be used
 */
export const isHighPrecision = (shaderFile: string): boolean => {
  return shaderFile.includes('v0.36') || shaderFile.includes('v0.37') || 
         shaderFile.includes('v0.38') || shaderFile.includes('v0.39') || 
         shaderFile.includes('v0.40') || shaderFile.includes('v0.43') || 
         shaderFile.includes('v0.44') || shaderFile.includes('v0.45') || 
         shaderFile.includes('v0.46') || shaderFile.includes('v0.48') || 
         shaderFile.includes('v0.49');
};

/**
 * Check if playhead row should be passed as float
 */
export const shouldUseFloatPlayhead = (shaderFile: string): boolean => {
  return shaderFile.includes('v0.40') || shaderFile.includes('v0.42') || 
         shaderFile.includes('v0.43') || shaderFile.includes('v0.44') || 
         shaderFile.includes('v0.45') || shaderFile.includes('v0.46') || 
         shaderFile.includes('v0.47') || shaderFile.includes('v0.48') || 
         shaderFile.includes('v0.49');
};

/**
 * Check if shader uses UI controls
 */
export const hasUIControls = (shaderFile: string): boolean => {
  return shaderFile.includes('v0.37') || shaderFile.includes('v0.38') || 
         shaderFile.includes('v0.39') || shaderFile.includes('v0.40') || 
         shaderFile.includes('v0.42') || shaderFile.includes('v0.43') || 
         shaderFile.includes('v0.44') || shaderFile.includes('v0.45') || 
         shaderFile.includes('v0.46');
};

/**
 * Get recommended canvas size for a shader
 */
export const getCanvasSize = (shaderFile: string, numChannels: number, cellWidth: number): { width: number; height: number } => {
  // Force specific resolutions for certain chassis
  if (shaderFile.includes('v0.27') || shaderFile.includes('v0.28')) {
    return { width: 1024, height: 1008 };
  }
  
  if (shaderFile.includes('v0.21') || shaderFile.includes('v0.37') || 
      shaderFile.includes('v0.38') || shaderFile.includes('v0.39') || 
      shaderFile.includes('v0.40') || shaderFile.includes('v0.42') || 
      shaderFile.includes('v0.43') || shaderFile.includes('v0.44') || 
      shaderFile.includes('v0.45') || shaderFile.includes('v0.46') || 
      shaderFile.includes('v0.47') || shaderFile.includes('v0.48') || 
      shaderFile.includes('v0.49')) {
    return { width: 1024, height: 1024 };
  }

  const isHorizontal = isHorizontalLayout(shaderFile);
  if (isHorizontal) {
    return { width: 1024, height: 1024 };
  }

  // Circular layouts often benefit from square
  if (shaderFile.includes('v0.25') || shaderFile.includes('v0.30') || 
      shaderFile.includes('v0.35')) {
    return { width: 1024, height: 1024 };
  }

  // Standard waterfall
  return {
    width: Math.max(800, numChannels * cellWidth),
    height: 600
  };
};

/**
 * Get complete shader configuration
 */
export const getShaderConfig = (
  shaderFile: string,
  numChannels: number = 4,
  cellWidth: number = 120
): ShaderConfig => {
  const layoutType = getLayoutType(shaderFile);
  const isCircular = isCircularLayoutShader(shaderFile);
  const singlePass = isSinglePassCompositeShader(shaderFile);

  return {
    layoutType,
    layoutMode: isCircular ? 'circular' : 'horizontal',
    isHighPrecision: isHighPrecision(shaderFile),
    hasChassisPass: shouldUseBackgroundPass(shaderFile),
    hasUIControls: hasUIControls(shaderFile),
    padTopChannel: shouldPadTopChannel(shaderFile),
    isOverlayActive: isOverlayActive(shaderFile),
    isHorizontal: isHorizontalLayout(shaderFile),
    enableAlphaBlending: shouldEnableAlphaBlending(shaderFile),
    playheadRowAsFloat: shouldUseFloatPlayhead(shaderFile),
    canvasSize: getCanvasSize(shaderFile, numChannels, cellWidth),
    backgroundShader: singlePass ? false : getBackgroundShaderFile(shaderFile),
  };
};

export default getShaderConfig;
