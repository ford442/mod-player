/**
 * Shared WebGL hybrid overlay layout — keeps overlay grid aligned with WebGPU WGSL.
 * Used by useWebGLOverlay, WebGL2PatternRenderer, and frameDraw (steps-driven rows).
 */
import { resolveShaderMeta } from './shaderRegistry';
import {
  LAYOUT_MODES,
  calculateHorizontalCellSize,
  getLayoutModeFromShader,
  type LayoutMode,
} from './geometryConstants';
import { usesStepsDrivenVisibleRows } from './shaderVersion';

export type OverlayLayoutInput = {
  shaderFile: string;
  canvasWidth: number;
  canvasHeight: number;
  matrixNumRows: number;
  /** Channel count including padTopChannel header slot when enabled. */
  numChannels: number;
  padTopChannel: boolean;
  stepsLength?: number | undefined;
};

export type OverlayHorizontalMetrics = {
  cellW: number;
  cellH: number;
  offsetX: number;
  offsetY: number;
  dataChannels: number;
  hasHeaderRow: boolean;
};

export type ResolvedOverlayLayout = {
  layoutMode: LayoutMode;
  stepsPerPage: number;
  /** Step slots instanced in the WebGL overlay pass. */
  overlayVisibleSteps: number;
  overlayTotalInstances: number;
  /** Value for u_rows / WGSL numRows when steps cap applies. */
  uniformRows: number;
  horizontal: OverlayHorizontalMetrics | null;
};

/** Header-row Y remap — only v0.40-style shaders (matches WGSL gridRect.y >= 0.15). */
export function horizontalPadRowRemapEnabled(shaderFile: string, padTopChannel: boolean): boolean {
  if (!padTopChannel) return false;
  return resolveShaderMeta(shaderFile).horizontalPadRowRemap;
}

export function resolveOverlayLayout(input: OverlayLayoutInput): ResolvedOverlayLayout {
  const meta = resolveShaderMeta(input.shaderFile);
  const stepsLength = input.stepsLength ?? 32;

  let layoutMode = getLayoutModeFromShader(input.shaderFile);
  if (meta.layoutMode === 'horizontal_32' && meta.supportsStepsLength) {
    layoutMode = stepsLength === 64 ? LAYOUT_MODES.HORIZONTAL_64 : LAYOUT_MODES.HORIZONTAL_32;
  }

  const stepsPerPage =
    layoutMode === LAYOUT_MODES.HORIZONTAL_64 ? 64
      : layoutMode === LAYOUT_MODES.HORIZONTAL_32 ? stepsLength
        : input.matrixNumRows;

  const isHorizontal =
    layoutMode === LAYOUT_MODES.HORIZONTAL_32 || layoutMode === LAYOUT_MODES.HORIZONTAL_64;

  let overlayVisibleSteps: number;
  let uniformRows: number;

  if (isHorizontal) {
    overlayVisibleSteps = stepsPerPage;
    uniformRows = input.matrixNumRows;
  } else if (usesStepsDrivenVisibleRows(input.shaderFile)) {
    overlayVisibleSteps = Math.min(stepsLength, input.matrixNumRows);
    uniformRows = overlayVisibleSteps;
  } else {
    overlayVisibleSteps = input.matrixNumRows;
    uniformRows = input.matrixNumRows;
  }

  const overlayTotalInstances = overlayVisibleSteps * input.numChannels;

  let horizontal: OverlayHorizontalMetrics | null = null;
  if (isHorizontal) {
    const hasHeaderRow = horizontalPadRowRemapEnabled(input.shaderFile, input.padTopChannel);
    const metrics = calculateHorizontalCellSize(
      input.canvasWidth,
      input.canvasHeight,
      overlayVisibleSteps,
      input.numChannels,
      hasHeaderRow,
    );
    horizontal = {
      cellW: metrics.cellW,
      cellH: metrics.cellH,
      offsetX: metrics.offsetX,
      offsetY: metrics.offsetY,
      dataChannels: metrics.dataChannels,
      hasHeaderRow,
    };
  }

  return {
    layoutMode,
    stepsPerPage,
    overlayVisibleSteps,
    overlayTotalInstances,
    uniformRows,
    horizontal,
  };
}

/** WebGPU draw instance row count (horizontal shaders draw full matrix; circular may cap). */
export function resolveWebGpuVisibleRows(
  shaderFile: string,
  matrixNumRows: number,
  stepsLength?: number,
): number {
  const steps = stepsLength ?? 32;
  if (steps > 0 && usesStepsDrivenVisibleRows(shaderFile)) {
    return Math.min(steps, matrixNumRows);
  }
  return matrixNumRows;
}
