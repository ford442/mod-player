#!/usr/bin/env node
/**
 * Post-build bundle budget — guards against three.js/R3F landing on the initial page load.
 *
 * The 3D view is lazy (app/App3DViewLazy.tsx), so `three-r3f-*.js` must be reachable only through
 * that dynamic import. This script fails when index.html modulepreloads it, or when anything the
 * page loads eagerly (the entry chunk + its modulepreloads + their static imports, transitively)
 * statically imports it — which is how it silently regressed before: Rollup pulled React into the
 * three chunk, so the entry imported React from it.
 *
 * Usage:
 *   node scripts/verify-bundle-budget.mjs
 *   BUILD_DIR=dist MAX_ENTRY_BYTES=700000 MAX_INITIAL_GZIP_BYTES=250000 node scripts/verify-bundle-budget.mjs
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUILD_DIR = process.env.BUILD_DIR || 'dist';
/** Main entry chunk max size (minified, bytes). React lives in react-vendor, three in the lazy chunk. */
const MAX_ENTRY_BYTES = Number(process.env.MAX_ENTRY_BYTES || 750 * 1024);
/**
 * Gzipped size of everything fetched on first load (entry + react-vendor + whatever else the entry
 * statically imports). Units match Vite's reporter (1 kB = 1000 B).
 */
const MAX_INITIAL_GZIP_BYTES = Number(process.env.MAX_INITIAL_GZIP_BYTES || 260 * 1000);
const THREE_CHUNK_PREFIX = 'three-r3f';
const REACT_VENDOR_CHUNK_PREFIX = 'react-vendor';
const LAZY_3D_CHUNK_PREFIX = 'App3DView';
/** FX rack (#453): the rack graph (FxRack, modules, loaders) loads only once a module is enabled. */
const LAZY_FX_CHUNK_PREFIX = 'fxRackController';
/** Opt-in WebGL2 pattern renderer (#492): only `?webgl2=1` / the failure-card button load it. */
const LAZY_WEBGL2_CHUNK_PREFIX = 'WebGL2PatternRenderer';
/**
 * JS-engine assets under worklets/ (everything except README.md): two libopenmpt pairs —
 * libopenmpt-worklet.{js,wasm} (main thread + parser worker) and libopenmpt-playback.{js,wasm} (the
 * AudioWorklet's shared-memory heap, #513; a crossOriginIsolated page fetches both) — plus the
 * generated processors. Was ~5 MB of wasm2js JS (fetched a second time for the main thread as
 * libmpt/libopenmptjs.js); real WASM is ~1.8 MB per pair.
 */
const MAX_JS_ENGINE_BYTES = Number(process.env.MAX_JS_ENGINE_BYTES || 4.25 * 1024 * 1024);
/** One glue + wasm pair: a pair over this means the wasm itself grew (SIMD, a debug build, …). */
const MAX_LIBOPENMPT_PAIR_BYTES = Number(process.env.MAX_LIBOPENMPT_PAIR_BYTES || 2 * 1024 * 1024);
const LIBOPENMPT_PAIRS = ['libopenmpt-worklet', 'libopenmpt-playback'];
const MAX_LIBOPENMPT_GLUE_BYTES = Number(process.env.MAX_LIBOPENMPT_GLUE_BYTES || 256 * 1024);

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

/**
 * Relative specifiers of the *static* imports / re-exports in a built chunk. Dynamic `import(...)`
 * has no `from` and a `(` after the keyword, so neither pattern matches it.
 */
function staticImportSpecifiers(code) {
  const specs = new Set();
  for (const m of code.matchAll(/\bfrom\s*["'](\.{1,2}\/[^"']+)["']/g)) specs.add(m[1]);
  for (const m of code.matchAll(/(?<![\w$.])import\s*["'](\.{1,2}\/[^"']+)["']/g)) specs.add(m[1]);
  return specs;
}

