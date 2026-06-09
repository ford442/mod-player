import type { WebGL2DebugConfig, WebGL2DebugMode } from '../types';
import { DEFAULT_WEBGL2_DEBUG } from '../types';

const MODE_TO_INT: Record<WebGL2DebugMode, number> = {
  normal: 0,
  wireframe: 1,
  uv: 2,
  playhead: 3,
  channels: 4,
  'note-data': 5,
};

export function debugModeToUniform(mode: WebGL2DebugMode): number {
  return MODE_TO_INT[mode] ?? 0;
}

export function cycleDebugMode(current: WebGL2DebugMode): WebGL2DebugMode {
  const order: WebGL2DebugMode[] = [
    'normal', 'wireframe', 'uv', 'playhead', 'channels', 'note-data',
  ];
  const idx = order.indexOf(current);
  const next = order[(idx + 1) % order.length];
  return next ?? 'normal';
}

export function createDebugConfig(
  partial?: Partial<WebGL2DebugConfig>,
): WebGL2DebugConfig {
  return { ...DEFAULT_WEBGL2_DEBUG, ...partial };
}
