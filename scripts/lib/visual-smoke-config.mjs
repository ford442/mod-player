/**
 * Visual smoke matrix — shaders, renderers, lite modes, modules.
 *
 * Override via env (comma-separated unless noted):
 *   RENDERERS, SHADER_FILES, LITE_MODES (0|1), MODULE_URLS, SEEK_ROWS
 *   SMOKE_PROFILE=ci|full|quick
 */

/** @typedef {{ id: string, renderer: string, lite: 0|1, moduleUrl?: string, label?: string }} SmokeScenario */

export const DEFAULT_SEEK_ROWS = [0, 8, 16];

// ─── Coverage assertion config ───────────────────────────────────────────────
// Structural coverage assertions catch partial/misaligned renders (thin bands,
// scanline offsets, overlay misalignment) that the non-black check misses.
// See docs/VISUAL_SMOKE.md and scripts/lib/coverage-assert.mjs for details.

/**
 * Default coverage floors per layout type.
 *
 * Circular:   ring area (innerR 0.15 → outerR 0.45) split into 3 annuli × 4 sectors.
 *             Each sector must show ≥ 3% lit-pixel coverage when playing a module.
 * Horizontal: pattern grid rows/columns must be ≥ 2% lit.
 * Simple:     quadrant check for video / fallback shaders; lenient due to CI codec constraints.
 */
export const COVERAGE_DEFAULTS = {
  circular: {
    globalFloor: 0.02,        // 2% global   — catches solid-black (#346–#348)
    regionFloor: 0.03,        // 3% per ring sector — catches thin bands (#349)
    bboxSpanMinX: 0.25,       // 25% width   — catches systematic H-offsets (#351)
    bboxSpanMinY: 0.25,       // 25% height  — catches systematic V-offsets
    centroidTolerance: 0.25,  // centroid within ±25% of centre — catches scanline offsets (#350)
  },
  horizontal: {
    globalFloor: 0.02,
    regionFloor: 0.02,        // Horizontal bands can be legitimately thinner
    bboxSpanMinX: 0.40,       // Horizontal shaders should span most of the width
    bboxSpanMinY: 0.20,
    centroidTolerance: 0.30,
  },
  simple: {
    globalFloor: 0.005,       // Very low — video shaders may be sparse under CI/headless
    regionFloor: 0.005,
    bboxSpanMinX: 0.10,
    bboxSpanMinY: 0.10,
    centroidTolerance: 0.45,  // Video shaders can be legitimately asymmetric
  },
};

/**
 * Per-shader overrides applied on top of the layout-type defaults.
 * Only specify fields that differ from the layout default.
 *
 * Historical regression targets:
 *   #346–#348  v0.52/53/54 solid-black night trio
 *   #349       v0.24 Tunnel thin horizontal band
 *   #350       v0.23 Clouds scanline vertical offset
 *   #351       WebGL2 hybrid overlay misalignment
 */
export const COVERAGE_SHADER_OVERRIDES = {
  // Night trio (v0.52–v0.54): dark background; ring area must still be lit.
  // Uses circular defaults (3% regionFloor) — no additional leniency needed.
  'patternv0.52.wgsl': {},
  'patternv0.53.wgsl': {},
  'patternv0.54.wgsl': {},
  // v0.55 Oscilloscope: trace can be sparse on some rows
  'patternv0.55.wgsl': { regionFloor: 0.02 },
  // v0.56 Instrument palette: binding 7 texture; ring coverage can vary by song
  'patternv0.56.wgsl': { regionFloor: 0.02 },
  // v0.23 Clouds — full-screen video, scanline offset risk (#350)
  'patternv0.23.wgsl': { bboxSpanMinX: 0.20, bboxSpanMinY: 0.20 },
  // v0.24 Tunnel — thin-band risk (#349)
  'patternv0.24.wgsl': { bboxSpanMinX: 0.20, bboxSpanMinY: 0.20 },
};

/**
 * Derive layout type from shader filename for coverage config selection.
 * Mirrors layoutFromShader in coverage-assert.mjs without introducing an import
 * (keeps this config file dependency-free for easy review in PRs).
 *
 * @param {string} shaderFile
 * @returns {'circular' | 'horizontal' | 'simple'}
 */
function layoutTypeForCoverage(shaderFile) {
  if (/v0\.(21|39|40|43|44)\.wgsl$/.test(shaderFile)) return 'horizontal';
  if (/v0\.(23|24)\.wgsl$/.test(shaderFile)) return 'simple';
  return 'circular';
}

/**
 * Get the merged coverage assertion config for a given shader.
 * Combines the layout default with any per-shader override.
 *
 * @param {string} shaderFile
 * @returns {{ globalFloor: number, regionFloor: number,
 *             bboxSpanMinX: number, bboxSpanMinY: number,
 *             centroidTolerance: number }}
 */
export function coverageConfigForShader(shaderFile) {
  const layout = layoutTypeForCoverage(shaderFile);
  const defaults = COVERAGE_DEFAULTS[layout] ?? COVERAGE_DEFAULTS.circular;
  const overrides = COVERAGE_SHADER_OVERRIDES[shaderFile] ?? {};
  return { ...defaults, ...overrides };
}

export const DEFAULT_MODULES = {
  mod: '/4-mat_madness.mod',
  xm: '/test.xm',
};

