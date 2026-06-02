/**
 * Smoke-test: verifies that every registered shader's helpers return
 * self-consistent values, and that high-note cells (97–119) are correctly
 * handled by computeNoteAges.
 *
 * Run with:  node utils/__debug__/shaderRegistry.test.cjs
 */
const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const UTILS_DIR = path.resolve(__dirname, '..');

function runTsx(label, script) {
  const tmpFile = path.join(os.tmpdir(), `shader-test-${Date.now()}.ts`);
  fs.writeFileSync(tmpFile, script, 'utf8');
  try {
    const result = spawnSync(
      'npx', ['--yes', 'tsx', tmpFile],
      { cwd: UTILS_DIR, encoding: 'utf8', timeout: 30000 }
    );
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) {
      // Filter tsx startup noise, only show actual errors
      const lines = result.stderr.split('\n').filter(l =>
        !l.includes('ExperimentalWarning') && !l.includes('npm warn') && l.trim()
      );
      if (lines.length) process.stderr.write(lines.join('\n') + '\n');
    }
    if (result.status !== 0) {
      console.error(`\nFAILED: ${label}`);
      process.exit(1);
    }
  } finally {
    fs.unlinkSync(tmpFile);
  }
}

// ---------------------------------------------------------------------------
// 1. Registry consistency
// ---------------------------------------------------------------------------
runTsx('Registry consistency', `
import { SHADER_REGISTRY } from '${UTILS_DIR}/shaderRegistry.ts';
import {
  WEBGL_HYBRID_SHADERS,
  getLayoutType,
  isSinglePassCompositeShader,
  isCircularLayoutShader,
  getBackgroundShaderFile,
  shouldEnableAlphaBlending,
  supportsStepsLength,
} from '${UTILS_DIR}/shaderVersion.ts';
import { getLayoutModeFromShader, LAYOUT_MODES } from '${UTILS_DIR}/geometryConstants.ts';

const errors: string[] = [];

for (const [filename, meta] of Object.entries(SHADER_REGISTRY)) {
  const inSet = WEBGL_HYBRID_SHADERS.has(filename);
  if (inSet !== meta.webglHybrid)
    errors.push(\`\${filename}: webglHybrid mismatch — meta=\${meta.webglHybrid} set=\${inSet}\`);

  const gotLayout = getLayoutType(filename);
  const expectedLayout = meta.extendedLayout ? 'extended' : 'standard';
  if (gotLayout !== expectedLayout)
    errors.push(\`\${filename}: layout — expected \${expectedLayout} got \${gotLayout}\`);

  const gotCircular = isCircularLayoutShader(filename);
  if (gotCircular !== meta.circular)
    errors.push(\`\${filename}: circular — expected \${meta.circular} got \${gotCircular}\`);

  const gotBg = getBackgroundShaderFile(filename);
  if (gotBg !== meta.background)
    errors.push(\`\${filename}: background — expected \${meta.background} got \${gotBg}\`);

  const gotAlpha = shouldEnableAlphaBlending(filename);
  if (gotAlpha !== meta.alphaBlending)
    errors.push(\`\${filename}: alphaBlending — expected \${meta.alphaBlending} got \${gotAlpha}\`);

  const gotSingle = isSinglePassCompositeShader(filename);
  if (gotSingle !== meta.singlePassComposite)
    errors.push(\`\${filename}: singlePassComposite — expected \${String(meta.singlePassComposite)} got \${String(gotSingle)}\`);

  const gotSteps = supportsStepsLength(filename);
  if (gotSteps !== meta.supportsStepsLength)
    errors.push(\`\${filename}: supportsStepsLength — expected \${meta.supportsStepsLength} got \${gotSteps}\`);

  const expectedMode = meta.layoutMode === 'horizontal_32'
    ? LAYOUT_MODES.HORIZONTAL_32 : LAYOUT_MODES.CIRCULAR;
  const gotMode = getLayoutModeFromShader(filename);
  if (gotMode !== expectedMode)
    errors.push(\`\${filename}: layoutMode — expected \${expectedMode} got \${gotMode}\`);

  if (meta.singlePassComposite && meta.singlePassComposite !== meta.background)
    errors.push(\`\${filename}: singlePassComposite (\${meta.singlePassComposite}) != background (\${meta.background})\`);
}

if (errors.length > 0) {
  console.error('REGISTRY CONSISTENCY FAILURES:');
  errors.forEach(e => console.error('  ' + e));
  process.exit(1);
}
console.log('Registry consistency: OK (' + Object.keys(SHADER_REGISTRY).length + ' shaders)');
`);

