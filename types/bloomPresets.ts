// Bloom preset definitions - calculated using WolframAlpha
// See: https://wolframcloud.com/obj/ad6343f6-cda5-4bdc-9f25-6ca9b6d3c209

export interface BloomPreset {
  name: string;
  threshold: number;
  intensity: number;
  knee: number;
  description: string;
}

// Night Mode 2.0 — shader-driven night theme for patternv0.35_bloom and later
export type NightPreset = 'dusk' | 'midnight' | 'deep';

export interface NightModeConfig {
  preset: NightPreset;
  presetIndex: number;  // 1=dusk, 2=midnight, 3=deep (0 = night mode off)
  dimFactor: number;
  vignetteStrength: number;
  filmGrain: number;
  invertMix: number;     // luminance-inversion blend (0=normal, 1=inverted)
  bloomIntensity: number;
  description: string;
}

export const NIGHT_PRESETS: Record<NightPreset, NightModeConfig> = {
  dusk: {
    preset: 'dusk',
    presetIndex: 1,
    dimFactor: 0.7,
    vignetteStrength: 0.3,
    filmGrain: 0.02,
    invertMix: 0.0,
    bloomIntensity: 0.9,
    description: 'Warm evening dim — subtle and atmospheric',
  },
  midnight: {
    preset: 'midnight',
    presetIndex: 2,
    dimFactor: 0.4,
    vignetteStrength: 0.6,
    filmGrain: 0.04,
    invertMix: 1.0,
    bloomIntensity: 1.3,
    description: 'Cool night — medium vignette, channel invert, soft UV',
  },
  deep: {
    preset: 'deep',
    presetIndex: 3,
    dimFactor: 0.15,
    vignetteStrength: 0.85,
    filmGrain: 0.06,
    invertMix: 1.0,
    bloomIntensity: 2.0,
    description: 'OLED void — heavy vignette, amber glow, only active notes pop',
  },
};

export const DEFAULT_NIGHT_PRESET: NightPreset = 'midnight';

export const NIGHT_PRESET_OPTIONS: { value: NightPreset; label: string }[] = [
  { value: 'dusk',     label: '🌇 Dusk'       },
  { value: 'midnight', label: '🌙 Midnight'    },
  { value: 'deep',     label: '🌑 Deep Night'  },
];

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
