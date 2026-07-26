import type React from 'react';
import type { ChannelShadowState, PatternMatrix, PlaybackState } from '../../types';

export type DebugInfo = {
  layoutMode: string;
  errors: string[];
  uniforms: Record<string, number | string>;
};

/** All per-frame render parameters — updated every React render via ref assignment. */
export interface WebGPURenderParams {
  matrix: PatternMatrix | null;
  channels: ChannelShadowState[];
  padTopChannel: boolean;
  isPlaying: boolean;
  bpm: number;
  timeSec: number;
  tickOffset: number;
  beatPhase: number;
  grooveAmount: number;
  kickTrigger: number;
  activeChannels: number[];
  isModuleLoaded: boolean;
  bloomIntensity: number;
  bloomThreshold: number;
  dimFactor: number;
  volume: number;
  pan: number;
  isLooping: boolean;
  invertChannels: boolean;
  clickedButton: number;
  cellWidth: number;
  cellHeight: number;
  playheadRow: number;
  localTime: number;
  isHorizontal: boolean;
  externalVideoSource: HTMLVideoElement | HTMLImageElement | null;
  playbackStateRef?: React.MutableRefObject<PlaybackState>;
  /** Live channel shadow state — preferred over `channels` in the render loop. */
  channelStatesRef?: React.MutableRefObject<ChannelShadowState[]>;
  canvasMetrics: { width: number; height: number };
  totalRows?: number;
  colorPalette?: number;
  stepsLength?: number;
  chassisDark?: boolean;
  // Night Mode 2.0 (v0.35_bloom)
  vignetteStrength?: number;
  themeBlend?: number;
  filmGrain?: number;
  nightPreset?: number;
  invertMix?: number;
  // Per-instrument palette mode
  paletteMode?: number;
  /** 0 = off; 1-based instrument index for mid-LED highlight (v0.59). */
  highlightInstrument?: number;
  instrumentPalette?: Uint8Array | undefined;
  /** SAB metadata view (band energy + meters) from worklet. */
  audioReactiveRef?: React.MutableRefObject<Float32Array | null>;
  /** User toggle — when false, AudioReactive.enabled is 0. */
  reactiveMode?: boolean;
  /** Worklet oscilloscope ring buffer (mono); uploaded to GPU binding 6 when present. */
  oscBufferRef?: React.MutableRefObject<Float32Array | null>;
}

/** Shared per-frame parameters — all GPU backends read the same ref. */
export type PatternRenderParams = WebGPURenderParams;

/** Prefer ref-backed channel state for GPU uploads (avoids 60 Hz React re-renders). */
export function resolveLiveChannels(p: WebGPURenderParams): ChannelShadowState[] {
  const fromRef = p.channelStatesRef?.current;
  if (fromRef && fromRef.length > 0) return fromRef;
  return p.channels;
}
