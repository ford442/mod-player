#!/usr/bin/env node
/**
 * Download pinned libopenmpt JS + WASM into public/libmpt/.
 *
 * Usage:
 *   node scripts/vendor-libopenmpt.mjs
 *   LIBOPENMPT_VENDOR_URL=https://wasm.noahcohn.com/libmpt/ node scripts/vendor-libopenmpt.mjs
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'public', 'libmpt');
const BASE = (process.env.LIBOPENMPT_VENDOR_URL || 'https://wasm.noahcohn.com/libmpt/')
  .replace(/\/?$/, '/');

const FILES = ['libopenmptjs.js', 'libopenmpt.wasm'];

async function download(name) {
  const url = BASE + name;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  const buf = Buffer.from(await response.arrayBuffer());
  if (buf.length < 1024) {
    throw new Error(`${name} is suspiciously small (${buf.length} bytes)`);
  }
  return buf;
}

function sha384(buf) {
  return `sha384-${createHash('sha384').update(buf).digest('base64')}`;
}

mkdirSync(OUT_DIR, { recursive: true });

console.log(`Vendoring libopenmpt from ${BASE}`);

for (const name of FILES) {
  const buf = await download(name);
  const outPath = join(OUT_DIR, name);
  writeFileSync(outPath, buf);
  console.log(`  wrote ${outPath} (${buf.length} bytes)`);
  console.log(`  ${name} SRI: ${sha384(buf)}`);
}

console.log('\nUpdate LIBOPENMPT_*_INTEGRITY in utils/libopenmptAssets.ts if hashes changed.');