/** Full backlog verification matrix (local / nightly). */
export const FULL_SHADER_FILES = [
  'patternv0.30b.wgsl',
  'patternv0.46.wgsl',
  'patternv0.47.wgsl',
  'patternv0.48.wgsl',
  'patternv0.50.wgsl',
  'patternv0.55.wgsl',
  'patternv0.56.wgsl',
  'patternv0.57.wgsl',
];

// CI shader set — representative subset per layout class + historical regression targets.
//
// Layout coverage:
//   circular:   v0.50, v0.46, v0.30b — baseline ring, row-paging, note-on sustain
//   horizontal: (tested via lite-mode v0.21 substitution path)
//   simple/video: v0.23 Clouds (#350 scanline offset), v0.24 Tunnel (#349 thin band)
//
// Regression guards:
//   v0.52–v0.54 Night trio (#346–#348 solid-black)
//   v0.55 Oscilloscope (#347 blank)
//   v0.56 Instrument Palette (#347)
//   v0.57 Velocity LEDs
//
// NOTE: CI uses HTML pattern grid (WebGL2 shader viz deferred this phase).
// WGSL night-theme / oscilloscope / instrument-palette paths are verified under
// SMOKE_PROFILE=full with WebGPU (--enable-unsafe-webgpu). HTML smoke still
// catches severe mount/play regressions without starting a GLSL session.
export const CI_SHADER_FILES = [
  'patternv0.30b.wgsl',
  'patternv0.46.wgsl',
  'patternv0.50.wgsl',
  'patternv0.52.wgsl',
  'patternv0.53.wgsl',
  'patternv0.54.wgsl',
  'patternv0.55.wgsl',
  'patternv0.56.wgsl',
  'patternv0.57.wgsl',
  // Historical regression targets — video/procedural shaders:
  'patternv0.23.wgsl',
  'patternv0.24.wgsl',
];

export const QUICK_SHADER_FILES = ['patternv0.40.wgsl', 'patternv0.50.wgsl'];

export function parseProfile() {
  return (process.env.SMOKE_PROFILE || 'full').toLowerCase();
}

export function shadersForProfile(profile) {
  if (process.env.SHADER_FILES) {
    return process.env.SHADER_FILES.split(',').map((s) => s.trim()).filter(Boolean);
  }
  switch (profile) {
    case 'ci':
      return [...CI_SHADER_FILES];
    case 'quick':
      return [...QUICK_SHADER_FILES];
    default:
      return [...FULL_SHADER_FILES];
  }
}

export function renderersForProfile(profile) {
  if (process.env.RENDERERS) {
    return process.env.RENDERERS.split(',').map((s) => s.trim()).filter(Boolean);
  }
  // WebGL2 shader viz is deferred: GPU sessions require WebGPU; HTML is DOM tracker UI.
  if (profile === 'ci') return ['html'];
  return ['html', 'webgpu'];
}

export function liteModesForProfile(profile) {
  if (process.env.LITE_MODES) {
    return process.env.LITE_MODES.split(',').map((s) => Number(s.trim())).filter((n) => n === 0 || n === 1);
  }
  if (profile === 'ci') return [0];
  return [0, 1];
}

export function modulesForProfile(profile) {
  if (process.env.MODULE_URLS) {
    return process.env.MODULE_URLS.split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (profile === 'ci') return [DEFAULT_MODULES.mod];
  return [DEFAULT_MODULES.mod, DEFAULT_MODULES.xm];
}

export function buildScenarioMatrix(baseUrl) {
  const profile = parseProfile();
  const shaders = shadersForProfile(profile);
  const renderers = renderersForProfile(profile);
  const liteModes = liteModesForProfile(profile);
  const modules = modulesForProfile(profile);
  const seekRows = (process.env.SEEK_ROWS || DEFAULT_SEEK_ROWS.join(','))
    .split(',')
    .map(Number)
    .filter((n) => !Number.isNaN(n));

  /** @type {SmokeScenario[]} */
  const scenarios = [];
  for (const modulePath of modules) {
    const moduleUrl = modulePath.startsWith('http') ? modulePath : `${baseUrl}${modulePath}`;
    for (const renderer of renderers) {
      for (const lite of liteModes) {
        if (lite === 1) {
          // ?lite=1 forces v0.21 substitution — one scenario per renderer/module.
          scenarios.push({
            id: `${renderer}-lite1-smoke`,
            renderer,
            lite,
            shaderFile: 'patternv0.50.wgsl',
            moduleUrl,
            seekRows,
            label: 'lite mode (stored v0.50 → display v0.21)',
          });
          continue;
        }
        for (const shaderFile of shaders) {
          scenarios.push({
            id: `${renderer}-lite0-${basename(shaderFile)}`,
            renderer,
            lite,
            shaderFile,
            moduleUrl,
            seekRows,
          });
        }
      }
    }
  }
  return { profile, scenarios, shaders, renderers, liteModes, modules, seekRows };
}

function basename(file) {
  return file.replace(/\.wgsl$/, '').replace('pattern', '');
}

export const CONSOLE_FAIL_PATTERNS = [
  /BOUNDS VIOLATION/i,
  /CELL COUNT MISMATCH/i,
  /buffer size mismatch/i,
  /INVARIANT.*FAIL/i,
  /Failed to initialize WebGPU/i,
  /Shader compilation failed/i,
  /GL Link Error/i,
];

export const CONSOLE_WARN_PATTERNS = [
  /WebGPU not available/i,
  /falling back/i,
  /DEVICE-LOST/i,
];
