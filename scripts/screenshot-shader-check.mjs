#!/usr/bin/env node
/**
 * Legacy alias — forwards to scripts/visual-smoke.mjs with screenshot-oriented defaults.
 * Prefer: npm run smoke:visual
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const env = {
  ...process.env,
  OUTPUT_DIR: process.env.OUTPUT_DIR || '/tmp/mod-player-screenshots',
  SMOKE_PROFILE: process.env.SMOKE_PROFILE || 'quick',
};

if (!process.env.SHADER_FILES && !process.env.SMOKE_PROFILE) {
  env.SHADER_FILES = 'patternv0.40.wgsl,patternv0.50.wgsl,patternv0.55.wgsl';
}

const result = spawnSync(process.execPath, [join(here, 'visual-smoke.mjs')], {
  stdio: 'inherit',
  env,
});
process.exit(result.status ?? 1);
