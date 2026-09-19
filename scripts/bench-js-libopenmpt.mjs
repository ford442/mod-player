#!/usr/bin/env node
/**
 * Node harness for the JS-engine libopenmpt glue (real wasm OR the old wasm2js glue).
 *
 * Mirrors what the AudioWorklet processor does — evaluate the glue with
 * `new Function`, seed `globalThis.libopenmpt`, wait for onRuntimeInitialized,
 * then render in 128-frame quanta — so numbers are comparable to the worklet's
 * `process()` budget (128 frames @ 48 kHz = 2.667 ms). V8 runs the same wasm
 * tiers here as in Chrome's AudioWorklet, but this is NOT a browser: treat
 * results as relative (wasm vs wasm2js, cubic vs sinc) rather than absolute.
 *
 * Usage:
 *   node scripts/bench-js-libopenmpt.mjs                          # committed glue, 4-mat_madness.mod
 *   node scripts/bench-js-libopenmpt.mjs --synth-xm 32            # 32-channel XM stress module
 *   node scripts/bench-js-libopenmpt.mjs --glue old.js --wasm none   # wasm2js baseline
 *   node scripts/bench-js-libopenmpt.mjs --hash --interp 4        # PCM parity fingerprint
 *
 * Options: --glue --wasm --module --synth-xm N --seconds N --interp 4,8 --rate 48000
 *          --hash (print sha256 of the rendered PCM) --json
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { synthXm } from './lib/synth-xm.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const QUANTUM = 128;
const PARAM_INTERP = 3; // OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH

function parseArgs(argv) {
  const out = {
    glue: join(ROOT, 'public/worklets/libopenmpt-worklet.js'),
    wasm: undefined,
    module: join(ROOT, 'public/4-mat_madness.mod'),
    synthXm: 0,
    seconds: 20,
    interp: [4, 8],
    rate: 48000,
    hash: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--glue') out.glue = resolve(next());
    else if (a === '--wasm') out.wasm = next();
    else if (a === '--module') out.module = resolve(next());
    else if (a === '--synth-xm') out.synthXm = Number(next());
    else if (a === '--seconds') out.seconds = Number(next());
    else if (a === '--interp') out.interp = next().split(',').map(Number);
    else if (a === '--rate') out.rate = Number(next());
    else if (a === '--hash') out.hash = true;
    else if (a === '--json') out.json = true;
    else throw new Error(`Unknown option ${a}`);
  }
  return out;
}

async function loadGlue(glueText, wasmBytes) {
  const t0 = performance.now();
  globalThis.libopenmpt = { noInitialRun: true };
  if (wasmBytes) globalThis.libopenmpt.wasmBinary = wasmBytes;
  new Function(glueText.replace(/^\s*export\s+(default\s+)?/gm, '')).call(globalThis);
  const lib = globalThis.libopenmpt;
  await new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('runtime init timeout')), 60000);
    const done = () => { clearTimeout(to); res(); };
    if (lib.calledRun) done();
    else {
      const prev = lib.onRuntimeInitialized;
      lib.onRuntimeInitialized = () => { prev?.(); done(); };
    }
  });
  return { lib, initMs: performance.now() - t0 };
}

function createModule(lib, bytes) {
  const filePtr = lib._malloc(bytes.byteLength);
  lib.HEAPU8.set(bytes, filePtr);
  const mod = lib._openmpt_module_create_from_memory2(filePtr, bytes.byteLength, 0, 0, 0, 0, 0, 0, 0);
  lib._free(filePtr);
  if (!mod) throw new Error('openmpt_module_create_from_memory2 returned 0');
  return mod;
}

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function renderRun(lib, moduleBytes, interp, seconds, rate, wantHash) {
  const mod = createModule(lib, moduleBytes);
  lib._openmpt_module_set_render_param(mod, PARAM_INTERP, interp);
  const left = lib._malloc(4 * QUANTUM);
  const right = lib._malloc(4 * QUANTUM);
  const quanta = Math.floor((seconds * rate) / QUANTUM);
  const times = new Float64Array(quanta);
  const hash = wantHash ? createHash('sha256') : null;
  let ended = 0;
  const sink = new Float32Array(QUANTUM * 2);
  for (let q = 0; q < quanta; q++) {
    const t0 = performance.now();
    const n = lib._openmpt_module_read_float_stereo(mod, rate, QUANTUM, left, right);
    // Same per-sample copy the processor performs out of the heap views.
    const l = new Float32Array(lib.HEAPF32.buffer, left, QUANTUM);
    const r = new Float32Array(lib.HEAPF32.buffer, right, QUANTUM);
    for (let i = 0; i < n; i++) { sink[i] = l[i]; sink[QUANTUM + i] = r[i]; }
    times[q] = performance.now() - t0;
    if (n === 0) ended++;
    if (hash) hash.update(Buffer.from(sink.buffer, 0, sink.byteLength));
  }
  lib._free(left); lib._free(right);
  lib._openmpt_module_destroy(mod);

  const warm = Math.floor((2 * rate) / QUANTUM); // drop first 2 s: wasm tier-up + cold caches
  const steady = Array.from(times.subarray(Math.min(warm, quanta - 1))).sort((a, b) => a - b);
  const all = Array.from(times).sort((a, b) => a - b);
  const budgetMs = (QUANTUM / rate) * 1000;
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  return {
    interp,
    budgetMs,
    quanta,
    endedQuanta: ended,
    firstSecondMaxMs: Math.max(...times.subarray(0, Math.floor(rate / QUANTUM))),
    meanMs: mean(steady),
    p50Ms: percentile(steady, 0.5),
    p99Ms: percentile(steady, 0.99),
    p999Ms: percentile(steady, 0.999),
    maxMs: steady[steady.length - 1],
    overBudget: steady.filter((x) => x > budgetMs).length,
    meanPctBudget: (mean(steady) / budgetMs) * 100,
    p99PctBudget: (percentile(steady, 0.99) / budgetMs) * 100,
    realtimeFactor: budgetMs / mean(steady),
    allMaxMs: all[all.length - 1],
    pcmSha256: hash ? hash.digest('hex') : undefined,
  };
}

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  const glueText = readFileSync(opt.glue, 'utf8');
  const isWasm2js = /isWasm2js\s*:\s*(!0|true)/.test(glueText);
  let wasmBytes;
  if (!isWasm2js && opt.wasm !== 'none') {
    wasmBytes = readFileSync(opt.wasm ?? opt.glue.replace(/\.js$/, '.wasm'));
  }
  const { lib, initMs } = await loadGlue(glueText, wasmBytes);
  const moduleBytes = opt.synthXm ? synthXm(opt.synthXm) : new Uint8Array(readFileSync(opt.module));
  const label = opt.synthXm ? `synthetic ${opt.synthXm}-ch XM` : opt.module.split('/').pop();

  const runs = opt.interp.map((i) => renderRun(lib, moduleBytes, i, opt.seconds, opt.rate, opt.hash));
  const report = {
    glue: opt.glue.replace(`${ROOT}/`, ''),
    engine: isWasm2js ? 'wasm2js' : 'wasm',
    glueBytes: glueText.length,
    wasmBytes: wasmBytes?.byteLength ?? 0,
    initMs,
    heapPagesAfterInit: lib.HEAPU8.length / 65536,
    module: label,
    seconds: opt.seconds,
    rate: opt.rate,
    node: process.version,
    runs,
  };
  if (opt.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`${report.engine} | ${report.glue} | init ${initMs.toFixed(0)} ms | heap ${(report.heapPagesAfterInit * 64 / 1024).toFixed(0)} MiB | ${label} | ${opt.seconds}s @ ${opt.rate} Hz, ${QUANTUM}-frame quanta (budget ${runs[0].budgetMs.toFixed(3)} ms)`);
  console.log('interp  mean ms  p50 ms   p99 ms   max ms  mean%budget  p99%budget  xRealtime  over-budget');
  for (const r of runs) {
    console.log(
      `${String(r.interp).padStart(6)}  ${r.meanMs.toFixed(4).padStart(7)}  ${r.p50Ms.toFixed(4).padStart(6)}  ${r.p99Ms.toFixed(4).padStart(7)}  ${r.maxMs.toFixed(3).padStart(7)}  ${r.meanPctBudget.toFixed(1).padStart(10)}%  ${r.p99PctBudget.toFixed(1).padStart(9)}%  ${r.realtimeFactor.toFixed(1).padStart(9)}  ${String(r.overBudget).padStart(11)}` +
        (r.pcmSha256 ? `  sha256=${r.pcmSha256.slice(0, 16)}` : ''),
    );
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
