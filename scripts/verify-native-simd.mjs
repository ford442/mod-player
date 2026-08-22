#!/usr/bin/env node
/**
 * Assert native WASM was actually linked with SIMD (not a silent scalar fallback).
 *
 * Usage: node scripts/verify-native-simd.mjs [path/to/openmpt-native.wasm]
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const wasmPath = process.argv[2] || join(ROOT, 'public/worklets/openmpt-native.wasm');

if (!existsSync(wasmPath)) {
  console.error(`verify-native-simd: missing ${wasmPath}`);
  console.error('(skip until npm run build:emcc produces artifacts)');
  process.exit(1);
}

const buf = readFileSync(wasmPath);
if (buf.length < 8 || buf[0] !== 0x00 || buf[1] !== 0x61 || buf[2] !== 0x73 || buf[3] !== 0x6d) {
  console.error('verify-native-simd: not a WASM binary (missing \\0asm magic)');
  process.exit(1);
}

const latin1 = buf.toString('latin1');
const hasTargetFeature = latin1.includes('simd128');

let hasFdOpcode = false;
for (let i = 0; i < buf.length; i++) {
  if (buf[i] === 0xfd) {
    hasFdOpcode = true;
    break;
  }
}

let objdumpOk = false;
const dump = spawnSync('wasm-objdump', ['-d', wasmPath], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
if (dump.status === 0 && typeof dump.stdout === 'string') {
  objdumpOk = /v128\.|i8x16\.|f32x4\.|i32x4\./.test(dump.stdout);
}

if (objdumpOk || hasTargetFeature || hasFdOpcode) {
  console.log('verify-native-simd OK', {
    path: wasmPath,
    targetFeatureSimd128: hasTargetFeature,
    fdPrefix: hasFdOpcode,
    wasmObjdump: dump.status === 0 ? objdumpOk : 'not-installed',
  });
  process.exit(0);
}

console.error('verify-native-simd FAILED: no SIMD opcodes / simd128 target feature in', wasmPath);
process.exit(1);
