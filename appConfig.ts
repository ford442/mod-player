// Shader Definitions

/** Production / public-build default — Note-On Disc circular visualizer. */
export const PUBLIC_DEFAULT_SHADER = 'patternv0.30b.wgsl';

export const DEFAULT_SHADER = PUBLIC_DEFAULT_SHADER;

/** Full dev catalog — every registered picker shader. */
export const SHADER_GROUPS_ALL = {
  SQUARE: [
    { id: 'patternv0.44.wgsl', label: 'v0.44 (Frosted Wall 64)' },
    { id: 'patternv0.43.wgsl', label: 'v0.43 (Frosted Wall 32)' },
    { id: 'patternv0.40.wgsl', label: 'v0.40 (Frosted Grid)' },
    { id: 'patternv0.39.wgsl', label: 'v0.39 (Modern)' },
    { id: 'patternv0.21.wgsl', label: 'v0.21 (Wall)' },
  ],
  CIRCULAR: [
    { id: 'patternv0.50.wgsl', label: 'v0.50 (Trap Frosted Lens)' },
    { id: 'patternv0.50b.wgsl', label: 'v0.50b (Hybrid Frosted Lens)' },
    { id: 'patternv0.51.wgsl', label: 'v0.51 (Playhead Arc)' },
    { id: 'patternv0.52.wgsl', label: 'v0.52 (Night)' },
    { id: 'patternv0.53.wgsl', label: 'v0.53 (Midnight)' },
    { id: 'patternv0.54.wgsl', label: 'v0.54 (Neon Night)' },
    { id: 'patternv0.58.wgsl', label: 'v0.58 (Reactive Chassis)' },
    { id: 'patternv0.57.wgsl', label: 'v0.57 (Velocity LED)' },
    { id: 'patternv0.59.wgsl', label: 'v0.59 (Instrument Highlight)' },
    { id: 'patternv0.56.wgsl', label: 'v0.56 (Instrument Palette)' },
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
    { id: PUBLIC_DEFAULT_SHADER, label: 'v0.30b (Note-On Disc)' },
  ],
  VIDEO: [
    { id: 'patternv0.23.wgsl', label: 'v0.23 (Clouds)' },
    { id: 'patternv0.24.wgsl', label: 'v0.24 (Tunnel)' },
  ],
} as const;

/** Public / demo build — single production shader. */
export const SHADER_GROUPS_PUBLIC = {
  SQUARE: [] as const,
  CIRCULAR: [
    { id: PUBLIC_DEFAULT_SHADER, label: 'Note-On Disc' },
  ],
  VIDEO: [] as const,
} as const;

// Public / demo mode — evaluated once at module load from URL params.
const _urlParams = new URLSearchParams(
  typeof window !== 'undefined' ? window.location.search : '',
);

export const IS_PUBLIC_MODE =
  _urlParams.get('public') === '1' || _urlParams.get('demo') === '1';

/** Expose full shader catalog in public builds (`?shaderDebug=1` or localStorage). */
export const IS_SHADER_DEBUG = (() => {
  if (_urlParams.get('shaderDebug') === '1' || _urlParams.get('debugShaders') === '1') {
    return true;
  }
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem('xasm1_shader_debug') === '1';
  } catch {
    return false;
  }
})();

const _showAllShaders = IS_SHADER_DEBUG || !IS_PUBLIC_MODE;

export const SHADER_GROUPS = _showAllShaders ? SHADER_GROUPS_ALL : SHADER_GROUPS_PUBLIC;

export const ALL_SHADER_OPTIONS = [
  ...SHADER_GROUPS.SQUARE.map(s => ({ ...s, group: 'Square' as const })),
  ...SHADER_GROUPS.CIRCULAR.map(s => ({ ...s, group: 'Circular' as const })),
  ...SHADER_GROUPS.VIDEO.map(s => ({ ...s, group: 'Video' as const })),
];
export const AVAILABLE_SHADERS = ALL_SHADER_OPTIONS;

// Full registered shader set (share URLs, localStorage validation, registry tests).
export const ALL_SHADER_IDS = new Set<string>([
  ...SHADER_GROUPS_ALL.SQUARE.map(s => s.id),
  ...SHADER_GROUPS_ALL.CIRCULAR.map(s => s.id),
  ...SHADER_GROUPS_ALL.VIDEO.map(s => s.id),
]);

/** Picker-visible shader IDs (public mode exposes v0.30b only unless shaderDebug). */
export const PICKER_SHADER_IDS = new Set<string>(
  AVAILABLE_SHADERS.map(s => s.id),
);

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

// Project-M embed / audio-only mode — evaluated once at module load.
// Activated by ?projectm=1 (or a bare ?projectm), or by being opened with
// window.name === 'mod-player' (the target name the Project-M host uses when
// launching this player as a popup/iframe). In this mode the player acts purely
// as a PCM feeder for the Project-M visualizer: the WebGPU/WebGL pattern display
// is skipped to free GPU budget for the host, and a compact transport-only UI is
// shown. The PCM bridge in utils/projectMBridge.ts auto-activates independently
// whenever an opener/parent is present, so audio forwarding does not depend on
// this flag. Value doesn't change during the page lifecycle.
export const IS_PROJECTM_EMBED =
  _urlParams.get('projectm') === '1' ||
  _urlParams.has('projectm') ||
  (typeof window !== 'undefined' && window.name === 'mod-player');
