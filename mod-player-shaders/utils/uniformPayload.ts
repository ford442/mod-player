// utils/uniformPayload.ts
// Uniform buffer payload filling - extracted from PatternDisplay

import { LayoutType } from './shaderConfig';
import { GRID_RECT } from '../../utils/geometryConstants';

interface UniformParams {
  numRows: number;
  numChannels: number;
  playheadRow: number;
  playheadRowAsFloat?: boolean;
  isPlaying: boolean;
  cellW: number;
  cellH: number;
  canvasW: number;
  canvasH: number;
  tickOffset: number;
  bpm: number;
  timeSec: number;
  beatPhase: number;
  groove: number;
  kickTrigger: number;
  activeChannels: number[];
  isModuleLoaded: boolean;
  bloomIntensity?: number;
  bloomThreshold?: number;
  invertChannels?: boolean;
  dimFactor?: number;
  gridRect?: { x: number; y: number; w: number; h: number };
}

export const fillUniformPayload = (
  layoutType: LayoutType,
  params: UniformParams,
  uint: Uint32Array,
  float: Float32Array
): number => {
  if (layoutType === 'extended') {
    uint[0] = Math.max(0, params.numRows) >>> 0;
    uint[1] = Math.max(0, params.numChannels) >>> 0;
    
    if (params.playheadRowAsFloat) {
      float[2] = Math.max(0, params.playheadRow);
    } else {
      uint[2] = Math.max(0, params.playheadRow) >>> 0;
    }
    
    uint[3] = params.isPlaying ? 1 : 0;
    float[4] = params.cellW;
    float[5] = params.cellH;
    float[6] = params.canvasW;
    float[7] = params.canvasH;
    float[8] = params.tickOffset;
    float[9] = params.bpm;
    float[10] = params.timeSec;
    float[11] = params.beatPhase;
    float[12] = params.groove;
    float[13] = params.kickTrigger;
    uint[14] = params.activeChannels.reduce((mask, ch) => mask | (1 << ch), 0) >>> 0;
    uint[15] = params.isModuleLoaded ? 1 : 0;
    float[16] = params.bloomIntensity ?? 1.0;
    float[17] = params.bloomThreshold ?? 0.8;
    uint[18] = params.invertChannels ? 1 : 0;
    float[19] = params.dimFactor ?? 1.0;
    
    // Grid bounds
    float[20] = params.gridRect?.x ?? GRID_RECT.x;
    float[21] = params.gridRect?.y ?? GRID_RECT.y;
    float[22] = params.gridRect?.w ?? GRID_RECT.w;
    float[23] = params.gridRect?.h ?? GRID_RECT.h;
    
    return 96;
  }

  // Standard layout
  uint[0] = Math.max(0, params.numRows) >>> 0;
  uint[1] = Math.max(0, params.numChannels) >>> 0;
  
  if (params.playheadRowAsFloat) {
    float[2] = Math.max(0, params.playheadRow);
  } else {
    uint[2] = Math.max(0, params.playheadRow) >>> 0;
  }
  
  uint[3] = 0;
  float[4] = params.cellW;
  float[5] = params.cellH;
  float[6] = params.canvasW;
  float[7] = params.canvasH;
  
  if (layoutType === 'texture') {
    float[8] = 1; float[9] = 1; float[10] = 0; float[11] = 0; float[12] = 1; float[13] = 1;
    return 64;
  }
  
  return 32;
};

export default fillUniformPayload;
