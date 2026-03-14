/**
 * Shared Geometry Constants - Ultimate Source of Truth
 * 
 * These values are used across:
 * - PatternDisplay.tsx (WebGL overlay positioning)
 * - All WGSL shaders (grid rendering)
 * - Polar chassis shader (ring positioning)
 * 
 * Changing any value here updates all modes instantly.
 */

/** Grid rectangle in normalized coordinates (0-1) */
export const GRID_RECT = {
  x: 160 / 1024,  // 0.15625
  y: 180 / 1024,  // 0.17578125
  w: 705 / 1024,  // 0.6884765625
  h: 685 / 1024   // 0.6689453125
} as const;

/** Pixel dimensions at 1024x1024 reference resolution */
export const GRID_RECT_PIXELS = {
  x: 160,
  y: 180,
  w: 705,
  h: 685,
  right: 865,   // x + w
  bottom: 865   // y + h
} as const;

/** Polar ring configuration for circular modes */
export const POLAR_RINGS = {
  innerRadius: 0.3,      // Normalized distance from center
  outerRadius: 0.9,      // Normalized distance from center
  trackCount: 8,         // Number of concentric tracks
  segmentCount: 64,      // Steps per ring
  trackGap: 0.02,        // Gap between tracks (normalized)
  segmentGap: 0.05       // Angular gap between segments
} as const;

/** Layout mode identifiers */
export const LAYOUT_MODES = {
  CIRCULAR: 1,
  HORIZONTAL_32: 2,
  HORIZONTAL_64: 3
} as const;

/** Cap rendering configuration */
export const CAP_CONFIG = {
  scaleFactor: 0.88,     // Cap size relative to cell (prevents border overlap)
  minScale: 0.85,        // Minimum cap scale for visibility
  popEffectScale: 1.2,   // Scale multiplier on playhead hit
  cornerRadius: 0.08,    // Rounded corner amount
  glowIntensity: 1.5     // Bloom multiplier
} as const;

/** Chassis uniform values shared with WGSL */
export const CHASSIS_UNIFORMS = {
  gridInsetX: GRID_RECT.x,
  gridInsetY: GRID_RECT.y,
  gridWidth: GRID_RECT.w,
  gridHeight: GRID_RECT.h,
  polarInner: POLAR_RINGS.innerRadius,
  polarOuter: POLAR_RINGS.outerRadius
} as const;

/** WebGL/WebGPU canvas configuration */
export const CANVAS_CONFIG = {
  referenceWidth: 1024,
  referenceHeight: 1024,
  devicePixelRatio: typeof window !== 'undefined' ? Math.min(window.devicePixelRatio, 2) : 1
} as const;

/**
 * Calculate cell dimensions for horizontal layouts
 */
export function calculateHorizontalCellSize(
  canvasWidth: number,
  canvasHeight: number,
  stepCount: 32 | 64,
  channelCount: number
): { cellW: number; cellH: number; offsetX: number; offsetY: number } {
  const gridW = GRID_RECT.w * canvasWidth;
  const gridH = GRID_RECT.h * canvasHeight;
  
  return {
    cellW: gridW / stepCount,
    cellH: gridH / channelCount,
    offsetX: GRID_RECT.x * canvasWidth,
    offsetY: GRID_RECT.y * canvasHeight
  };
}

/**
 * Calculate polar ring radius for a given track index
 */
export function calculatePolarRadius(trackIndex: number, totalTracks: number): number {
  const trackWidth = (POLAR_RINGS.outerRadius - POLAR_RINGS.innerRadius) / totalTracks;
  return POLAR_RINGS.innerRadius + (trackIndex + 0.5) * trackWidth;
}

/**
 * Calculate cap scale based on cell size and device pixel ratio
 */
export function calculateCapScale(
  cellWidth: number,
  cellHeight: number,
  pixelRatio: number = CANVAS_CONFIG.devicePixelRatio
): number {
  return Math.min(cellWidth, cellHeight) * CAP_CONFIG.scaleFactor * pixelRatio;
}

/** Type for layout mode values */
export type LayoutMode = typeof LAYOUT_MODES[keyof typeof LAYOUT_MODES];

/** Shader file to layout mode mapping */
export function getLayoutModeFromShader(shaderFile: string): LayoutMode {
  if (shaderFile.includes('v0.44')) {
    return LAYOUT_MODES.HORIZONTAL_64;
  }
  if (
    shaderFile.includes('v0.21') ||
    shaderFile.includes('v0.40') ||
    shaderFile.includes('v0.43') ||
    shaderFile.includes('v0.46') ||
    shaderFile.includes('v0.39')
  ) {
    return LAYOUT_MODES.HORIZONTAL_32;
  }
  // Default to circular for all other shaders
  return LAYOUT_MODES.CIRCULAR;
}