/** hrefs of every `<link rel="modulepreload">` in index.html (attribute order varies). */
function modulePreloadHrefs(html) {
  return [...html.matchAll(/<link\b[^>]*>/gi)]
    .map((m) => m[0])
    .filter((tag) => /\brel=["']modulepreload["']/i.test(tag))
    .map((tag) => tag.match(/\bhref=["']([^"']+)["']/i)?.[1])
    .filter(Boolean);
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
const jsChunks = (prefix) => assetFiles.filter((f) => f.startsWith(`${prefix}-`) && f.endsWith('.js'));
const threeChunks = jsChunks(THREE_CHUNK_PREFIX);
if (threeChunks.length === 0) {
  errors.push(`no ${THREE_CHUNK_PREFIX}-*.js chunk found (three/R3F not split?)`);
}

// react-vendor holds React + zustand + the Vite helpers shared by the entry and the three chunk.
// Without it Rollup folds them into three-r3f and the entry has to import them from there.
const reactVendorChunks = jsChunks(REACT_VENDOR_CHUNK_PREFIX);
if (reactVendorChunks.length === 0) {
  errors.push(`no ${REACT_VENDOR_CHUNK_PREFIX}-*.js chunk found (shared React chunk missing — see vite-plugins/crossOriginIsolationHeaders.ts)`);
}

// App3DView lazy chunk should exist (code-split from main entry).
const app3dChunks = jsChunks(LAZY_3D_CHUNK_PREFIX);
if (app3dChunks.length === 0) {
  errors.push('no App3DView-*.js lazy chunk found (3D view not code-split?)');
}

// FX rack (#453): its graph is a lazy chunk; the eager code only carries the store + bootstrap.
const fxChunks = jsChunks(LAZY_FX_CHUNK_PREFIX);
if (fxChunks.length === 0) {
  errors.push(`no ${LAZY_FX_CHUNK_PREFIX}-*.js lazy chunk found (FX rack not code-split?)`);
}
// A static import of the WebGL2 renderer folds it into the entry, and this chunk disappears.
const webgl2Chunks = jsChunks(LAZY_WEBGL2_CHUNK_PREFIX);
if (webgl2Chunks.length === 0) {
  errors.push(`no ${LAZY_WEBGL2_CHUNK_PREFIX}-*.js lazy chunk found (opt-in WebGL2 renderer not code-split?)`);
}
// Room IRs are fetched on demand from dist/ir/, never bundled.
{
  const irDir = join(BUILD_DIR, 'ir');
  const irs = existsSync(irDir) ? readdirSync(irDir).filter((f) => f.endsWith('.opus')) : [];
  if (irs.length === 0) errors.push('dist/ir/*.opus missing (FX room IRs not shipped)');
}

// What the browser fetches before any user action: the entry, every <link rel="modulepreload">,
// and all of their static imports. three-r3f and the lazy 3D view must not be in it.
const preloadHrefs = modulePreloadHrefs(html);
for (const href of preloadHrefs) {
  const name = posix.basename(resolveAssetHref(href));
  if (name.startsWith(`${THREE_CHUNK_PREFIX}-`)) {
    errors.push(
      `index.html modulepreloads ${name} — the ~1 MB three.js chunk is fetched on every page load ` +
        `even when the lazy 3D view never renders`,
    );
  }
}

/** rel path (relative to BUILD_DIR) → { code: Buffer, via: string | null } for the eager graph. */
const eagerChunks = new Map();
{
  /** @type {Array<{ rel: string, via: string | null }>} */
  const queue = [];
  if (entryRel) queue.push({ rel: entryRel, via: null });
  for (const href of preloadHrefs) queue.push({ rel: resolveAssetHref(href), via: 'index.html modulepreload' });
  for (let item = queue.shift(); item; item = queue.shift()) {
    const { rel, via } = item;
    if (eagerChunks.has(rel)) continue;
    const abs = join(BUILD_DIR, rel);
    if (!existsSync(abs)) {
      errors.push(`eagerly loaded chunk missing on disk: ${rel}${via ? ` (from ${via})` : ''}`);
      continue;
    }
    const code = readFileSync(abs);
    eagerChunks.set(rel, { code, via });
    for (const spec of staticImportSpecifiers(code.toString('utf8'))) {
      queue.push({ rel: posix.join(posix.dirname(rel), spec), via: rel });
    }
  }
}

for (const [rel, { via, code }] of eagerChunks) {
  const name = posix.basename(rel);
  if (name.startsWith(`${THREE_CHUNK_PREFIX}-`)) {
    errors.push(
      `initial load statically imports ${name}${via ? ` (via ${via})` : ''} — three.js must only ` +
        `load through the lazy 3D view (a shared dependency was probably folded into the three chunk)`,
    );
  }
  if (name.startsWith(`${LAZY_3D_CHUNK_PREFIX}-`)) {
    errors.push(`initial load statically imports ${name}${via ? ` (via ${via})` : ''} — 3D view is not lazy`);
  }
  if (name.startsWith(`${LAZY_FX_CHUNK_PREFIX}-`)) {
    errors.push(`initial load statically imports ${name}${via ? ` (via ${via})` : ''} — FX rack is not lazy`);
  }
  if (name.startsWith(`${LAZY_WEBGL2_CHUNK_PREFIX}-`)) {
    errors.push(`initial load statically imports ${name}${via ? ` (via ${via})` : ''} — the opt-in WebGL2 renderer is not lazy`);
  }
  // Node factory names survive minification, and only the FX rack's modules call them.
  const text = code.toString('utf8');
  if (text.includes('createConvolver') || text.includes('createDynamicsCompressor')) {
    errors.push(`initial load chunk ${name} contains FX rack graph code — it must stay in its lazy chunk`);
  }
}

let initialGzipBytes = 0;
for (const [, { code }] of eagerChunks) initialGzipBytes += gzipSync(code).length;
if (initialGzipBytes > MAX_INITIAL_GZIP_BYTES) {
  errors.push(
    `initial JS load is ${initialGzipBytes} bytes gzipped across ${eagerChunks.size} chunk(s) ` +
      `(budget ${MAX_INITIAL_GZIP_BYTES}): ${[...eagerChunks.keys()].join(', ')}`,
  );
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

// JS engine assets: budget the shipped worklets/ dir.
let jsEngineBytes = 0;
{
  const workletsDir = join(BUILD_DIR, 'worklets');
  if (!existsSync(workletsDir)) {
    errors.push('dist/worklets missing');
  } else {
    for (const f of readdirSync(workletsDir)) {
      if (f.endsWith('.md')) continue;
      const size = statSync(join(workletsDir, f)).size;
      jsEngineBytes += size;
      if ((f === 'libopenmpt-worklet.js' || f === 'libopenmpt-playback.js') && size > MAX_LIBOPENMPT_GLUE_BYTES) {
        errors.push(`worklets/${f} is ${size} bytes (budget ${MAX_LIBOPENMPT_GLUE_BYTES}) — wasm2js glue crept back in?`);
      }
    }
    for (const pair of LIBOPENMPT_PAIRS) {
      const files = [`${pair}.js`, `${pair}.wasm`].map((f) => join(workletsDir, f));
      // Presence is verify-wasm-assets' / verify:js-libopenmpt's job; this one budgets what ships.
      if (!files.every((f) => existsSync(f))) continue;
      const pairBytes = files.reduce((n, f) => n + statSync(f).size, 0);
      if (pairBytes > MAX_LIBOPENMPT_PAIR_BYTES) {
        errors.push(`worklets/${pair}.{js,wasm} is ${pairBytes} bytes (budget ${MAX_LIBOPENMPT_PAIR_BYTES})`);
      }
    }
    if (existsSync(join(workletsDir, 'libopenmpt-playback.ww.js'))) {
      errors.push('worklets/libopenmpt-playback.ww.js is shipped — the build deletes Emscripten\'s unused worker bootstrap');
    }
    if (jsEngineBytes > MAX_JS_ENGINE_BYTES) {
      errors.push(`JS engine worklet assets total ${jsEngineBytes} bytes (budget ${MAX_JS_ENGINE_BYTES})`);
    }
    if (existsSync(join(workletsDir, 'libopenmpt-audioworklet.js'))) {
      errors.push('worklets/libopenmpt-audioworklet.js (5 MB wasm2js glue) is still shipped');
    }
  }
}

if (errors.length > 0) {
  console.error('verify-bundle-budget FAILED:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

const kib = (files) => files.reduce((sum, f) => sum + statSync(join(assetsDir, f)).size, 0) / 1024;
console.log(
  `verify-bundle-budget OK: entry=${(entryBytes / 1024).toFixed(1)} KiB, ` +
    `initial JS=${(initialGzipBytes / 1000).toFixed(1)} kB gzip over ${eagerChunks.size} chunk(s) ` +
    `(${[...eagerChunks.keys()].map((r) => posix.basename(r)).join(', ')}), ` +
    `react-vendor=${kib(reactVendorChunks).toFixed(1)} KiB, ` +
    `three-r3f=${kib(threeChunks).toFixed(1)} KiB lazy (${threeChunks.length} file(s)), ` +
    `App3DView lazy chunk present, FX rack lazy chunk present, ` +
    `WebGL2 renderer=${kib(webgl2Chunks).toFixed(1)} KiB lazy, ` +
    `js-engine worklets/=${(jsEngineBytes / 1024).toFixed(1)} KiB`,
);
