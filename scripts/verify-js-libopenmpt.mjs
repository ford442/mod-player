#!/usr/bin/env node
/**
 * Verify (or record) the real-WASM libopenmpt pair the default JS engine ships.
 *
 *   node scripts/verify-js-libopenmpt.mjs            # static checks (files, magic, exports, manifest,
 *                                                    #   instruction-level wasm features)
 *   node scripts/verify-js-libopenmpt.mjs --smoke    # + evaluate the glue like the worklet does,
 *                                                    #   render audio, corrupt-input + heap-growth checks,
 *                                                    #   and boot each pair through the compiled processor
 *                                                    #   in a fake AudioWorkletGlobalScope
 *   node scripts/verify-js-libopenmpt.mjs --boot <glue.js> [--wasm <file>]
 *                                                    # only that worklet-scope boot, for any build
 *                                                    #   (CI: the --debug builds; the .wasm defaults
 *                                                    #   to the glue's sibling)
 *   node scripts/verify-js-libopenmpt.mjs --write --emcc 3.1.51 --eh wasm --simd 0 \
 *        --libopenmpt 0.8.9 --variant eh-wasm --artifact shared   # (called by scripts/build-js-libopenmpt.sh)
 *
 * Both pairs are always checked: `shared` (main thread + parser worker; must stay non-threaded)
 * and `playback` (the AudioWorklet's shared-memory heap and its create worker, #513).
 *
 * See scripts/jsEngineArtifacts.mjs for what is checked and why.
 */
import { resolve } from 'node:path';
import {
  buildManifest,
  checkArtifacts,
  resolveArtifactPaths,
  smokeArtifacts,
  smokePlaybackArtifacts,
  smokeWorkletBoot,
  JS_ENGINE_ARTIFACTS,
} from './jsEngineArtifacts.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

if (has('boot')) {
  const glue = resolve(arg('boot', ''));
  const wasm = resolve(arg('wasm', glue.replace(/\.js$/, '.wasm')));
  const { errors: bootErrors, peak } = await smokeWorkletBoot({ glue, wasm });
  if (bootErrors.length > 0) {
    console.error(`verify-js-libopenmpt --boot FAILED for ${glue}:`);
    for (const e of bootErrors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(
    `verify-js-libopenmpt --boot OK: ${glue} booted in a fake AudioWorkletGlobalScope through the compiled processor ` +
      `(peak ${peak.toFixed(3)}; corrupt input reported; a recoverable truncated IT still loads)`,
  );
  process.exit(0);
}

if (has('write')) {
  const artifact = arg('artifact', 'shared');
  const manifest = buildManifest({
    artifact,
    emcc: arg('emcc', 'unknown'),
    eh: arg('eh', 'wasm'),
    simd: arg('simd', '0'),
    libopenmpt: arg('libopenmpt', 'unknown'),
    variant: arg('variant', 'eh-wasm'),
    write: true,
  });
  console.log(`📝 wrote ${JS_ENGINE_ARTIFACTS[artifact].manifestRel}`);
  console.log(`   glue ${manifest.glue.bytes} B, wasm ${manifest.wasm.bytes} B, version ${manifest.version}`);
}

const errors = [];
const manifests = {};
// After --write only the pair just built is checked: the build script writes one pair at a time,
// and the other one may be the next to be rebuilt (stale against new flags until then).
const artifactsToCheck = has('write') ? [arg('artifact', 'shared')] : Object.keys(JS_ENGINE_ARTIFACTS);
for (const artifact of artifactsToCheck) {
  const result = checkArtifacts({ artifact });
  errors.push(...result.errors.map((e) => `[${artifact}] ${e}`));
  manifests[artifact] = result.manifest;
}
let smoke = null;
let playbackSmoke = null;
if (errors.length === 0 && has('smoke')) {
  try {
    smoke = await smokeArtifacts();
    errors.push(...smoke.errors.map((e) => `[shared] ${e}`));
    playbackSmoke = await smokePlaybackArtifacts();
    errors.push(...playbackSmoke.errors.map((e) => `[playback] ${e}`));
    for (const artifact of Object.keys(JS_ENGINE_ARTIFACTS)) {
      const p = resolveArtifactPaths(undefined, artifact);
      const boot = await smokeWorkletBoot({ glue: p.glue, wasm: p.wasm });
      errors.push(...boot.errors.map((e) => `[${artifact}, worklet scope] ${e}`));
    }
  } catch (e) {
    errors.push(`smoke test crashed: ${e instanceof Error ? (e.stack ?? e.message) : e}`);
  }
}

if (errors.length > 0) {
  console.error('verify-js-libopenmpt FAILED:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

const kb = (n) => `${(n / 1024).toFixed(1)} KiB`;
for (const [artifact, manifest] of Object.entries(manifests)) {
  console.log(
    `verify-js-libopenmpt OK [${artifact}]: glue ${kb(manifest.glue.bytes)} + wasm ${kb(manifest.wasm.bytes)} ` +
      `(libopenmpt ${manifest.libopenmpt}, emsdk ${manifest.emsdk}, ${manifest.variant}, ` +
      `${manifest.sharedMemory ? 'shared' : 'non-shared'} memory, v=${manifest.version})`,
  );
}
if (smoke) {
  console.log(
    `  smoke [shared]: init ${smoke.initMs.toFixed(0)} ms, peak ${smoke.peak.toFixed(3)}, ` +
      `corrupt input → NULL, truncated IT recovered, heap grew to ${smoke.heapMiB.toFixed(0)} MiB`,
  );
}
if (playbackSmoke) {
  console.log(
    `  smoke [playback]: 16 MiB IT created on the create worker in ${playbackSmoke.createMs.toFixed(0)} ms ` +
      `while the heap main thread rendered ${playbackSmoke.quantaDuringCreate} quanta; ` +
      `corrupt input → NULL there; truncated IT recovered on both threads; heap ${playbackSmoke.heapMiB.toFixed(0)} MiB`,
  );
  console.log('  smoke [worklet scope]: both pairs boot through the compiled processor, render, and recover');
}
