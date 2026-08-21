#!/usr/bin/env node
/**
 * Verify public/shaders/*.wgsl matches expandShader(source) — catches hand-edits / drift.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandShader } from './sync-shaders.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'shaders');
const DEST = join(ROOT, 'public/shaders');

/** Picker-listed pattern shaders (keep in sync with appConfig.ts SHADER_GROUPS). */
const PICKER_IDS = [
  'patternv0.44.wgsl', 'patternv0.43.wgsl', 'patternv0.40.wgsl', 'patternv0.39.wgsl', 'patternv0.21.wgsl',
  'patternv0.50.wgsl', 'patternv0.50b.wgsl', 'patternv0.51.wgsl', 'patternv0.52.wgsl', 'patternv0.53.wgsl',
  'patternv0.54.wgsl', 'patternv0.58.wgsl', 'patternv0.57.wgsl', 'patternv0.56.wgsl', 'patternv0.55.wgsl',
  'patternv0.49.wgsl', 'patternv0.48.wgsl', 'patternv0.47.wgsl', 'patternv0.46.wgsl', 'patternv0.45.wgsl',
  'patternv0.45b.wgsl', 'patternv0.42.wgsl', 'patternv0.38.wgsl', 'patternv0.35_bloom.wgsl', 'patternv0.30.wgsl',
  'patternv0.30b.wgsl', 'patternv0.23.wgsl', 'patternv0.24.wgsl',
];

/**
 * Non-picker entry shaders that are still fetched at runtime and must match
 * their expanded source (compute passes, chassis backgrounds are covered by the
 * residual-include sweep below).
 */
const ENTRY_IDS = [
  'compute_analysis.wgsl',
  'compute_note_duration.wgsl',
];

const failures = [];

for (const id of [...PICKER_IDS, ...ENTRY_IDS]) {
  const srcPath = join(SRC, id);
  const pubPath = join(DEST, id);
  if (!existsSync(srcPath) || !existsSync(pubPath)) {
    failures.push({ id, error: 'missing source or public copy' });
    continue;
  }
  const { flat } = expandShader(srcPath);
  const onDisk = readFileSync(pubPath, 'utf8');
  if (onDisk.replace(/\s+$/, '') !== flat.replace(/\s+$/, '')) {
    failures.push({ id, error: 'public/ does not match expandShader(source)' });
  }
}

// Residual-include sweep over every root entry shader, not just patternv*.
for (const name of readdirSync(SRC).filter((f) => f.endsWith('.wgsl'))) {
  try {
    const { flat } = expandShader(join(SRC, name));
    if (/^\s*\/\/\s*#include\s+"/m.test(flat)) {
      failures.push({ id: name, error: 'residual //#include in expanded output' });
    }
  } catch (e) {
    failures.push({ id: name, error: String(e) });
  }
}

if (failures.length) {
  console.error('[verify-shader-parity] FAIL');
  for (const f of failures) console.error(`  ${f.id}: ${f.error}`);
  process.exit(1);
}
console.log(
  `[verify-shader-parity] OK — ${PICKER_IDS.length} picker shaders, ${ENTRY_IDS.length} entry shaders`,
);
