// Shader Definitions

export const DEFAULT_SHADER = 'patternv0.50.wgsl';

export const SHADER_GROUPS = {
  SQUARE: [
    { id: 'patternv0.44.wgsl', label: 'v0.44 (Frosted Wall 64)' },
    { id: 'patternv0.43.wgsl', label: 'v0.43 (Frosted Wall 32)' },
    { id: 'patternv0.40.wgsl', label: 'v0.40 (Frosted Grid)' },
    { id: 'patternv0.39.wgsl', label: 'v0.39 (Modern)' },
    { id: 'patternv0.21.wgsl', label: 'v0.21 (Wall)' },
  ],
  CIRCULAR: [
    { id: 'patternv0.50.wgsl', label: 'v0.50 (Trap Frosted Lens)' },
    { id: 'patternv0.51.wgsl', label: 'v0.51 (Playhead Arc)' },
    { id: 'patternv0.55.wgsl', label: 'v0.55 (Oscilloscope)' },
    { id: 'patternv0.49.wgsl', label: 'v0.49 (Trap Frosted Glass)' },
    { id: 'patternv0.48.wgsl', label: 'v0.48 (Trap Frosted Disc)' },
    { id: 'patternv0.47.wgsl', label: 'v0.47 (Trap Frosted)' },
    { id: 'patternv0.46.wgsl', label: 'v0.46 (Frosted Glass)' },
    { id: 'patternv0.45.wgsl', label: 'v0.45 (Frosted Bloom)' },
    { id: 'patternv0.45b.wgsl', label: 'v0.45b (Note-On Sustain)' },
    { id: 'patternv0.42.wgsl', label: 'v0.42 (Frosted Disc)' },
    { id: 'patternv0.38.wgsl', label: 'v0.38 (Glass)' },
    { id: 'patternv0.35_bloom.wgsl', label: 'v0.35 (Bloom)' },
    { id: 'patternv0.30.wgsl', label: 'v0.30 (Disc)' },
  ],
  VIDEO: [
    { id: 'patternv0.23.wgsl', label: 'v0.23 (Clouds)' },
    { id: 'patternv0.24.wgsl', label: 'v0.24 (Tunnel)' },
  ]
};

export const ALL_SHADER_OPTIONS = [
  ...SHADER_GROUPS.SQUARE.map(s => ({ ...s, group: 'Square' as const })),
  ...SHADER_GROUPS.CIRCULAR.map(s => ({ ...s, group: 'Circular' as const })),
  ...SHADER_GROUPS.VIDEO.map(s => ({ ...s, group: 'Video' as const })),
];
export const AVAILABLE_SHADERS = ALL_SHADER_OPTIONS;

// Flat set of all valid shader IDs (used for localStorage validation)
export const ALL_SHADER_IDS = new Set<string>([
  ...AVAILABLE_SHADERS.map(s => s.id),
]);

// Available UI themes.
// Each theme value maps to a `data-theme` attribute on <html> and a CSS selector
// in index.css that overrides the --panel-*, --text-*, --edge-*, and --meter-* variables.
export type AppTheme = 'light' | 'dark' | 'precision' | 'amber-mono' | 'beige-classic';

/** Themes that use light backgrounds (isDarkMode = false for these). */
export const LIGHT_THEMES: ReadonlySet<AppTheme> = new Set(['light', 'beige-classic']);

export const THEME_OPTIONS: { value: AppTheme; label: string }[] = [
  { value: 'light',         label: '☀️ Light' },
  { value: 'dark',          label: '🌙 Dark' },
  { value: 'precision',     label: '🖤 Precision' },
  { value: 'amber-mono',    label: '🟡 Amber' },
  { value: 'beige-classic', label: '🤍 Classic' },
];

// Compute a fast, dependency-free hash from the first 16 bytes of a module buffer.
// Used as a stable per-module key for localStorage shader memory.
export function computeModuleHash(data: Uint8Array): string {
  return Array.from(data.slice(0, 16))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Public / demo mode — evaluated once at module load from URL params.
// Activated by ?public=1 or ?demo=1; value doesn't change during the page lifecycle.
const _urlParams = new URLSearchParams(window.location.search);
export const IS_PUBLIC_MODE = _urlParams.get('public') === '1' || _urlParams.get('demo') === '1';
