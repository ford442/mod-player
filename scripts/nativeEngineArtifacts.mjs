/**
 * Classify the optional native Emscripten engine trio under a worklets dir.
 *
 *   openmpt-native.js
 *   openmpt-native.wasm
 *   openmpt-native.aw.js
 *
 * Status:
 *   absent   — none of the three exist (intentional unbuilt engine)
 *   complete — all three exist and look like real artifacts
 *   partial  — 1 or 2 of 3 exist (always a broken build)
 *   invalid  — all three exist but wasm/JS fail content checks
 *
 * Usage:
 *   node scripts/nativeEngineArtifacts.mjs [dir]
 *   node scripts/nativeEngineArtifacts.mjs dist/worklets --require-complete
 *
 * Exit 0: complete or absent (unless --require-complete, then absent is 1)
 * Exit 1: partial, invalid, or absent with --require-complete
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const WASM_MAGIC = Buffer.from([0x00, 0x61, 0x73, 0x6d]); // \0asm

export const NATIVE_TRIO = Object.freeze([
  'openmpt-native.js',
  'openmpt-native.wasm',
  'openmpt-native.aw.js',
]);

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

function fileExists(filePath) {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * @param {string} workletsDir
 * @returns {{
 *   status: 'absent' | 'complete' | 'partial' | 'invalid',
 *   present: string[],
 *   missing: string[],
 *   sizes: Record<string, number>,
 *   errors: string[],
 * }}
 */
export function classifyNativeEngine(workletsDir) {
  const present = [];
  const missing = [];
  const sizes = {};
  const errors = [];

  for (const name of NATIVE_TRIO) {
    const filePath = join(workletsDir, name);
    if (!fileExists(filePath)) {
      missing.push(name);
      continue;
    }
    present.push(name);
    try {
      sizes[name] = statSync(filePath).size;
    } catch (e) {
      sizes[name] = 0;
      errors.push(`${name}: cannot stat (${e instanceof Error ? e.message : e})`);
    }
  }

  if (present.length === 0) {
    return { status: 'absent', present, missing, sizes, errors };
  }
  if (present.length < NATIVE_TRIO.length) {
    errors.push(
      `partial native engine set: present ${present.join(', ')}; missing ${missing.join(', ')}`,
    );
    return { status: 'partial', present, missing, sizes, errors };
  }

  for (const name of NATIVE_TRIO) {
    const filePath = join(workletsDir, name);
    let buf;
    try {
      buf = readFileSync(filePath);
    } catch (e) {
      errors.push(`${name}: cannot read (${e instanceof Error ? e.message : e})`);
      continue;
    }
    if (buf.length === 0) {
      errors.push(`${name}: empty file`);
      continue;
    }
    if (looksLikeHtmlOrText(buf)) {
      errors.push(
        `${name}: content looks like HTML/text (e.g. 404 page), not a native engine artifact`,
      );
      continue;
    }
    if (name.endsWith('.wasm')) {
      if (buf.length < 4 || !buf.subarray(0, 4).equals(WASM_MAGIC)) {
        const preview = buf.subarray(0, Math.min(16, buf.length)).toString('hex');
        errors.push(
          `${name}: missing WebAssembly magic \\0asm (got hex ${preview || '(empty)'})`,
        );
      }
    }
  }

  if (errors.length > 0) {
    return { status: 'invalid', present, missing, sizes, errors };
  }
  return { status: 'complete', present, missing, sizes, errors };
}

export function formatNativeEngineSummary(result) {
  if (result.status === 'complete') {
    const sizeBits = result.present
      .map((n) => `${n} ${result.sizes[n] ?? 0} bytes`)
      .join(', ');
    return `native-engine: COMPLETE (${sizeBits})`;
  }
  if (result.status === 'absent') {
    return (
      'native-engine: ABSENT — run `npm run build:emcc` before deploy if you need ' +
      '`?engine=native`; without these artifacts it will soft-fail to the JS worklet'
    );
  }
  if (result.status === 'partial') {
    return `native-engine: PARTIAL — ${result.errors.join('; ') || 'incomplete trio'}`;
  }
  return `native-engine: INVALID — ${result.errors.join('; ')}`;
}

function parseCli(argv) {
  const rest = argv.slice(2).filter((a) => a !== '--');
  const requireComplete = rest.includes('--require-complete');
  const dir = rest.find((a) => !a.startsWith('--')) || join('dist', 'worklets');
  return { dir, requireComplete };
}

export function exitCodeForResult(result, requireComplete = false) {
  if (result.status === 'complete') return 0;
  if (result.status === 'absent') return requireComplete ? 1 : 0;
  return 1;
}

function main() {
  const { dir, requireComplete } = parseCli(process.argv);
  const result = classifyNativeEngine(dir);
  console.log(formatNativeEngineSummary(result));
  console.log(JSON.stringify(result));
  process.exit(exitCodeForResult(result, requireComplete));
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main();
}
