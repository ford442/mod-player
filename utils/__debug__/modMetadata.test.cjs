const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Running modMetadata tests...');

const testScript = `
import fs from 'node:fs';
import path from 'node:path';
import {
  resolveModuleTitle,
  titleFromFileName,
  extractModuleMetadataWithLib,
} from '../modMetadata.ts';

// --- pure helper tests ---
if (resolveModuleTitle('', 'artist/track.xm') !== 'track') {
  console.error('FAIL: resolveModuleTitle should fall back to filename stem');
  process.exit(1);
}
if (resolveModuleTitle('Real Title', 'ignored.mod') !== 'Real Title') {
  console.error('FAIL: resolveModuleTitle should prefer embedded title');
  process.exit(1);
}
if (titleFromFileName('folder/deep.mod') !== 'deep') {
  console.error('FAIL: titleFromFileName path strip');
  process.exit(1);
}

// --- corrupt file fallback (no WASM needed) ---
class FakeLib {
  heap = new Uint8Array(256);
  _malloc() { return 0; }
  _free() {}
  get HEAPU8() { return this.heap; }
  _openmpt_module_create_from_memory2() { return 0; }
}
const corrupt = extractModuleMetadataWithLib(new FakeLib(), new Uint8Array([0, 1, 2]), {
  fileName: 'broken.mod',
});
if (corrupt.title !== 'broken' || !corrupt.parseError) {
  console.error('FAIL: corrupt module should return filename title + parseError', corrupt);
  process.exit(1);
}

// --- integration: real libopenmpt + sample modules ---
const CDN_JS_URL = 'https://wasm.noahcohn.com/libmpt/libopenmptjs.js';

async function loadLibOpenMPT() {
  const response = await fetch(CDN_JS_URL);
  if (!response.ok) throw new Error('CDN fetch failed: ' + response.status);
  const scriptText = await response.text();
  globalThis.libopenmpt = { noInitialRun: true };
  const cleaned = scriptText.replace(/^\\s*export\\s+(default\\s+)?/gm, '');
  const fn = new Function(cleaned);
  fn.call(globalThis);
  const lib = globalThis.libopenmpt;
  if (!lib._openmpt_module_create_from_memory) {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('WASM timeout')), 25000);
      if (lib.calledRun) { clearTimeout(t); resolve(); return; }
      const prev = lib.onRuntimeInitialized;
      lib.onRuntimeInitialized = () => {
        clearTimeout(t);
        if (typeof prev === 'function') prev();
        resolve();
      };
    });
  }
  if (!lib.UTF8ToString) {
    lib.UTF8ToString = (ptr) => {
      if (!ptr) return '';
      const heap = lib.HEAPU8;
      let str = '';
      for (let i = 0; ; i++) {
        const b = heap[ptr + i];
        if (b === undefined || b === 0) break;
        str += String.fromCharCode(b);
      }
      return str;
    };
  }
  if (!lib.stringToUTF8) {
    lib.stringToUTF8 = (s) => {
      const len = (s.length << 2) + 1;
      const ptr = lib._malloc(len);
      const heap = lib.HEAPU8;
      let j = 0;
      for (let i = 0; i < s.length; i++) heap[ptr + j++] = s.charCodeAt(i);
      heap[ptr + j] = 0;
      return ptr;
    };
  }
  return lib;
}

const repoRoot = path.resolve(import.meta.dirname, '../..');
const samples = [
  path.join(repoRoot, 'public/test.xm'),
  path.join(repoRoot, 'public/libopenmpt-test.mod'),
  path.join(repoRoot, 'vendor/libopenmpt/test/test.s3m'),
  path.join(repoRoot, 'vendor/libopenmpt/test/test.mptm'),
];

const lib = await loadLibOpenMPT();
for (const samplePath of samples) {
  if (!fs.existsSync(samplePath)) {
    console.log('SKIP missing sample:', samplePath);
    continue;
  }
  const bytes = fs.readFileSync(samplePath);
  const fileName = path.basename(samplePath);
  const meta = extractModuleMetadataWithLib(lib, new Uint8Array(bytes), { fileName });
  if (!meta.title || meta.parseError) {
    console.error('FAIL: expected valid metadata for', fileName, meta);
    process.exit(1);
  }
  console.log('OK', fileName, '→', meta.title, meta.type ? '(' + meta.type + ')' : '');
}

console.log('All modMetadata tests passed.');
`;

const tempFile = path.join('utils/__debug__', 'temp.modMetadata.test.ts');
fs.writeFileSync(tempFile, testScript);
const result = spawnSync('npx', ['tsx', tempFile], {
  cwd: process.cwd(),
  encoding: 'utf8',
  stdio: 'pipe',
});
fs.unlinkSync(tempFile);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (result.status !== 0) {
  console.error('modMetadata tests FAILED');
  process.exit(result.status ?? 1);
}

console.log('modMetadata tests OK');
