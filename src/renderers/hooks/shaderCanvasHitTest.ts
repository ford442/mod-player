import type { HitTestProfile } from '../../../utils/shaderVersion';

export interface ShaderCanvasHitTestActions {
  onPlay?: () => void;
  onStop?: () => void;
  onLoopToggle?: () => void;
  onSeek?: (row: number) => void;
  onVolumeChange?: (volume: number) => void;
  onPanChange?: (pan: number) => void;
  onOpenFilePicker?: () => void;
}

export interface ShaderCanvasHitTestContext {
  hitProfile: HitTestProfile;
  playheadRow: number;
  totalRows?: number;
}

function dist(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

/**
 * Map normalized canvas click coordinates to shader-embedded transport actions.
 * Returns a button flash id when a control was hit, or null when unhandled.
 */
export function dispatchShaderCanvasHitTest(
  pX: number,
  pY: number,
  ctx: ShaderCanvasHitTestContext,
  actions: ShaderCanvasHitTestActions,
): number | null {
  const { hitProfile, playheadRow, totalRows } = ctx;
  if (hitProfile === 'none') return null;

  const isV40 = hitProfile === 'square-ui';

  if (Math.abs(pX - 0.26) < 0.05 && Math.abs(pY - 0.42) < 0.05) {
    actions.onOpenFilePicker?.();
    return 2;
  }
  if (Math.abs(pX + 0.26) < 0.05 && Math.abs(pY - 0.42) < 0.05) {
    actions.onLoopToggle?.();
    return 1;
  }
  if (Math.abs(pY - 0.32) < 0.04) {
    if (Math.abs(pX + 0.12) < 0.04) {
      actions.onSeek?.(Math.max(0, playheadRow - 16));
      return 5;
    }
    if (Math.abs(pX - 0.12) < 0.04) {
      actions.onSeek?.(playheadRow + 16);
      return 6;
    }
  }

  const volSliderX = isV40 ? 0.08 : 0.28;
  const volSliderY = 0.415;
  const volSliderW = 0.18;
  const volSliderH = 0.05;
  if (Math.abs(pX - volSliderX) < volSliderW * 0.5 && Math.abs(pY - volSliderY) < volSliderH * 0.5) {
    const relX = (pX - volSliderX) / (volSliderW * 0.9);
    actions.onVolumeChange?.(Math.max(0, Math.min(1, relX + 0.5)));
    return 0;
  }

  const sliderRightX = 0.42;
  const sliderY = -0.2;
  const sliderH = 0.2;
  const sliderClickRadius = 0.03;
  if (Math.abs(pX - sliderRightX) < sliderClickRadius && Math.abs(pY - sliderY) < sliderH * 0.5) {
    const panValue = (pY - sliderY) / (sliderH * 0.45);
    actions.onPanChange?.(Math.max(-1, Math.min(1, panValue)));
    return 0;
  }

  const barY = -0.45;
  const barWidth = 0.6;
  const barCenterX = 0.1;
  const barHeight = 0.03;
  if (Math.abs(pY - barY) < barHeight && Math.abs(pX - barCenterX) < barWidth / 2) {
    const relX = pX - (barCenterX - barWidth / 2);
    actions.onSeek?.(Math.floor(Math.max(0, Math.min(1, relX / barWidth)) * (totalRows || 64)));
    return 0;
  }

  const btnRadius = 0.045;
  const playY = isV40 ? -0.45 : -0.40;
  const stopY = isV40 ? -0.45 : -0.40;
  if (dist(pX, pY, -0.44, playY) < btnRadius) {
    actions.onPlay?.();
    return 3;
  }
  if (dist(pX, pY, -0.35, stopY) < btnRadius) {
    actions.onStop?.();
    return 4;
  }

  return null;
}
