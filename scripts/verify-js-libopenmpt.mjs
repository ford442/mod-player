#!/usr/bin/env node
/**
 * Verify (or record) the real-WASM libopenmpt pair the default JS engine ships.
 *
 *   node scripts/verify-js-libopenmpt.mjs            # static checks (files, magic, exports, manifest)
 *   node scripts/verify-js-libopenmpt.mjs --smoke    # + evaluate the glue like the worklet does,
 *                                                    #   render audio, corrupt-input + heap-growth checks
 *   node scripts/verify-js-libopenmpt.mjs --write --emcc 3.1.51 --eh wasm --simd 0 \
 *        --libopenmpt 0.8.4 --variant eh-wasm      # (called by scripts/build-js-libopenmpt.sh)
 *
 * See scripts/jsEngineArtifacts.mjs for what is checked and why.
 */
import {
  buildManifest,
  checkArtifacts,
  smokeArtifacts,
  JS_ENGINE_MANIFEST_REL,
} from './jsEngineArtifacts.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

if (has('write')) {
  const manifest = buildManifest({
    emcc: arg('emcc', 'unknown'),
    eh: arg('eh', 'wasm'),
    simd: arg('simd', '0'),
    libopenmpt: arg('libopenmpt', '0.8.4'),
    variant: arg('variant', 'eh-wasm'),
    write: true,
  });
  console.log(`📝 wrote ${JS_ENGINE_MANIFEST_REL}`);
  console.log(`   glue ${manifest.glue.bytes} B, wasm ${manifest.wasm.bytes} B, version ${manifest.version}`);
}

const { errors, manifest } = checkArtifacts();
let smoke = null;
if (errors.length === 0 && has('smoke')) {
  try {
    smoke = await smokeArtifacts();
    errors.push(...smoke.errors);
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
console.log(
  `verify-js-libopenmpt OK: glue ${kb(manifest.glue.bytes)} + wasm ${kb(manifest.wasm.bytes)} ` +
    `(libopenmpt ${manifest.libopenmpt}, emsdk ${manifest.emsdk}, ${manifest.variant}, v=${manifest.version})`,
);
if (smoke) {
  console.log(
    `  smoke: init ${smoke.initMs.toFixed(0)} ms, peak ${smoke.peak.toFixed(3)}, ` +
      `corrupt input → NULL, heap grew to ${smoke.heapMiB.toFixed(0)} MiB`,
  );
}
