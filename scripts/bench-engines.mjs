#!/usr/bin/env node
/**
 * CPU per render quantum: JS engine vs native engine, same V8 (#491 Phase 3).
 *
 *   JS      the compiled processor (public/worklets/openmpt-worklet.js) with the committed
 *           libopenmpt-worklet.{js,wasm}, in a fake AudioWorkletGlobalScope — the exact
 *           process() the AudioWorklet runs, position / VU reporting included.
 *   native  NativeEngine::process() from vendor/native-bench (scripts/build-native-bench.sh:
 *           the shipped engine's flags and libopenmpt.a, built for Node).
 *
 * Each (module, interpolation) pair is rendered by both engines in interleaved rounds; every
 * quantum is timed. "load" is the parse: on the JS engine it runs inside the worklet's message
 * handler — on the audio thread — and on the native engine in load_module() on the main thread.
 * "heap" is the engine's wasm linear memory after the load (the JS worklet's libopenmpt grows on
 * demand; the native engine reserves a fixed 128 MiB).
 * Node/V8 is not Chrome's audio thread: compare the engines with each other, not with the budget.
 *
 *   npm run build:emcc && bash scripts/build-native-bench.sh
 *   node scripts/bench-engines.mjs [--seconds 30] [--rounds 3] [--interp 8,4] [--json out.json] [--markdown out.md]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { synthIt } from './lib/synth-it.mjs';
import { synthXm } from './lib/synth-xm.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (rel) => readFileSync(join(ROOT, rel));
const RATE = 48000;
const QUANTUM = 128;
const BUDGET_MS = (QUANTUM / RATE) * 1000;

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SECONDS = Number(opt('seconds', '30'));
const ROUNDS = Number(opt('rounds', '3'));
const INTERPS = opt('interp', '8,4').split(',').map(Number);
const JSON_OUT = opt('json', '');
const MARKDOWN_OUT = opt('markdown', '');

// Message type strings come from the single source the app and the worklet share.
const protocol = read('audio-worklet/workletProtocolConstants.ts').toString('utf8');
const MT = Object.fromEntries(['initLib', 'load', 'setRenderParam'].map((k) => {
  const m = protocol.match(new RegExp(`\\b${k}: '([^']+)'`));
  if (!m) throw new Error(`workletProtocolConstants.ts: no ${k}`);
  return [k, m[1]];
}));

const BIG = synthIt(64, { sampleFrames: Number(opt('big-frames', String(1 << 23))) }); // 16 MiB of samples
const MODULES = [
  { name: 'synthetic 64-ch IT', bytes: synthIt(64) },
  { name: 'synthetic 32-ch XM', bytes: synthXm(32) },
  { name: '4-mat_madness.mod (4 ch)', bytes: new Uint8Array(read('public/4-mat_madness.mod')) },
];

function stats(times) {
  const t = Float64Array.from(times).sort();
  const n = t.length;
  const q = (x) => t[Math.min(n - 1, Math.floor(x * n))];
  const mean = t.reduce((a, b) => a + b, 0) / n;
  return {
    quanta: n,
    meanMs: mean,
    p50Ms: q(0.5),
    p99Ms: q(0.99),
    p999Ms: q(0.999),
    maxMs: t[n - 1],
    overBudget: t.filter((x) => x > BUDGET_MS).length,
  };
}

// ── JS engine: the compiled processor in a fake AudioWorkletGlobalScope ──
async function jsEngine() {
  const posted = [];
  class AudioWorkletProcessor {
    constructor() {
      this.port = { onmessage: null, postMessage: (m) => { posted.push(m.type); } };
    }
  }
  let Processor = null;
  const sandbox = {
    AudioWorkletProcessor,
    registerProcessor: (_name, ctor) => { Processor = ctor; },
    currentTime: 0,
    sampleRate: RATE,
    SharedArrayBuffer,
    WebAssembly,
    setTimeout,
    clearTimeout,
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(read('public/worklets/openmpt-worklet.js').toString('utf8'), ctx, { filename: 'openmpt-worklet.js' });
  const toRealm = vm.runInContext('(function (a) { var u = new Uint8Array(a.length); u.set(a); return u.buffer; })', ctx);
  const node = new Processor({});
  const send = async (data) => { await node.port.onmessage?.({ data }); };
  await send({
    type: MT.initLib,
    scriptText: read('public/worklets/libopenmpt-worklet.js').toString('utf8'),
    wasmBytes: toRealm(read('public/worklets/libopenmpt-worklet.wasm')),
  });
  const l = new Float32Array(QUANTUM);
  const r = new Float32Array(QUANTUM);
  const outputs = [[l, r]];
  return {
    async load(bytes, interp) {
      await send({ type: MT.setRenderParam, param: 3, value: interp });
      const t0 = performance.now();
      await send({ type: MT.load, moduleData: toRealm(bytes) });
      const ms = performance.now() - t0;
      if (!posted.includes('loaded')) throw new Error('JS engine did not ack the load');
      posted.length = 0;
      return ms;
    },
    heapBytes() {
      return node.lib?.HEAPU8?.length ?? null;
    },
    render(quanta) {
      const times = new Float64Array(quanta);
      let peak = 0;
      for (let i = 0; i < quanta; i++) {
        sandbox.currentTime += QUANTUM / RATE;
        const t0 = performance.now();
        node.process([[]], outputs, {});
        times[i] = performance.now() - t0;
        for (let k = 0; k < QUANTUM; k++) peak = Math.max(peak, Math.abs(l[k]), Math.abs(r[k]));
      }
      return { times, peak };
    },
  };
}

// ── native engine: NativeEngine::process() built for Node ──
async function nativeEngine() {
  const glue = join(ROOT, 'vendor/native-bench/native-bench.cjs');
  if (!existsSync(glue)) {
    throw new Error('vendor/native-bench/native-bench.cjs missing — run npm run build:emcc && bash scripts/build-native-bench.sh');
  }
  const M = await createRequire(import.meta.url)(glue)();
  return {
    async load(bytes, interp) {
      M._bench_render_param(3, interp);
      const ptr = M._malloc(bytes.length);
      M.HEAPU8.set(bytes, ptr);
      const ms = M._bench_load(ptr, bytes.length); // adopts ptr
      if (ms < 0) throw new Error(`native load failed: ${M.UTF8ToString(M._bench_error())}`);
      return ms;
    },
    heapBytes() {
      return M.HEAPU8.length;
    },
    render(quanta) {
      let peak = 0;
      const times = new Float64Array(quanta);
      // In chunks, so the peak check sees every quantum's output.
      for (let i = 0; i < quanta; i++) {
        M._bench_render(1);
        times[i] = M.HEAPF64[M._bench_times() >> 3];
        peak = Math.max(peak, M._bench_peak());
      }
      return { times, peak };
    },
  };
}

const engines = { js: await jsEngine(), native: await nativeEngine() };
const warmQuanta = Math.round((2 * RATE) / QUANTUM);
const quanta = Math.round((SECONDS * RATE) / QUANTUM);
const results = [];

for (let round = 1; round <= ROUNDS; round++) {
  for (const mod of MODULES) {
    for (const interp of INTERPS) {
      for (const name of round % 2 ? ['js', 'native'] : ['native', 'js']) {
        const engine = engines[name];
        const loadMs = await engine.load(mod.bytes, interp);
        engine.render(warmQuanta); // tier-up
        const { times, peak } = engine.render(quanta);
        const s = stats(times);
        results.push({ round, engine: name, module: mod.name, interp, loadMs, peak, heapBytes: engine.heapBytes(), ...s });
        console.error(`round ${round} ${name.padEnd(6)} ${mod.name.padEnd(26)} interp ${interp}: `
          + `p50 ${s.p50Ms.toFixed(4)} ms, mean ${s.meanMs.toFixed(4)}, p99 ${s.p99Ms.toFixed(3)}, `
          + `over ${s.overBudget}/${s.quanta}, load ${loadMs.toFixed(2)} ms, peak ${peak.toFixed(3)}`);
      }
    }
  }
}

// Parse cost of a big upload (16 MiB of sample data): where it runs matters more than how long.
const bigLoad = {};
for (const name of ['js', 'native']) {
  const ms = [];
  for (let i = 0; i < Math.max(3, ROUNDS); i++) ms.push(await engines[name].load(BIG, 8));
  ms.sort((a, b) => a - b);
  bigLoad[name] = { medianMs: ms[Math.floor(ms.length / 2)], heapMiB: engines[name].heapBytes() / 1048576 };
  console.error(`big upload ${name}: parse ${bigLoad[name].medianMs.toFixed(1)} ms, heap ${bigLoad[name].heapMiB.toFixed(0)} MiB`);
}

// Median over rounds, per (module, interp, engine).
const summary = [];
for (const mod of MODULES) {
  for (const interp of INTERPS) {
    const row = { module: mod.name, interp };
    for (const name of ['js', 'native']) {
      const rs = results.filter((r) => r.engine === name && r.module === mod.name && r.interp === interp);
      const med = (k) => rs.map((r) => r[k]).sort((a, b) => a - b)[Math.floor(rs.length / 2)];
      row[name] = {
        p50Ms: med('p50Ms'), meanMs: med('meanMs'), p99Ms: med('p99Ms'), overBudget: med('overBudget'),
        loadMs: med('loadMs'), heapMiB: med('heapBytes') / 1048576,
      };
    }
    row.nativeVsJsP50 = row.native.p50Ms / row.js.p50Ms;
    summary.push(row);
  }
}
const bigBytes = BIG.length;
console.log(JSON.stringify({ node: process.version, seconds: SECONDS, rounds: ROUNDS, summary, bigLoad: { bytes: bigBytes, ...bigLoad } }, null, 2));
if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({ node: process.version, seconds: SECONDS, rounds: ROUNDS, summary, bigLoad: { bytes: bigBytes, ...bigLoad }, results }, null, 2));
}
if (MARKDOWN_OUT) {
  const f = (x, d = 4) => (typeof x === 'number' ? x.toFixed(d) : '—');
  const lines = [
    `### CPU per render quantum — JS vs native (Node ${process.version}, ${SECONDS} s × ${ROUNDS} rounds, median of rounds)`,
    '',
    '| module | interp | JS p50 ms | native p50 ms | native / JS | JS p99 ms | native p99 ms | JS load ms | native load ms | JS heap MiB | native heap MiB |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    ...summary.map((r) => `| ${r.module} | ${r.interp} | ${f(r.js.p50Ms)} | ${f(r.native.p50Ms)} | ${f(r.nativeVsJsP50, 2)} | `
      + `${f(r.js.p99Ms, 3)} | ${f(r.native.p99Ms, 3)} | ${f(r.js.loadMs, 1)} | ${f(r.native.loadMs, 1)} | `
      + `${f(r.js.heapMiB, 0)} | ${f(r.native.heapMiB, 0)} |`),
    '',
    `Big upload (${(bigBytes / 1048576).toFixed(1)} MiB 64-ch IT, median parse): JS ${f(bigLoad.js.medianMs, 1)} ms `
      + `(on the audio thread, heap → ${f(bigLoad.js.heapMiB, 0)} MiB) · native ${f(bigLoad.native.medianMs, 1)} ms `
      + `(main thread, fixed ${f(bigLoad.native.heapMiB, 0)} MiB)`,
    '',
  ];
  writeFileSync(MARKDOWN_OUT, lines.join('\n'));
}