// ---------------------------------------------------------------------------
// 3. Bloom profile consistency
// ---------------------------------------------------------------------------
runTsx('Bloom profile consistency', `
import { SHADER_REGISTRY } from '${UTILS_DIR}/shaderRegistry.ts';
import { BLOOM_PROFILES, getBloomProfile } from '${UTILS_DIR}/bloomProfiles.ts';

const errors: string[] = [];

// Every non-null bloomProfile in the registry must exist in BLOOM_PROFILES
for (const [filename, meta] of Object.entries(SHADER_REGISTRY)) {
  if (meta.bloomProfile !== null) {
    if (!(meta.bloomProfile in BLOOM_PROFILES)) {
      errors.push(\`\${filename}: bloomProfile "\${meta.bloomProfile}" not found in BLOOM_PROFILES\`);
    }
  }
}

// All profiles must have exactly 3 layers (required by BloomPostProcessor)
for (const [id, layers] of Object.entries(BLOOM_PROFILES)) {
  if (layers.length !== 3) {
    errors.push(\`BLOOM_PROFILES["\${id}"]: expected 3 layers, got \${layers.length}\`);
  }
  for (const layer of layers) {
    if (layer.threshold < 0 || layer.threshold > 1)
      errors.push(\`BLOOM_PROFILES["\${id}"]["\${layer.label}"]: threshold \${layer.threshold} out of [0,1]\`);
    if (layer.weight < 0 || layer.weight > 2)
      errors.push(\`BLOOM_PROFILES["\${id}"]["\${layer.label}"]: weight \${layer.weight} out of [0,2]\`);
    if (layer.blurRadius <= 0)
      errors.push(\`BLOOM_PROFILES["\${id}"]["\${layer.label}"]: blurRadius must be > 0\`);
  }
}

// Three-emitter shaders (v0.50, v0.51) must use 'three-emitter'
// Oscilloscope (v0.55) must use 'three-emitter-osc'
const expected: Record<string, string> = {
  'patternv0.50.wgsl': 'three-emitter',
  'patternv0.51.wgsl': 'three-emitter',
  'patternv0.55.wgsl': 'three-emitter-osc',
};
for (const [filename, profile] of Object.entries(expected)) {
  const actual = SHADER_REGISTRY[filename]?.bloomProfile;
  if (actual !== profile)
    errors.push(\`\${filename}: expected bloomProfile "\${profile}", got "\${String(actual)}"\`);
}

if (errors.length > 0) {
  console.error('BLOOM PROFILE FAILURES:');
  errors.forEach(e => console.error('  ' + e));
  process.exit(1);
}
console.log('Bloom profile consistency: OK (' + Object.keys(BLOOM_PROFILES).length + ' profiles)');
`);

// ---------------------------------------------------------------------------
// 2. computeNoteAges high-note coverage
// ---------------------------------------------------------------------------
runTsx('computeNoteAges note range', `
import { computeNoteAges } from '${UTILS_DIR}/patternExtractor.ts';
import type { PatternMatrix } from '${UTILS_DIR}/../types.ts';

const errors: string[] = [];

const emptyCell = { type: 'empty' as const, text: '', note: 0, inst: 0, volCmd: 0, volVal: 0, effCmd: 0, effVal: 0 };
const emptyRows = Array.from({ length: 63 }, () => [{ ...emptyCell }]);

// Notes 1–119 must register as note-on
for (let note = 1; note <= 119; note++) {
  const matrix: PatternMatrix = {
    order: 0, patternIndex: 0, numRows: 64, numChannels: 1,
    rows: [
      [{ type: 'note' as const, text: '', note, inst: 1, volCmd: 0, volVal: 0, effCmd: 0, effVal: 0 }],
      ...emptyRows,
    ],
  };
  const ages = computeNoteAges(matrix, 4);
  if (ages[0] === 1000)
    errors.push(\`note \${note}: returned 1000 (not recognised as note-on)\`);
}

// Note-off values must NOT register as note-on
for (const noteOff of [120, 254, 255]) {
  const matrix: PatternMatrix = {
    order: 0, patternIndex: 0, numRows: 64, numChannels: 1,
    rows: [
      [{ type: 'note' as const, text: '', note: noteOff, inst: 0, volCmd: 0, volVal: 0, effCmd: 0, effVal: 0 }],
      ...emptyRows,
    ],
  };
  const ages = computeNoteAges(matrix, 4);
  if (ages[0] !== 1000)
    errors.push(\`note-off \${noteOff}: returned \${ages[0]} (expected 1000)\`);
}

if (errors.length > 0) {
  console.error('NOTE AGE FAILURES:');
  errors.forEach(e => console.error('  ' + e));
  process.exit(1);
}
console.log('computeNoteAges note-on  [1–119]:         OK');
console.log('computeNoteAges note-off [120, 254, 255]: OK');
`);

console.log('\nAll shader registry tests passed.');
