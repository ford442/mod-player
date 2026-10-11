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
 * changes (deterministic — safe for the freshness gate below).
 *
 * `--check` builds in memory and compares against the committed files instead of writing them,
 * exiting 1 when they differ (`npm run verify:js-worklet-fresh`, part of `npm run preflight`).
 * Unlike `build && git diff --exit-code` it ignores unrelated working-tree changes and can't be
 * satisfied trivially by having just regenerated the files.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

  // Content hash — NOT a timestamp. A build must be a no-op (empty git diff)
  // when the processor source hasn't changed, or the freshness gate would never be green.
  const version = createHash('sha256').update(code).digest('hex').slice(0, 10);
  const versionJson = JSON.stringify({ version }, null, 2) + '\n';

  if (process.argv.includes('--check')) {
    const stale = [
      [OUTFILE, code],
      [VERSION_FILE, versionJson],
    ].filter(([path, expected]) => !existsSync(path) || readFileSync(path, 'utf8') !== expected);
    if (stale.length > 0) {
      console.error('❌ generated JS worklet is out of date with audio-worklet/js/ sources:');
      for (const [path] of stale) console.error(`   - ${path.replace(ROOT + '/', '')}`);
      console.error('   Run `npm run build:js-worklet` and commit the result.');
      process.exit(1);
    }
    console.log(`✅ ${OUTFILE.replace(ROOT + '/', '')} is up to date (version ${version})`);
    return;
  }

  mkdirSync(dirname(OUTFILE), { recursive: true });
  writeFileSync(OUTFILE, code);
  writeFileSync(VERSION_FILE, versionJson);

  console.log(`✅ Built ${OUTFILE.replace(ROOT + '/', '')} (${code.length} bytes, version ${version})`);
}

main().catch((err) => {
  console.error('❌ build-js-worklet failed:', err);
  process.exit(1);
});
