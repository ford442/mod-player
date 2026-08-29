/**
 * Shared native-engine artifact contract for verify-build and deploy.
 *
 * When VITE_NATIVE_ENGINE=1 or VITE_NATIVE_PARITY_GATE=1, dist/worklets/openmpt-native.*
 * must exist and openmpt-native.wasm must pass the wasm header check.
 */
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { validateWasmFile } from './verify-wasm-assets.mjs';

export const NATIVE_WORKLET_FILES = [
  'worklets/openmpt-native.js',
  'worklets/openmpt-native.wasm',
  'worklets/openmpt-native.aw.js',
];

/** True when build/deploy expects native glue in dist/. */
export function isNativeEngineExpected(env = process.env) {
  return env.VITE_NATIVE_ENGINE === '1' || env.VITE_NATIVE_PARITY_GATE === '1';
}

/**
 * Verify native worklet artifacts under buildDir.
 * @returns {{ ok: boolean, errors: string[], present: boolean }}
 */
export function verifyNativeWorkletArtifacts(buildDir, env = process.env) {
  const errors = [];
  let anyPresent = false;
  let allPresent = true;

  for (const rel of NATIVE_WORKLET_FILES) {
    const filePath = join(buildDir, rel);
    if (!existsSync(filePath)) {
      allPresent = false;
      errors.push(`missing native worklet artifact: ${rel}`);
      continue;
    }
    anyPresent = true;
    const size = statSync(filePath).size;
    if (size === 0) {
      allPresent = false;
      errors.push(`${rel}: file is empty`);
    }
  }

  const wasmPath = join(buildDir, 'worklets/openmpt-native.wasm');
  if (existsSync(wasmPath) && statSync(wasmPath).size > 0) {
    errors.push(
      ...validateWasmFile(wasmPath, { relPath: 'worklets/openmpt-native.wasm' }),
    );
  }

  const ok = allPresent && errors.length === 0;
  return { ok, errors, present: anyPresent };
}
