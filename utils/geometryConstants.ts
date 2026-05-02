// Shared geometry constants for shader layouts

// Grid rectangle for pattern display (normalized coordinates)
export const GRID_RECT = {
  x: 0.05,  // Left margin
  y: 0.15,  // Top margin  
  w: 0.9,   // Width
  h: 0.7    // Height
};

// Polar ring dimensions for circular layouts
export const POLAR_RINGS = {
  INNER_RADIUS: 0.3,
  OUTER_RADIUS: 0.9
};

// Cap/button configuration
export const CAP_CONFIG = {
  CAP_SCALE_FACTOR: 0.88
};

// Layout modes matching shader constants
export const LAYOUT_MODES = {
  CIRCULAR: 1,
  HORIZONTAL_32: 2,
  HORIZONTAL_64: 3
};

export type LayoutMode = typeof LAYOUT_MODES[keyof typeof LAYOUT_MODES];

// Calculate horizontal cell size based on canvas dimensions
export function calculateHorizontalCellSize(
  canvasWidth: number,
  canvasHeight: number,
  steps: number,
  numChannels: number
): { cellW: number; cellH: number; offsetX: number; offsetY: number } {
  const gridW = canvasWidth * GRID_RECT.w;
  const gridH = canvasHeight * GRID_RECT.h;
  
  const cellW = gridW / steps;
  const cellH = gridH / numChannels;
  
  const offsetX = canvasWidth * GRID_RECT.x;
  const offsetY = canvasHeight * GRID_RECT.y;
  
  return { cellW, cellH, offsetX, offsetY };
}

// Calculate cap scale for pixel-perfect button sizing
export function calculateCapScale(cellW: number, cellH: number, pixelRatio: number): number {
  return Math.min(cellW, cellH) * CAP_CONFIG.CAP_SCALE_FACTOR * pixelRatio;
}

// Determine layout mode from shader filename
export function getLayoutModeFromShader(shaderFile: string): LayoutMode {
  if (shaderFile.includes('v0.39') || shaderFile.includes('v0.40') ||
      shaderFile.includes('v0.43') || shaderFile.includes('v0.44')) {
    return LAYOUT_MODES.HORIZONTAL_32;
  }

  if (shaderFile.includes('v0.42') || shaderFile.includes('v0.45') || shaderFile.includes('v0.46') ||
      shaderFile.includes('v0.47') || shaderFile.includes('v0.48') ||
      shaderFile.includes('v0.49') || shaderFile.includes('v0.51')) {
    return LAYOUT_MODES.CIRCULAR;
  }
  
  // Default to circular for most shaders
  return LAYOUT_MODES.CIRCULAR;
}
