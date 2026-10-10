#!/usr/bin/env node
/**
 * Compiles the typed AudioWorklet processors from TypeScript.
 *
 * AudioWorklet classic scripts cannot reliably import() across every target
 * we support, so each *output* stays a single classic script — only the
 * *sources* are TypeScript. Each entry in ENTRIES bundles one processor (plus
 * the DOM-free modules it imports) into public/worklets/.
 *
 * Cache-busting: each entry writes a content hash of its built output to its
 * own `*.generated.json` (e.g. hooks/useWorkletLoader.ts imports
 * audio-worklet/js/worklet-version.generated.json for its `?v=` query param).
 * The version only changes when that processor actually changes
 * (deterministic — safe for the freshness gate below).
 *
 * `--check` builds in memory and compares against the committed files instead of writing them,
 * exiting 1 when any differ (`npm run verify:js-worklet-fresh`, part of `npm run preflight`).
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

/** One row per generated worklet. Paths are repo-relative. */
const ENTRIES = [
  {
    entry: 'audio-worklet/js/openmpt-processor.ts',
    outfile: 'public/worklets/openmpt-worklet.js',
    versionFile: 'audio-worklet/js/worklet-version.generated.json',
  },
];

/** @param {string} entry */
function bannerFor(entry) {
  return [
    '// generated — do not edit.',
    `// Source: ${entry}`,
    '// Regenerate with: npm run build:js-worklet',
  ].join('\n');
}

/**
 * @param {{ entry: string, outfile: string, versionFile: string }} spec
 * @returns {Promise<{ outfile: string, versionFile: string, code: string, versionJson: string, version: string }>}
 */
async function buildEntry({ entry, outfile, versionFile }) {
  const outPath = join(ROOT, outfile);
  const result = await esbuild.build({
    entryPoints: [join(ROOT, entry)],
    outfile: outPath,
    bundle: true,
    format: 'iife',
    target: 'es2020',
    platform: 'browser',
    minify: false,
    write: false,
    legalComments: 'none',
    banner: { js: bannerFor(entry) },
  });

  const output = result.outputFiles.find((f) => f.path === outPath);
  if (!output) {
    throw new Error(`esbuild did not produce ${outPath}`);
  }
  const code = output.text;

  // Content hash — NOT a timestamp. A build must be a no-op (empty git diff)
  // when the processor source hasn't changed, or the freshness gate would never be green.
  const version = createHash('sha256').update(code).digest('hex').slice(0, 10);
  const versionJson = JSON.stringify({ version }, null, 2) + '\n';
  return { outfile, versionFile, code, versionJson, version };
}

async function main() {
  const built = [];
  for (const spec of ENTRIES) built.push(await buildEntry(spec));

  if (process.argv.includes('--check')) {
    const stale = built.flatMap(({ outfile, versionFile, code, versionJson }) =>
      [
        [outfile, code],
        [versionFile, versionJson],
      ].filter(([rel, expected]) => {
        const path = join(ROOT, rel);
        return !existsSync(path) || readFileSync(path, 'utf8') !== expected;
      }),
    );
    if (stale.length > 0) {
      console.error('❌ generated JS worklets are out of date with audio-worklet/ sources:');
      for (const [rel] of stale) console.error(`   - ${rel}`);
      console.error('   Run `npm run build:js-worklet` and commit the result.');
      process.exit(1);
    }
    for (const { outfile, version } of built) console.log(`✅ ${outfile} is up to date (version ${version})`);
    return;
  }

  for (const { outfile, versionFile, code, versionJson, version } of built) {
    const outPath = join(ROOT, outfile);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, code);
    writeFileSync(join(ROOT, versionFile), versionJson);
    console.log(`✅ Built ${outfile} (${code.length} bytes, version ${version})`);
  }
}

main().catch((err) => {
  console.error('❌ build-js-worklet failed:', err);
  process.exit(1);
});
