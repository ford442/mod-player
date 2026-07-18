/**
 * Shader registry tests — every SHADER_GROUPS id must be registered and
 * helpers must agree with ShaderMeta.
 *
 * Run: npm run test:shader-registry
 *   or: node utils/__debug__/shaderRegistry.test.cjs
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const UTILS_DIR = path.resolve(__dirname, '..');
const ROOT = path.resolve(UTILS_DIR, '..');

function runTsx(label, script) {
  const tmpFile = path.join(os.tmpdir(), `shader-test-${Date.now()}-${Math.random().toString(36).slice(2)}.ts`);
  fs.writeFileSync(tmpFile, script, 'utf8');
  try {
    const result = spawnSync(
      'npx', ['--yes', 'tsx', tmpFile],
      { cwd: ROOT, encoding: 'utf8', timeout: 60000 },
    );
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) {
      const lines = result.stderr.split('\n').filter((l) =>
        !l.includes('ExperimentalWarning') && !l.includes('npm warn') && l.trim(),
      );
      if (lines.length) process.stderr.write(lines.join('\n') + '\n');
    }
    if (result.status !== 0) {
      console.error(`\nFAILED: ${label}`);
      process.exit(1);
    }
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// 1. Registry consistency + SHADER_GROUPS coverage
// ---------------------------------------------------------------------------
runTsx('Registry + SHADER_GROUPS coverage', `
(async () => {
  (globalThis as any).window = { location: { search: '' }, name: '' };

  const { SHADER_REGISTRY, resolveShaderMeta } = await import('${UTILS_DIR}/shaderRegistry.ts');
  const {
    WEBGL_HYBRID_SHADERS,
    getLayoutType,
    isSinglePassCompositeShader,
    isCircularLayoutShader,
    getBackgroundShaderFile,
    shouldEnableAlphaBlending,
    supportsStepsLength,
    usesHighPrecisionPacking,
    usesPlayheadRowAsFloat,
    usesPadTopChannel,
    usesStrictPlayheadSustainMode,
    usesOscilloscope,
    usesInstrumentPalette,
    usesAudioReactive,
    getHitTestProfile,
    usesCircularRowPaging,
    isHorizontalLayoutShader,
    needsChassisControlFields,
    usesWebGLOverlayHorizontal,
    hasEmbeddedTransportUI,
  } = await import('${UTILS_DIR}/shaderVersion.ts');
  const { getLayoutModeFromShader, LAYOUT_MODES } = await import('${UTILS_DIR}/geometryConstants.ts');
  const { SHADER_GROUPS, ALL_SHADER_IDS, DEFAULT_SHADER } = await import('${ROOT}/appConfig.ts');

  const errors: string[] = [];

  for (const group of Object.values(SHADER_GROUPS)) {
    for (const { id } of group as { id: string }[]) {
      if (!SHADER_REGISTRY[id]) {
        errors.push(\`SHADER_GROUPS id "\${id}" is not in SHADER_REGISTRY\`);
      }
    }
  }

  if (!SHADER_REGISTRY[DEFAULT_SHADER]) {
    errors.push(\`DEFAULT_SHADER "\${DEFAULT_SHADER}" missing from registry\`);
  }

  const PARITY = [
    'patternv0.21.wgsl', 'patternv0.30b.wgsl', 'patternv0.40.wgsl',
    'patternv0.50.wgsl', 'patternv0.51.wgsl', 'patternv0.52.wgsl',
    'patternv0.53.wgsl', 'patternv0.54.wgsl', 'patternv0.55.wgsl',
    'patternv0.56.wgsl', 'patternv0.57.wgsl', 'patternv0.58.wgsl',
  ];
  for (const id of PARITY) {
    if (!SHADER_REGISTRY[id]) errors.push(\`parity target missing: \${id}\`);
  }

  for (const [filename, meta] of Object.entries(SHADER_REGISTRY)) {
    if (WEBGL_HYBRID_SHADERS.has(filename) !== meta.webglHybrid)
      errors.push(\`\${filename}: webglHybrid mismatch\`);
    const expectedLayout = meta.extendedLayout ? 'extended' : 'standard';
    if (getLayoutType(filename) !== expectedLayout)
      errors.push(\`\${filename}: layout — expected \${expectedLayout}\`);
    if (isCircularLayoutShader(filename) !== meta.circular)
      errors.push(\`\${filename}: circular mismatch\`);
    if (getBackgroundShaderFile(filename) !== meta.background)
      errors.push(\`\${filename}: background mismatch\`);
    if (shouldEnableAlphaBlending(filename) !== meta.alphaBlending)
      errors.push(\`\${filename}: alphaBlending mismatch\`);
    if (isSinglePassCompositeShader(filename) !== meta.singlePassComposite)
      errors.push(\`\${filename}: singlePassComposite mismatch\`);
    if (supportsStepsLength(filename) !== meta.supportsStepsLength)
      errors.push(\`\${filename}: supportsStepsLength mismatch\`);
    if (usesHighPrecisionPacking(filename) !== meta.highPrecisionPacking)
      errors.push(\`\${filename}: highPrecisionPacking mismatch\`);
    if (usesPlayheadRowAsFloat(filename) !== meta.playheadRowAsFloat)
      errors.push(\`\${filename}: playheadRowAsFloat mismatch\`);
    if (usesPadTopChannel(filename) !== meta.padTopChannel)
      errors.push(\`\${filename}: padTopChannel mismatch\`);
    if (usesStrictPlayheadSustainMode(filename) !== meta.strictPlayheadSustain)
      errors.push(\`\${filename}: strictPlayheadSustain mismatch\`);
    if (usesOscilloscope(filename) !== meta.oscilloscope)
      errors.push(\`\${filename}: oscilloscope mismatch\`);
    if (usesInstrumentPalette(filename) !== meta.instrumentPalette)
      errors.push(\`\${filename}: instrumentPalette mismatch\`);
    if (usesAudioReactive(filename) !== meta.audioReactive)
      errors.push(\`\${filename}: audioReactive mismatch\`);
    if (getHitTestProfile(filename) !== meta.hitTestProfile)
      errors.push(\`\${filename}: hitTestProfile mismatch\`);
    if (usesCircularRowPaging(filename) !== meta.circularRowPaging)
      errors.push(\`\${filename}: circularRowPaging mismatch\`);
    if (isHorizontalLayoutShader(filename) !== (meta.layoutMode === 'horizontal_32'))
      errors.push(\`\${filename}: isHorizontal mismatch\`);
    if (needsChassisControlFields(filename) !== (meta.chassisControlEncoding !== 'none'))
      errors.push(\`\${filename}: needsChassisControlFields mismatch\`);
    if (usesWebGLOverlayHorizontal(filename) !== meta.webglOverlayHorizontal)
      errors.push(\`\${filename}: webglOverlayHorizontal mismatch\`);
    if (hasEmbeddedTransportUI(filename) !== (meta.hitTestProfile !== 'none'))
      errors.push(\`\${filename}: hasEmbeddedTransportUI mismatch\`);
    const expectedMode = meta.layoutMode === 'horizontal_32'
      ? LAYOUT_MODES.HORIZONTAL_32 : LAYOUT_MODES.CIRCULAR;
    if (getLayoutModeFromShader(filename) !== expectedMode)
      errors.push(\`\${filename}: layoutMode helper mismatch\`);
    if (meta.singlePassComposite && meta.singlePassComposite !== meta.background)
      errors.push(\`\${filename}: singlePassComposite != background\`);
    if (resolveShaderMeta(filename).canvasSize.width !== meta.canvasSize.width)
      errors.push(\`\${filename}: resolve canvasSize mismatch\`);
  }

  const m21 = SHADER_REGISTRY['patternv0.21.wgsl']!;
  if (!m21.liteRecommended || !m21.webglHybrid || !m21.padTopChannel || !m21.webglOverlayHorizontal)
    errors.push('v0.21 parity fields');
  const m30b = SHADER_REGISTRY['patternv0.30b.wgsl']!;
  if (!m30b.strictPlayheadSustain || !m30b.highPrecisionPacking)
    errors.push('v0.30b parity fields');
  const m40 = SHADER_REGISTRY['patternv0.40.wgsl']!;
  if (m40.hitTestProfile !== 'square-ui' || !m40.bareCanvasChrome)
    errors.push('v0.40 parity fields');
  const m50 = SHADER_REGISTRY['patternv0.50.wgsl']!;
  if (!m50.stepsDrivenVisibleRows || m50.bloomProfile !== 'three-emitter')
    errors.push('v0.50 parity fields');
  if (!SHADER_REGISTRY['patternv0.55.wgsl']!.oscilloscope) errors.push('v0.55 oscilloscope');
  if (!SHADER_REGISTRY['patternv0.56.wgsl']!.instrumentPalette) errors.push('v0.56 instrumentPalette');
  if (!SHADER_REGISTRY['patternv0.57.wgsl']!.stepsDrivenVisibleRows) errors.push('v0.57 stepsDriven');
  if (!SHADER_REGISTRY['patternv0.58.wgsl']!.audioReactive) errors.push('v0.58 audioReactive');

  for (const id of ALL_SHADER_IDS) {
    if (!SHADER_REGISTRY[id]) errors.push(\`ALL_SHADER_IDS has unregistered \${id}\`);
  }

  if (errors.length > 0) {
    console.error('REGISTRY FAILURES:');
    errors.forEach((e) => console.error('  ' + e));
    process.exit(1);
  }
  console.log('Registry + SHADER_GROUPS: OK (' + Object.keys(SHADER_REGISTRY).length + ' shaders, ' + ALL_SHADER_IDS.size + ' UI ids)');
})().catch((e) => { console.error(e); process.exit(1); });
`);

// ---------------------------------------------------------------------------
// 2. Bloom profile consistency
// ---------------------------------------------------------------------------
runTsx('Bloom profile consistency', `
import { SHADER_REGISTRY } from '${UTILS_DIR}/shaderRegistry.ts';
import { BLOOM_PROFILES } from '${UTILS_DIR}/bloomProfiles.ts';

const errors: string[] = [];

for (const [filename, meta] of Object.entries(SHADER_REGISTRY)) {
  if (meta.bloomProfile !== null && !(meta.bloomProfile in BLOOM_PROFILES)) {
    errors.push(\`\${filename}: bloomProfile "\${meta.bloomProfile}" not in BLOOM_PROFILES\`);
  }
}

for (const [id, layers] of Object.entries(BLOOM_PROFILES)) {
  if (layers.length !== 3) {
    errors.push(\`BLOOM_PROFILES["\${id}"]: expected 3 layers, got \${layers.length}\`);
  }
}

const expected: Record<string, string> = {
  'patternv0.50.wgsl': 'three-emitter',
  'patternv0.50b.wgsl': 'three-emitter',
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
  errors.forEach((e) => console.error('  ' + e));
  process.exit(1);
}
console.log('Bloom profile consistency: OK');
`);

// ---------------------------------------------------------------------------
// 3. computeNoteAges high-note coverage
// ---------------------------------------------------------------------------
runTsx('computeNoteAges note range', `
import { computeNoteAges } from '${UTILS_DIR}/patternExtractor.ts';
import type { PatternMatrix } from '${ROOT}/types.ts';

const errors: string[] = [];
const emptyCell = { type: 'empty' as const, text: '', note: 0, inst: 0, volCmd: 0, volVal: 0, effCmd: 0, effVal: 0 };
const emptyRows = Array.from({ length: 63 }, () => [{ ...emptyCell }]);

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
  errors.forEach((e) => console.error('  ' + e));
  process.exit(1);
}
console.log('computeNoteAges note range: OK');
`);

console.log('All shader registry tests passed.');

// ---------------------------------------------------------------------------
// 4. Guard: no new shaderFile.includes('v0.XX') chains in production render path
// ---------------------------------------------------------------------------
const FORBIDDEN_SCAN_DIRS = [
  path.join(ROOT, 'components'),
  path.join(ROOT, 'hooks'),
  path.join(ROOT, 'src/renderers'),
  path.join(ROOT, 'utils/geometryConstants.ts'),
];
const FORBIDDEN_RE = /shaderFile\.includes\s*\(\s*['"]v0\./;
const allowlist = new Set([
  path.join(ROOT, 'utils/shaderRegistry.ts'), // inferLegacyMeta only
]);
const chainErrors = [];
function scanFile(filePath) {
  if (allowlist.has(filePath)) return;
  const rel = path.relative(ROOT, filePath);
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split('\n')) {
    if (FORBIDDEN_RE.test(line) && !line.trimStart().startsWith('//') && !line.includes('Do **not**')) {
      chainErrors.push(`${rel}: forbidden includes chain — use shaderRegistry: ${line.trim().slice(0, 80)}`);
    }
  }
}
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  const stat = fs.statSync(dir);
  if (stat.isFile()) {
    if (/\.(ts|tsx)$/.test(dir)) scanFile(dir);
    return;
  }
  for (const entry of fs.readdirSync(dir)) {
    walk(path.join(dir, entry));
  }
}
for (const target of FORBIDDEN_SCAN_DIRS) walk(target);
if (chainErrors.length > 0) {
  console.error('FORBIDDEN includes() CHAINS:');
  chainErrors.forEach((e) => console.error('  ' + e));
  process.exit(1);
}
console.log('No forbidden shaderFile.includes chains in render path: OK');
