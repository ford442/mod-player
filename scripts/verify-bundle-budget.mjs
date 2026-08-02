#!/usr/bin/env node
/**
 * Post-build bundle budget — guards against three.js/R3F landing in the main chunk.
 *
 * Usage:
 *   node scripts/verify-bundle-budget.mjs
 *   BUILD_DIR=dist MAX_ENTRY_KB=900 node scripts/verify-bundle-budget.mjs
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BUILD_DIR = process.env.BUILD_DIR || 'dist';
/** Main entry chunk max size (minified, bytes). Tuned after three-r3f split (~1.5 MB → ~900 KB). */
const MAX_ENTRY_BYTES = Number(process.env.MAX_ENTRY_BYTES || 950 * 1024);
const THREE_CHUNK_PREFIX = 'three-r3f';

function resolveAssetHref(href) {
  let path = (href || '').trim();
  if (path.startsWith('./')) path = path.slice(2);
  else if (path.startsWith('/')) path = path.slice(1);
  const project = process.env.PROJECT_NAME || 'xm-player';
  const pfx = `${project}/`;
  if (path.startsWith(pfx)) path = path.slice(pfx.length);
  if (path.startsWith('/')) path = path.slice(1);
  return path;
}

const errors = [];

const indexPath = join(BUILD_DIR, 'index.html');
if (!existsSync(indexPath)) {
  console.error(`verify-bundle-budget: missing ${indexPath}`);
  process.exit(1);
}

const html = readFileSync(indexPath, 'utf8');
const entryMatch = html.match(
  /<script[^>]+type=["']module["'][^>]*src=["']([^"']*assets\/index-[^"']+\.js)["']/i,
);
if (!entryMatch?.[1]) {
  errors.push('index.html has no module entry script (assets/index-*.js)');
}

const assetsDir = join(BUILD_DIR, 'assets');
if (!existsSync(assetsDir)) {
  errors.push('dist/assets missing');
}

let entryRel = '';
let entryBytes = 0;
if (entryMatch?.[1]) {
  entryRel = resolveAssetHref(entryMatch[1]);
  const entryPath = join(BUILD_DIR, entryRel);
  if (!existsSync(entryPath)) {
    errors.push(`entry chunk missing on disk: ${entryRel}`);
  } else {
    entryBytes = statSync(entryPath).size;
    if (entryBytes > MAX_ENTRY_BYTES) {
      errors.push(
        `entry chunk ${entryRel} is ${entryBytes} bytes (budget ${MAX_ENTRY_BYTES})`,
      );
    }
  }
}

const assetFiles = existsSync(assetsDir) ? readdirSync(assetsDir) : [];
const threeChunks = assetFiles.filter((f) => f.startsWith(`${THREE_CHUNK_PREFIX}-`) && f.endsWith('.js'));
if (threeChunks.length === 0) {
  errors.push(`no ${THREE_CHUNK_PREFIX}-*.js chunk found (three/R3F not split?)`);
}

// App3DView lazy chunk should exist (code-split from main entry).
const app3dChunks = assetFiles.filter((f) => f.startsWith('App3DView-') && f.endsWith('.js'));
if (app3dChunks.length === 0) {
  errors.push('no App3DView-*.js lazy chunk found (3D view not code-split?)');
}

// Main entry must not embed the three vendor graph (smoke test via unique string).
if (entryRel && existsSync(join(BUILD_DIR, entryRel))) {
  const entryText = readFileSync(join(BUILD_DIR, entryRel), 'utf8');
  if (entryText.includes('@react-three/fiber') || entryText.includes('three/build/three')) {
    errors.push('entry chunk still references three/R3F — split failed');
  }
}

// Versioned production COOP/COEP config must ship with dist/.
const htaccessPath = join(BUILD_DIR, '.htaccess');
if (!existsSync(htaccessPath)) {
  errors.push('dist/.htaccess missing (COOP/COEP not deployed)');
} else {
  const htaccess = readFileSync(htaccessPath, 'utf8');
  if (!htaccess.includes('Cross-Origin-Opener-Policy')) {
    errors.push('.htaccess missing Cross-Origin-Opener-Policy');
  }
  if (!htaccess.includes('credentialless')) {
    errors.push('.htaccess missing Cross-Origin-Embedder-Policy credentialless');
  }
}

if (errors.length > 0) {
  console.error('verify-bundle-budget FAILED:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

const threeKb = threeChunks.reduce((sum, f) => sum + statSync(join(assetsDir, f)).size, 0);
console.log(
  `verify-bundle-budget OK: entry=${(entryBytes / 1024).toFixed(1)} KiB, ` +
    `three-r3f=${(threeKb / 1024).toFixed(1)} KiB (${threeChunks.length} file(s)), ` +
    `App3DView lazy chunk present`,
);
