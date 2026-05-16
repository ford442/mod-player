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
    name: 'Soft',
    threshold: 0.65,
    intensity: 0.7,
    knee: 0.35,
    description: 'Wide, gentle glow — subtle and atmospheric',
  },
  {
    name: 'Crisp',
    threshold: 0.82,
    intensity: 1.0,
    knee: 0.06,
    description: 'Tight, precise highlights — clean and sharp',
  },
  {
    name: 'Heavy',
    threshold: 0.45,
    intensity: 2.2,
    knee: 0.18,
    description: 'Intense, broad bloom — dramatic impact',
  },
  {
    name: 'Dreamy',
    threshold: 0.55,
    intensity: 1.6,
    knee: 0.45,
    description: 'Soft wide halo with deep feathering — ethereal feel',
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
export const DEFAULT_BLOOM_PRESET: BloomPreset = BLOOM_PRESETS[1]!; // Crisp
export const DEFAULT_COLOR_SCHEME: ColorScheme = COLOR_SCHEMES[1]!; // Golden Ratio

// Helper to get preset by name
export function getBloomPreset(name: string): BloomPreset {
  return BLOOM_PRESETS.find(p => p.name === name) ?? DEFAULT_BLOOM_PRESET;
}

export function getColorScheme(name: string): ColorScheme {
  return COLOR_SCHEMES.find(s => s.name === name) ?? DEFAULT_COLOR_SCHEME;
}
