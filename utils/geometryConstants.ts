// Shared geometry constants for shader layouts
import {
  resolveShaderMeta,
  DEFAULT_POLAR_OUTER,
  POLAR_OUTER_V045,
} from './shaderRegistry';

/** Maximum visible rows in lite/mobile mode. */
export const LITE_MAX_VISIBLE_ROWS = 32;

// Grid rectangle for pattern display (normalized coordinates)
export const GRID_RECT = {
  x: 0.05,  // Left margin
  y: 0.15,  // Top margin  
  w: 0.9,   // Width
  h: 0.7    // Height
};

// Polar ring dimensions for circular layouts (normalized 0–1 factors of minDim)
export const POLAR_RINGS = {
  INNER_RADIUS: 0.15,
  OUTER_RADIUS: DEFAULT_POLAR_OUTER,
  /** v0.45 (non-b) shrinks outer ring to make room for embedded UI controls */
  OUTER_RADIUS_V045: POLAR_OUTER_V045,
};

/** Pixel inner/outer radii for circular shaders — keep WebGPU + WebGL overlay in sync. */
export function getPolarRadii(
  canvasWidth: number,
  canvasHeight: number,
  shaderFile: string,
): { innerRadius: number; outerRadius: number } {
  const minDim = Math.min(canvasWidth, canvasHeight);
  const meta = resolveShaderMeta(shaderFile);
  const innerRadius = minDim * POLAR_RINGS.INNER_RADIUS;
  return { innerRadius, outerRadius: minDim * meta.polarOuterRadiusFactor };
}

/** Circular shaders that page rows by numRows (e.g. v0.46) — WebGL overlay must match. */
export function usesCircularRowPaging(shaderFile: string): boolean {
  return resolveShaderMeta(shaderFile).circularRowPaging;
}

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

export type HorizontalCellMetrics = {
  cellW: number;
  cellH: number;
  offsetX: number;
  offsetY: number;
  /** Channels that carry pattern data (excludes optional header/pad row). */
  dataChannels: number;
};

// Calculate horizontal cell size based on canvas dimensions.
// When hasHeaderRow is true (padTopChannel), row height matches WGSL gridRect math:
// data rows divide gridRect.h by dataChannels, not the padded channel count.
export function calculateHorizontalCellSize(
  canvasWidth: number,
  canvasHeight: number,
  steps: number,
  numChannels: number,
  hasHeaderRow = false,
): HorizontalCellMetrics {
  const gridW = canvasWidth * GRID_RECT.w;
  const gridH = canvasHeight * GRID_RECT.h;

  const dataChannels = hasHeaderRow ? Math.max(1, numChannels - 1) : numChannels;
  const cellW = gridW / steps;
  const cellH = gridH / dataChannels;

  const offsetX = canvasWidth * GRID_RECT.x;
  const offsetY = canvasHeight * GRID_RECT.y;

  return { cellW, cellH, offsetX, offsetY, dataChannels };
}

/** True when WGSL horizontal shaders reserve channel 0 as a header/pad row. */
export function horizontalLayoutHasHeader(numChannels: number): boolean {
  return numChannels > 1 && GRID_RECT.y > 0.15;
}

// Calculate cap scale for pixel-perfect button sizing
export function calculateCapScale(cellW: number, cellH: number, pixelRatio: number): number {
  return Math.min(cellW, cellH) * CAP_CONFIG.CAP_SCALE_FACTOR * pixelRatio;
}

// Determine layout mode from shader filename (registry)
export function getLayoutModeFromShader(shaderFile: string): LayoutMode {
  const meta = resolveShaderMeta(shaderFile);
  return meta.layoutMode === 'horizontal_32'
    ? LAYOUT_MODES.HORIZONTAL_32
    : LAYOUT_MODES.CIRCULAR;
}
