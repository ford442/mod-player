import { getShaderMeta } from '../../../utils/shaderRegistry';
import {
  getShaderCanvasSize,
  isHorizontalLayoutShader,
} from '../../../utils/shaderVersion';

export interface PatternCanvasMetrics {
  width: number;
  height: number;
}

export function resolvePatternCanvasMetrics(
  shaderFile: string,
  numChannels: number,
  cellWidth: number,
  liteMode: boolean,
): PatternCanvasMetrics {
  if (liteMode) return { width: 512, height: 512 };
  if (getShaderMeta(shaderFile)) {
    return getShaderCanvasSize(shaderFile);
  }
  const isHorizontal = isHorizontalLayoutShader(shaderFile);
  if (isHorizontal) return { width: 1024, height: 1024 };
  return { width: Math.max(800, numChannels * cellWidth), height: 600 };
}

export function resolvePatternDevicePixelRatio(liteMode: boolean): number {
  return liteMode ? 1 : Math.min(window.devicePixelRatio || 1, 2);
}
