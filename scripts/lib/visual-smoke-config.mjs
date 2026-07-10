/**
 * Visual smoke matrix — shaders, renderers, lite modes, modules.
 *
 * Override via env (comma-separated unless noted):
 *   RENDERERS, SHADER_FILES, LITE_MODES (0|1), MODULE_URLS, SEEK_ROWS
 *   SMOKE_PROFILE=ci|full|quick
 */

/** @typedef {{ id: string, renderer: string, lite: 0|1, moduleUrl?: string, label?: string }} SmokeScenario */

export const DEFAULT_SEEK_ROWS = [0, 8, 16];

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

export const CI_SHADER_FILES = [
  'patternv0.30b.wgsl',
  'patternv0.46.wgsl',
  'patternv0.50.wgsl',
  'patternv0.57.wgsl',
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
  if (profile === 'ci') return ['webgl2', 'html'];
  return ['webgl2', 'html', 'webgpu'];
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
