#!/usr/bin/env node
/**
 * Instruction-level feature gate for the JS engine's libopenmpt wasm (#491 Phase 2, #515).
 *
 *   node scripts/verify-wasm-features.mjs --profile shared    [public/worklets/libopenmpt-worklet.wasm]
 *   node scripts/verify-wasm-features.mjs --profile playback  [public/worklets/libopenmpt-playback.wasm]
 *   node scripts/verify-wasm-features.mjs --profile simd <file>   # a --simd A/B build
 *
 * Counts real instructions (scripts/lib/wasm-ops.mjs), so a stray 0xFD byte can't pass for
 * SIMD: the byte grep this replaces (the retired verify-native-simd.mjs) reported OK for the
 * non-SIMD wasm. checkArtifacts (scripts/jsEngineArtifacts.mjs) runs the shared/playback
 * profiles on every `npm run verify:js-libopenmpt`.
 *
 * shared    main thread + parser worker: native wasm exceptions (try/catch present; libopenmpt
 *           turns its internal throws into NULL by catching), saturating float→int, bulk
 *           memory; NO SIMD (SIMD was measured and not adopted, public/worklets/README.md) and
 *           NO atomics (this pair must stay non-threaded, CLAUDE.md pitfall 4).
 * playback  the AudioWorklet's shared-memory heap (#513): the same, plus atomics (-sWASM_WORKERS).
 * simd      the --simd experiment: SIMD instructions survived the LTO link.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { scanWasm } from './lib/wasm-ops.mjs';

const ROOT = process.cwd();

/** @typedef {ReturnType<typeof scanWasm>} WasmCounts */

/** @type {Array<[string, (c: WasmCounts) => boolean, string]>} */
const COMMON_RULES = [
  ['exceptions', (c) => c.tryBlocks > 0 && c.catches > 0, 'try/catch blocks: libopenmpt must be built and linked with -fwasm-exceptions'],
  ['nontrapping-fptoint', (c) => c.truncSat > 0, 'saturating float→int (trunc_sat): -mnontrapping-fptoint on libopenmpt'],
  ['bulk-memory', (c) => c.memoryCopy > 0 && c.memoryFill > 0, 'memory.copy / memory.fill: -mbulk-memory'],
];

/** @type {Record<string, { file: string, rules: Array<[string, (c: WasmCounts) => boolean, string]> }>} */
export const PROFILES = {
  shared: {
    file: 'public/worklets/libopenmpt-worklet.wasm',
    rules: [
      ...COMMON_RULES,
      ['no-simd', (c) => c.simd === 0, 'no SIMD: measured and not adopted (public/worklets/README.md)'],
      ['no-atomics', (c) => c.atomics === 0, 'no atomics: the main-thread / parser-worker pair must stay non-threaded'],
    ],
  },
  playback: {
    file: 'public/worklets/libopenmpt-playback.wasm',
    rules: [
      ...COMMON_RULES,
      ['atomics', (c) => c.atomics > 0, 'atomic instructions: the playback heap is linked with -sWASM_WORKERS'],
      ['no-simd', (c) => c.simd === 0, 'no SIMD: measured and not adopted (public/worklets/README.md)'],
    ],
  },
  simd: {
    file: 'public/worklets/libopenmpt-worklet.wasm',
    rules: [
      ...COMMON_RULES,
      ['simd', (c) => c.simd >= 1000, 'SIMD (v128/f32x4/…) instructions: -msimd128 must reach the LTO link'],
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
  let profileName = 'shared';
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
