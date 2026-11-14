#!/usr/bin/env node
/**
 * Decode the `wasm-function[N]` frames of a fault report ("Copy diagnostics" in the debug panel,
 * utils/faultReport.ts) into libopenmpt function names, offline.
 *
 *   node scripts/symbolicate.mjs report.json                    # readable listing on stdout
 *   node scripts/symbolicate.mjs report.json --json > out.json  # the report, each fault + `symbolicated`
 *   node scripts/symbolicate.mjs report.json --maps ~/Downloads/libopenmpt-symbol-maps
 *   node scripts/symbolicate.mjs stack.txt --pair libopenmpt-playback [--key b08513c59f]
 *
 * Maps are looked up as `<pair>.<?v= key>.symbols` in every `--maps` directory, then in
 * `vendor/symbol-maps/` (written by `npm run build:js-libopenmpt`). For a report from a deployed
 * build, download the `libopenmpt-symbol-maps` artifact of the CI run that built its wasm (the
 * `js-libopenmpt-rebuild` job), unzip it, and pass the directory with `--maps`.
 *
 * A plain-text input (not JSON) is treated as one stack trace, decoded against `--pair` (default
 * libopenmpt-worklet) at `--key` (default: the key of the wasm committed in this checkout).
 *
 * Exit status: 0 when every frame was named, 1 when some were not (or a map was missing), 2 on a
 * usage error.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WASM_PAIRS, symbolicateReport } from './lib/symbolicate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {string} [message]
 * @returns {never}
 */
function usage(message) {
  if (message) console.error(`symbolicate: ${message}`);
  console.error('usage: node scripts/symbolicate.mjs <report.json | stack.txt> [--maps <dir>]... [--json] [--pair <pair>] [--key <v>]');
  process.exit(2);
}

/** The `?v=` keys of the pairs committed in this checkout (audio-worklet/js/*.generated.json). */
function committedKeys() {
  /** @type {Record<string, string>} */
  const keys = {};
  for (const pair of WASM_PAIRS) {
    try {
      const manifest = JSON.parse(readFileSync(join(ROOT, 'audio-worklet/js', `${pair}.generated.json`), 'utf8'));
      if (typeof manifest.version === 'string') keys[pair] = manifest.version;
    } catch { /* not built in this checkout */ }
  }
  return keys;
}

const args = process.argv.slice(2);
/** @type {string[]} */
const mapDirs = [];
/** @type {string | null} */
let input = null;
let asJson = false;
/** @type {string | null} */
let pair = null;
/** @type {string | null} */
let key = null;
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--maps') mapDirs.push(resolve(args[++i] ?? usage('--maps needs a directory')));
  else if (arg === '--json') asJson = true;
  else if (arg === '--pair') pair = args[++i] ?? usage('--pair needs a value');
  else if (arg === '--key') key = args[++i] ?? usage('--key needs a value');
  else if (arg === '-h' || arg === '--help') usage();
  else if (arg.startsWith('--')) usage(`unknown option ${arg}`);
  else if (input === null) input = arg;
  else usage('one input file at a time');
}
if (input === null) usage('no input file');
if (pair !== null && !(/** @type {readonly string[]} */ (WASM_PAIRS)).includes(pair)) usage(`--pair must be one of ${WASM_PAIRS.join(', ')}`);
mapDirs.push(join(ROOT, 'vendor/symbol-maps'));

const text = readFileSync(/** @type {string} */ (input), 'utf8');
let report;
let isText = false;
try {
  report = JSON.parse(text);
} catch {
  isText = true;
  const p = pair ?? 'libopenmpt-worklet';
  report = { faults: [{ kind: 'stack', source: input, message: '', stack: text, wasmPair: p, context: { assets: key ? { [p]: key } : {} } }] };
}

const fallbackKeys = committedKeys();
let result;
try {
  result = symbolicateReport(report, { mapDirs, fallbackKeys: key && pair ? { ...fallbackKeys, [pair]: key } : fallbackKeys });
} catch (e) {
  usage(e instanceof Error ? e.message : String(e));
}

if (asJson) {
  process.stdout.write(`${JSON.stringify(isText ? report.faults[0] : result.report, null, 2)}\n`);
} else {
  const faults = Array.isArray(result.report) ? result.report : (result.report.faults ?? [result.report]);
  for (const fault of faults) {
    const s = fault.symbolicated;
    if (!isText) console.log(`── ${fault.at ?? '?'}  ${fault.kind ?? '?'}  ${fault.source ?? ''}`);
    if (!s) {
      if (!isText) console.log(`   ${fault.message ?? ''}  (no wasm frames)`);
      continue;
    }
    if (s.message) console.log(s.message.replace(/^/gm, '   '));
    if (s.stack) console.log(s.stack.replace(/^/gm, '   '));
    if (s.maps.length) console.log(`   maps: ${s.maps.join(', ')}`);
  }
}

console.error(`symbolicate: ${result.resolved} frame(s) named, ${result.unresolved} not`);
if (result.missing.length > 0) {
  console.error(`symbolicate: missing symbol map(s): ${result.missing.join(', ')}`);
  console.error('  Looked in: ' + mapDirs.join(', '));
  console.error('  Get them from the `libopenmpt-symbol-maps` artifact of the CI run that built that wasm, and pass --maps <dir>.');
}
process.exit(result.unresolved > 0 || result.missing.length > 0 ? 1 : 0);
