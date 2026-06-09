import type { WebGPURenderParams } from '../../hooks/useWebGPURender';

/** Active pattern visualization backend. */
export type PatternRendererBackend = 'webgpu' | 'webgl2' | 'html';

/** Shared per-frame parameters — all GPU backends read the same ref. */
export type PatternRenderParams = WebGPURenderParams;

/** Debug visualization modes for the WebGL2 reference renderer. */
export type WebGL2DebugMode =
  | 'normal'
  | 'wireframe'
  | 'uv'
  | 'playhead'
  | 'channels'
  | 'note-data';

export interface WebGL2DebugConfig {
  mode: WebGL2DebugMode;
  /** Multiplier for playhead-driven scrolling (0.25 = quarter speed). */
  scrollSpeed: number;
  /** When true, skip bloom post-processing. */
  skipBloom: boolean;
}

export const DEFAULT_WEBGL2_DEBUG: WebGL2DebugConfig = {
  mode: 'normal',
  scrollSpeed: 1.0,
  skipBloom: false,
};

/** Agent/CI-facing handle exposed on `window.currentPatternRenderer`. */
export interface CurrentPatternRenderer {
  backend: PatternRendererBackend;
  /** Read back RGBA pixels from the active canvas (bottom-left origin). */
  readPixels(): Uint8Array | null;
  getCanvas(): HTMLCanvasElement | null;
  setDebugMode(mode: WebGL2DebugMode): void;
  getDebugMode(): WebGL2DebugMode;
  setScrollSpeed(speed: number): void;
  getScrollSpeed(): number;
  resize(): void;
}
