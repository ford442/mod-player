#!/usr/bin/env node
/**
 * Instruction-level feature gate for the two WASM builds (#491 Phase 2).
 *
 *   node scripts/verify-wasm-features.mjs --profile native   [public/worklets/openmpt-native.wasm]
 *   node scripts/verify-wasm-features.mjs --profile js       [public/worklets/libopenmpt-worklet.wasm]
 *   node scripts/verify-wasm-features.mjs --profile native-debug <file>
 *
 * Counts real instructions (scripts/lib/wasm-ops.mjs), so a stray 0xFD byte can't pass for
 * SIMD — the old verify-native-simd.mjs byte grep reported OK for the non-SIMD JS-engine wasm.
 *
 * native        SIMD survived the ThinLTO link; native wasm exceptions are linked (try/catch
 *               present — a no-catch link turns libopenmpt's internal throw/catch into abort());
 *               saturating float→int, bulk memory and atomics are in use.
 * native-debug  the same minus SIMD (debug keeps SIMD and LTO off).
 * js            exceptions, saturating float→int and bulk memory present; NO SIMD (the JS engine
 *               is the default for every browser, incl. ones without wasm SIMD) and no atomics
 *               (it does not use shared memory).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanWasm } from './lib/wasm-ops.mjs';

const ROOT = process.cwd();

/** @typedef {ReturnType<typeof scanWasm>} WasmCounts */

/** @type {Record<string, { file: string, rules: Array<[string, (c: WasmCounts) => boolean, string]> }>} */
export const PROFILES = {
  native: {
    file: 'public/worklets/openmpt-native.wasm',
    rules: [
      ['simd', (c) => c.simd >= 1000, 'SIMD (v128/f32x4/…) instructions: -msimd128 must reach the LTO link'],
      ['exceptions', (c) => c.tryBlocks > 0 && c.catches > 0, 'try/catch blocks: libopenmpt must be built and linked with -fwasm-exceptions'],
      ['nontrapping-fptoint', (c) => c.truncSat > 0, 'saturating float→int (trunc_sat): -mnontrapping-fptoint on libopenmpt'],
      ['bulk-memory', (c) => c.memoryCopy > 0 && c.memoryFill > 0, 'memory.copy / memory.fill: -mbulk-memory'],
      ['atomics', (c) => c.atomics > 0, 'atomic instructions: WASM_WORKERS shared memory'],
    ],
  },
  'native-debug': {
    file: 'public/worklets/openmpt-native.wasm',
    rules: [
      ['exceptions', (c) => c.tryBlocks > 0 && c.catches > 0, 'try/catch blocks: libopenmpt must be built and linked with -fwasm-exceptions'],
      ['nontrapping-fptoint', (c) => c.truncSat > 0, 'saturating float→int (trunc_sat): -mnontrapping-fptoint on libopenmpt'],
      ['bulk-memory', (c) => c.memoryCopy > 0, 'memory.copy: -mbulk-memory'],
      ['atomics', (c) => c.atomics > 0, 'atomic instructions: WASM_WORKERS shared memory'],
    ],
  },
  js: {
    file: 'public/worklets/libopenmpt-worklet.wasm',
    rules: [
      ['exceptions', (c) => c.tryBlocks > 0 && c.catches > 0, 'try/catch blocks: -fwasm-exceptions'],
      ['nontrapping-fptoint', (c) => c.truncSat > 0, 'saturating float→int (trunc_sat): -mnontrapping-fptoint'],
      ['bulk-memory', (c) => c.memoryCopy > 0 && c.memoryFill > 0, 'memory.copy / memory.fill: -mbulk-memory'],
      ['no-simd', (c) => c.simd === 0, 'no SIMD: the default engine must run on browsers without wasm SIMD'],
      ['no-atomics', (c) => c.atomics === 0, 'no atomics: the JS engine does not use shared memory'],
    ],
  },
};

/** Check `bytes` against a profile; returns { counts, failures: string[] }. */
export function checkWasmProfile(bytes, profileName) {
  const profile = PROFILES[profileName];
  if (!profile) throw new Error(`unknown profile ${profileName} (${Object.keys(PROFILES).join(', ')})`);
  const counts = scanWasm(bytes);
  const failures = profile.rules
    .filter(([, ok]) => !ok(counts))
    .map(([name, , why]) => `${name}: ${why}`);
  return { counts, failures };
}

function main(argv) {
  let profileName = 'native';
  let file = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--profile') profileName = argv[++i] ?? '';
    else file = argv[i];
  }
  const profile = PROFILES[profileName];
  if (!profile) {
    console.error(`verify-wasm-features: unknown profile '${profileName}' (${Object.keys(PROFILES).join(', ')})`);
    return 2;
  }
  const path = file ?? join(ROOT, profile.file);
  if (!existsSync(path)) {
    console.error(`verify-wasm-features: missing ${path}`);
    return 1;
  }
  const { counts, failures } = checkWasmProfile(readFileSync(path), profileName);
  const summary = Object.fromEntries(Object.entries(counts).filter(([k]) => k !== 'sections'));
  if (failures.length) {
    console.error(`verify-wasm-features FAILED [${profileName}] ${path}`);
    for (const f of failures) console.error(`  - ${f}`);
    console.error('  counts:', summary);
    return 1;
  }
  console.log(`verify-wasm-features OK [${profileName}] ${path}`, summary);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
