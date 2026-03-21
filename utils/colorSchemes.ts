// Color scheme utilities for channel/note visualization
// Based on WolframAlpha color calculations

import type { ColorScheme } from '../types/bloomPresets';

/**
 * Get hue for a channel index based on the color scheme
 */
export function getChannelHue(channelIndex: number, scheme: ColorScheme): number {
  switch (scheme.type) {
    case 'chromatic':
      // Map to chromatic scale: 12 positions
      return (channelIndex % 12) / 12;
      
    case 'golden':
      // Golden ratio progression for maximum distinction
      const PHI = 0.6180339887498949;
      return (channelIndex * PHI) % 1;
      
    case 'warmcool':
      // Alternating warm (0.0-0.2) and cool (0.5-0.7) hues
      const isWarm = channelIndex % 2 === 0;
      const group = Math.floor(channelIndex / 2);
      if (isWarm) {
        // Warm: orange, yellow, red range
        return (0.05 + (group * 0.15) % 0.2);
      } else {
        // Cool: blue, cyan, purple range
        return (0.55 + (group * 0.15) % 0.2);
      }
      
    case 'rainbow':
    default:
      // Linear distribution
      return channelIndex / 8; // Assume 8 channels max for full rainbow
  }
}

/**
 * Convert HSL to RGB components
 * Returns values in 0-1 range
 */
export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h * 6;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  
  let r = 0, g = 0, b = 0;
  
  if (hp < 1) {
    r = c; g = x; b = 0;
  } else if (hp < 2) {
    r = x; g = c; b = 0;
  } else if (hp < 3) {
    r = 0; g = c; b = x;
  } else if (hp < 4) {
    r = 0; g = x; b = c;
  } else if (hp < 5) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }
  
  const m = l - c * 0.5;
  return {
    r: r + m,
    g: g + m,
    b: b + m
  };
}

/**
 * Get RGB color for a channel
 */
export function getChannelColor(channelIndex: number, scheme: ColorScheme): { r: number; g: number; b: number } {
  const hue = getChannelHue(channelIndex, scheme);
  return hslToRgb(hue, 0.85, 0.58);
}

/**
 * Convert frequency to hue using logarithmic mapping
 * A4 (440Hz) = 0.75 (purple), wraps every octave
 */
export function freqToHue(freq: number): number {
  return ((Math.log2(freq / 440) % 1) + 1) % 1;
}

/**
 * Get RGB color for a note frequency
 */
export function getNoteColor(freq: number, saturation: number = 0.9, lightness: number = 0.6): { r: number; g: number; b: number } {
  const hue = freqToHue(freq);
  return hslToRgb(hue, saturation, lightness);
}

// Predefined channel colors for WGSL shaders (hardcoded alternatives)
export const CHANNEL_COLORS_4 = [
  { r: 0.9, g: 0.2, b: 0.2 },   // Red
  { r: 0.2, g: 0.8, b: 0.2 },   // Green
  { r: 0.2, g: 0.4, b: 0.9 },   // Blue
  { r: 0.9, g: 0.8, b: 0.2 },   // Yellow
];

export const CHANNEL_COLORS_8_GOLDEN = [
  { r: 0.9, g: 0.6, b: 0.2 },   // 0: Orange
  { r: 0.3, g: 0.8, b: 0.5 },   // 1: Teal
  { r: 0.8, g: 0.3, b: 0.7 },   // 2: Magenta
  { r: 0.5, g: 0.9, b: 0.3 },   // 3: Lime
  { r: 0.6, g: 0.4, b: 0.9 },   // 4: Purple
  { r: 0.9, g: 0.8, b: 0.3 },   // 5: Yellow
  { r: 0.3, g: 0.6, b: 0.9 },   // 6: Blue
  { r: 0.9, g: 0.4, b: 0.5 },   // 7: Pink
];
