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
 *   public/worklets/libopenmpt-audioworklet.js is a **wasm2js** build — the
 *   runtime is embedded in the JS. A sibling libopenmpt.wasm is NOT required
 *   and must not be a fake HTML file. Optional native engine outputs
 *   (openmpt-native.wasm, openmpt-worklet.wasm) are gitignored until built;
 *   when present they are also validated.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export const WASM_MAGIC = Buffer.from([0x00, 0x61, 0x73, 0x6d]); // \0asm
/** Reject empty/tiny stubs even if magic somehow matched. */
export const MIN_WASM_BYTES = Number(process.env.MIN_WASM_BYTES || 1024);

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

/**
 * Validate a single .wasm file. Returns an array of error strings (empty = OK).
 */
export function validateWasmFile(filePath, options = {}) {
  const minBytes = options.minBytes ?? MIN_WASM_BYTES;
  const rel = options.relPath ?? (relative(process.cwd(), filePath) || filePath);
  const fileErrors = [];

  let st;
  try {
    st = statSync(filePath);
  } catch (e) {
    fileErrors.push(`${rel}: cannot stat (${e instanceof Error ? e.message : e})`);
    return fileErrors;
  }

  if (st.size < minBytes) {
    fileErrors.push(
      `${rel}: only ${st.size} bytes (expected >= ${minBytes}). ` +
        `Tiny files are usually failed downloads / HTML error pages.`,
    );
  }

  let buf;
  try {
    buf = readFileSync(filePath);
  } catch (e) {
    fileErrors.push(`${rel}: cannot read (${e instanceof Error ? e.message : e})`);
    return fileErrors;
  }

  if (st.size === 0) {
    fileErrors.push(`${rel}: file is empty`);
    return fileErrors;
  }

  if (looksLikeHtmlOrText(buf)) {
    fileErrors.push(
      `${rel}: content looks like HTML/text (e.g. 404 page), not WebAssembly. ` +
        `Remove it or replace with a real \\0asm binary.`,
    );
    return fileErrors;
  }

  if (buf.length < 4 || !buf.subarray(0, 4).equals(WASM_MAGIC)) {
    const preview = buf
      .subarray(0, Math.min(16, buf.length))
      .toString('hex');
    fileErrors.push(
      `${rel}: missing WebAssembly magic \\0asm ` +
        `(got hex ${preview || '(empty)'}).`,
    );
  }

  return fileErrors;
}

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
      if (ent.name === 'node_modules' || ent.name === '.git') continue;
      walk(full, out);
    } else if (ent.isFile() && ent.name.endsWith('.wasm')) {
      out.push(full);
    }
  }
  return out;
}

function runCli() {
  const roots = (process.env.WASM_SCAN_ROOTS || 'public,dist')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const errors = [];
  const checked = [];

  for (const root of roots) {
    for (const file of walk(root)) {
      const rel = relative(process.cwd(), file) || file;
      checked.push(rel);
      errors.push(...validateWasmFile(file, { relPath: rel }));
    }
  }

  if (errors.length > 0) {
    console.error('verify-wasm-assets FAILED:');
    for (const e of errors) console.error(`  - ${e}`);
    console.error(
      `\nHint: production JS worklet uses wasm2js (libopenmpt-audioworklet.js); ` +
        `a sibling libopenmpt.wasm is not required. Do not commit HTML 404 bodies as .wasm.`,
    );
    process.exit(1);
  }

  if (checked.length === 0) {
    console.log(
      'verify-wasm-assets OK: no .wasm files under',
      roots.join(', '),
      '(wasm2js / unbuilt native engine is fine)',
    );
  } else {
    console.log(
      `verify-wasm-assets OK: ${checked.length} file(s) have valid \\0asm magic:`,
    );
    for (const f of checked) console.log(`  - ${f}`);
  }
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('verify-wasm-assets.mjs') ||
    process.argv[1].replace(/\\/g, '/').endsWith('/scripts/verify-wasm-assets.mjs'));

if (isMain) {
  runCli();
}
