#!/usr/bin/env node
/**
 * Compiles the JS AudioWorklet processor from TypeScript.
 *
 * AudioWorklet classic scripts cannot reliably import() across every target
 * we support, so the *output* stays a single classic script — only the
 * *source* moved to TypeScript. This bundles audio-worklet/js/openmpt-processor.ts
 * (which imports the shared audio-worklet/workletProtocolConstants.ts) into
 * public/worklets/openmpt-worklet.js.
 *
 * Cache-busting: hooks/useWorkletLoader.ts imports
 * audio-worklet/js/worklet-version.generated.json for its `?v=` query param
 * instead of a hand-maintained version comment list. The version is a content
 * hash of the built output, so it only changes when the processor actually
 * changes (deterministic — safe for the `git diff --exit-code` CI gate).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

const ENTRY = join(ROOT, 'audio-worklet/js/openmpt-processor.ts');
const OUTFILE = join(ROOT, 'public/worklets/openmpt-worklet.js');
const VERSION_FILE = join(ROOT, 'audio-worklet/js/worklet-version.generated.json');

const BANNER = [
  '// generated — do not edit.',
  '// Source: audio-worklet/js/openmpt-processor.ts',
  '// Regenerate with: npm run build:js-worklet',
].join('\n');

async function main() {
  const result = await esbuild.build({
    entryPoints: [ENTRY],
    outfile: OUTFILE,
    bundle: true,
    format: 'iife',
    target: 'es2020',
    platform: 'browser',
    minify: false,
    write: false,
    legalComments: 'none',
    banner: { js: BANNER },
  });

  const output = result.outputFiles.find((f) => f.path === OUTFILE);
  if (!output) {
    throw new Error(`esbuild did not produce ${OUTFILE}`);
  }
  const code = output.text;

  mkdirSync(dirname(OUTFILE), { recursive: true });
  writeFileSync(OUTFILE, code);

  // Content hash — NOT a timestamp. A build must be a no-op (empty git diff)
  // when the processor source hasn't changed, or the CI drift gate
  // (`npm run build:js-worklet && git diff --exit-code`) would never be green.
  const version = createHash('sha256').update(code).digest('hex').slice(0, 10);
  const versionJson = JSON.stringify({ version }, null, 2) + '\n';
  writeFileSync(VERSION_FILE, versionJson);

  console.log(`✅ Built ${OUTFILE.replace(ROOT + '/', '')} (${code.length} bytes, version ${version})`);
}

main().catch((err) => {
  console.error('❌ build-js-worklet failed:', err);
  process.exit(1);
});
