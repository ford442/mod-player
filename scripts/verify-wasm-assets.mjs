#!/usr/bin/env node
/**
 * Reject corrupt / HTML-masquerading .wasm artifacts.
 *
 * Real WebAssembly binaries always start with magic bytes `\0asm`
 * (0x00 0x61 0x73 0x6d). Failed CDN/wget captures often commit 404 HTML
 * pages as `*.wasm` (e.g. the old public/worklets/libopenmpt.wasm stub).
 *
 * Usage:
 *   node scripts/verify-wasm-assets.mjs
 *   WASM_SCAN_ROOTS="public,dist" node scripts/verify-wasm-assets.mjs
 *
 * Exit 0 when every present *.wasm has a valid header (or no .wasm files).
 * Exit 1 on any corrupt / tiny / HTML file.
 *
 * Notes on the JS worklet path:
 *   The default JS engine ships a REAL WebAssembly build:
 *   worklets/libopenmpt-worklet.wasm (+ libopenmpt-worklet.js glue). Under every scanned
 *   root that has a worklets/ directory it is REQUIRED — a missing or HTML-bodied file there
 *   means no audio at all. Optional native engine outputs (openmpt-native.wasm) are gitignored
 *   until built; when present they are also validated. Presence of the native trio is
 *   classified by scripts/verify-build.mjs (absent OK; partial/invalid fail).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const WASM_MAGIC = Buffer.from([0x00, 0x61, 0x73, 0x6d]); // \0asm
/** Reject empty/tiny stubs even if magic somehow matched. */
const MIN_WASM_BYTES = Number(process.env.MIN_WASM_BYTES || 1024);
const ROOTS = (process.env.WASM_SCAN_ROOTS || 'public,dist')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const errors = [];
const checked = [];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      // Skip dependency / VCS noise if roots ever broaden
      if (ent.name === 'node_modules' || ent.name === '.git') continue;
      walk(full, out);
    } else if (ent.isFile() && ent.name.endsWith('.wasm')) {
      out.push(full);
    }
  }
  return out;
}

function looksLikeHtmlOrText(buf) {
  const sample = buf.subarray(0, Math.min(64, buf.length)).toString('utf8');
  const trimmed = sample.trimStart().toLowerCase();
  return (
    trimmed.startsWith('<!doctype') ||
    trimmed.startsWith('<html') ||
    trimmed.startsWith('<head') ||
    trimmed.startsWith('not found') ||
    trimmed.includes('404 not found')
  );
}

function validateWasmFile(filePath) {
  const rel = relative(process.cwd(), filePath) || filePath;
  checked.push(rel);

  let st;
  try {
    st = statSync(filePath);
  } catch (e) {
    errors.push(`${rel}: cannot stat (${e instanceof Error ? e.message : e})`);
    return;
  }

  if (st.size < MIN_WASM_BYTES) {
    errors.push(
      `${rel}: only ${st.size} bytes (expected >= ${MIN_WASM_BYTES}). ` +
        `Tiny files are usually failed downloads / HTML error pages.`,
    );
  }

  let buf;
  try {
    buf = readFileSync(filePath);
  } catch (e) {
    errors.push(`${rel}: cannot read (${e instanceof Error ? e.message : e})`);
    return;
  }

  if (looksLikeHtmlOrText(buf)) {
    errors.push(
      `${rel}: content looks like HTML/text (e.g. 404 page), not WebAssembly. ` +
        `Remove it or replace with a real \\0asm binary.`,
    );
    return;
  }

  if (buf.length < 4 || !buf.subarray(0, 4).equals(WASM_MAGIC)) {
    const preview = buf
      .subarray(0, Math.min(16, buf.length))
      .toString('hex');
    errors.push(
      `${rel}: missing WebAssembly magic \\0asm ` +
        `(got hex ${preview || '(empty)'}).`,
    );
  }
}

for (const root of ROOTS) {
  const found = walk(root);
  for (const file of found) {
    validateWasmFile(file);
  }
  if (
    existsSync(join(root, 'worklets')) &&
    !found.some((f) => f.endsWith(join('worklets', 'libopenmpt-worklet.wasm')))
  ) {
    errors.push(
      `${root}/worklets/libopenmpt-worklet.wasm is missing — the default JS engine needs it ` +
        `(npm run build:js-libopenmpt, or restore the committed file).`,
    );
  }
}

if (errors.length > 0) {
  console.error('verify-wasm-assets FAILED:');
  for (const e of errors) console.error(`  - ${e}`);
  console.error(
    `\nHint: the JS engine's libopenmpt-worklet.wasm is real WebAssembly (npm run ` +
      `build:js-libopenmpt). Do not commit HTML 404 bodies as .wasm.`,
  );
  process.exit(1);
}

if (checked.length === 0) {
  console.log(
    'verify-wasm-assets OK: no .wasm files under',
    ROOTS.join(', '),
    '(no worklets/ directory to require the JS engine wasm in)',
  );
} else {
  console.log(
    `verify-wasm-assets OK: ${checked.length} file(s) have valid \\0asm magic:`,
  );
  for (const f of checked) console.log(`  - ${f}`);
}
