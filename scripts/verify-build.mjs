#!/usr/bin/env node
/**
 * Post-build sanity checks for dist/ before deploy.
 *
 * Usage:
 *   node scripts/verify-build.mjs
 *   BUILD_DIR=dist node scripts/verify-build.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BUILD_DIR = process.env.BUILD_DIR || 'dist';
const PROJECT_NAME = process.env.PROJECT_NAME || 'xm-player';
const MIN_CSS_BYTES = Number(process.env.MIN_CSS_BYTES || 10000);

const errors = [];

function resolveAssetHref(href) {
  // Map index.html href to a path relative to dist/.
  // Handles all common forms Vite (or post-processing) may emit when
  // VITE_APP_BASE_PATH=/xm-player/ is active:
  //   /xm-player/assets/...
  //   xm-player/assets/...
  //   ./xm-player/assets/...
  //   ./assets/...
  //   /assets/...
  //   assets/...
  let path = (href || '').trim();
  // Strip leading ./ or / first
  if (path.startsWith('./')) {
    path = path.slice(2);
  } else if (path.startsWith('/')) {
    path = path.slice(1);
  }
  // Strip the project base prefix if present (handles "xm-player/..." variants)
  const pfx = `${PROJECT_NAME}/`;
  if (path.startsWith(pfx)) {
    path = path.slice(pfx.length);
  }
  // Final safety strip of any remaining leading slash
  if (path.startsWith('/')) {
    path = path.slice(1);
  }
  return path;
}

const indexPath = join(BUILD_DIR, 'index.html');
if (!existsSync(indexPath)) {
  console.error(`verify-build: missing ${indexPath}`);
  process.exit(1);
}

const html = readFileSync(indexPath, 'utf8');
const stylesheetHrefs = [
  ...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi),
].map((m) => m[1]);

if (stylesheetHrefs.length === 0) {
  errors.push('index.html has no <link rel="stylesheet">');
}

for (const href of stylesheetHrefs) {
  if (!href.endsWith('.css')) {
    errors.push(`stylesheet href must end with .css (got ${href})`);
    continue;
  }
  if (href.includes('.1iss')) {
    errors.push(`stale/corrupt stylesheet name: ${href}`);
    continue;
  }
  const rel = resolveAssetHref(href);
  const filePath = join(BUILD_DIR, rel);
  if (!existsSync(filePath)) {
    errors.push(`stylesheet file missing on disk: ${rel}`);
    continue;
  }
  const size = statSync(filePath).size;
  if (size < MIN_CSS_BYTES) {
    errors.push(`stylesheet ${rel} is only ${size} bytes (expected >= ${MIN_CSS_BYTES})`);
  }
  const head = readFileSync(filePath, 'utf8').slice(0, 64);
  if (head.includes('\0')) {
    errors.push(`stylesheet ${rel} looks binary/UTF-16 (NUL byte in header)`);
  }
}

const assetsDir = join(BUILD_DIR, 'assets');
if (existsSync(assetsDir)) {
  const stale = readdirSync(assetsDir).filter((f) => f.endsWith('.1iss'));
  if (stale.length > 0) {
    errors.push(`stale .1iss assets in dist/assets: ${stale.join(', ')}`);
  }
}

const scriptHrefs = [
  ...html.matchAll(/<script[^>]+type=["']module["'][^>]*src=["']([^"']+)["']/gi),
].map((m) => m[1]);
for (const href of scriptHrefs) {
  const rel = resolveAssetHref(href);
  const filePath = join(BUILD_DIR, rel);
  if (!existsSync(filePath)) {
    errors.push(`module script missing on disk: ${rel}`);
  }
}

// Warn when dist/assets contains files not referenced by index.html or JS bundles
if (existsSync(assetsDir)) {
  const assetNames = readdirSync(assetsDir).filter((f) => statSync(join(assetsDir, f)).isFile());
  const referenced = new Set(
    [...stylesheetHrefs, ...scriptHrefs].map((h) => resolveAssetHref(h)),
  );
  for (const name of assetNames) {
    if (name.endsWith('.1iss')) continue;
    try {
      const text = readFileSync(join(assetsDir, name), 'utf8');
      for (const other of assetNames) {
        if (text.includes(other)) {
          referenced.add(`assets/${other}`);
        }
      }
    } catch {
      // binary — skip cross-ref scan
    }
  }
  const orphans = assetNames.filter(
    (name) => !referenced.has(`assets/${name}`) && !name.endsWith('.1iss'),
  );
  if (orphans.length > 0) {
    errors.push(
      `unreferenced assets in dist/assets (stale build?): ${orphans.join(', ')}`,
    );
  }
}

// Reject HTML-masquerading or tiny .wasm under dist/ (and public/ for source tree).
// See scripts/verify-wasm-assets.mjs — production JS worklet is wasm2js and does
// not need a sibling libopenmpt.wasm.
try {
  const wasmCheck = spawnSync(
    process.execPath,
    [join('scripts', 'verify-wasm-assets.mjs')],
    {
      env: { ...process.env, WASM_SCAN_ROOTS: `${BUILD_DIR},public` },
      encoding: 'utf8',
    },
  );
  if (wasmCheck.stdout) process.stdout.write(wasmCheck.stdout);
  if (wasmCheck.stderr) process.stderr.write(wasmCheck.stderr);
  if (wasmCheck.status !== 0) {
    errors.push('verify-wasm-assets failed (corrupt or HTML .wasm artifact)');
  }
} catch (e) {
  errors.push(
    `verify-wasm-assets could not run: ${e instanceof Error ? e.message : e}`,
  );
}

if (errors.length > 0) {
  console.error('verify-build FAILED:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(
  `verify-build OK: ${stylesheetHrefs.length} stylesheet(s), ${scriptHrefs.length} module script(s)`,
);
