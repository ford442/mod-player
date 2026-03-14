// Bloom preset definitions - calculated using WolframAlpha
// See: https://wolframcloud.com/obj/ad6343f6-cda5-4bdc-9f25-6ca9b6d3c209

export interface BloomPreset {
  name: string;
  threshold: number;
  intensity: number;
  knee: number;
  description: string;
}

export interface ColorScheme {
  name: string;
  type: 'chromatic' | 'golden' | 'warmcool' | 'rainbow';
  description: string;
}

export const BLOOM_PRESETS: BloomPreset[] = [
  {
    name: 'Subtle UI',
    threshold: 0.85,
    intensity: 0.8,
    knee: 0.1,
    description: 'Clean minimal - barely visible glow',
  },
  {
    name: 'Standard',
    threshold: 0.75,
    intensity: 1.0,
    knee: 0.15,
    description: 'Balanced - general purpose (Recommended)',
  },
  {
    name: 'Gaming',
    threshold: 0.65,
    intensity: 1.5,
    knee: 0.2,
    description: 'Dramatic glow effects',
  },
  {
    name: 'HDR Cinematic',
    threshold: 1.0,
    intensity: 2.0,
    knee: 0.3,
    description: 'High contrast, film look',
  },
  {
    name: 'Neon',
    threshold: 0.5,
    intensity: 2.5,
    knee: 0.05,
    description: 'Cyberpunk - strong bloom',
  },
];

export const COLOR_SCHEMES: ColorScheme[] = [
  {
    name: 'Chromatic',
    type: 'chromatic',
    description: 'C=Red, C#=Orange, D=Yellow... (Pitch class)',
  },
  {
    name: 'Golden Ratio',
    type: 'golden',
    description: 'Maximally distinct colors using φ (0.618)',
  },
  {
    name: 'Warm/Cool',
    type: 'warmcool',
    description: 'Alternating warm and cool tones',
  },
  {
    name: 'Rainbow',
    type: 'rainbow',
    description: 'Linear hue progression',
  },
];

// Default selections
export const DEFAULT_BLOOM_PRESET: BloomPreset = BLOOM_PRESETS[1]!; // Standard
export const DEFAULT_COLOR_SCHEME: ColorScheme = COLOR_SCHEMES[1]!; // Golden Ratio

// Helper to get preset by name
export function getBloomPreset(name: string): BloomPreset {
  return BLOOM_PRESETS.find(p => p.name === name) ?? DEFAULT_BLOOM_PRESET;
}

export function getColorScheme(name: string): ColorScheme {
  return COLOR_SCHEMES.find(s => s.name === name) ?? DEFAULT_COLOR_SCHEME;
}
