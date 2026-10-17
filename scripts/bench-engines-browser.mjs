#!/usr/bin/env node
/**
 * JS engine vs native engine on the real AudioWorklet, headless Chromium (#491 Phase 3).
 *
 * Engine-level, without the React app (whose main-thread UI work for a 64-channel pattern grid
 * would dominate every timing here): each engine is wired exactly as the app wires it — the one
 * 48 kHz / 'playback' AudioContext, the compiled openmpt-processor with the committed
 * libopenmpt-worklet pair (initLib → setRenderParam → load), or openmpt-native.{js,wasm}
 * (init_audio_with_context → load_module → commit_module → resume_audio). Fresh browser per run,
 * engines interleaved.
 *
 *   steady        AudioContext.playbackStats underruns over STEADY_MS of a synthetic 64-channel
 *                 IT (scripts/lib/synth-it.mjs: up to 128 live voices), per minute of audio
 *   track change  underruns from loading a second 64-ch IT while the first plays until 4 s later —
 *                 the JS engine parses inside its AudioWorklet message handler (the audio thread),
 *                 the native engine in load_module() on the main thread — and the time until the
 *                 engine has the new module (JS 'loaded' ack / native commit), plus how long the
 *                 main thread was blocked by the load call itself
 * (Heap is measured by scripts/bench-engines.mjs: performance.measureUserAgentSpecificMemory()
 * does not attribute an AudioWorklet's memory, so it cannot compare the two engines.)
 *
 *   npm run build:emcc && npm run build && npm run preview -- --port 4391 &
 *   BASE_URL=http://127.0.0.1:4391 node scripts/bench-engines-browser.mjs [--rounds 3] [--json out.json] [--markdown out.md]
 */
import { writeFileSync } from 'node:fs';
import { launchBrowser, openPage, goto, evaluate } from './lib/browser-launch.mjs';
import { synthIt } from './lib/synth-it.mjs';

const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:4173').replace(/\/$/, '');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const ROUNDS = Number(opt('rounds', '3'));
const STEADY_MS = Number(opt('steady-ms', '30000'));
const CHANGES = Number(opt('changes', '5'));
const JSON_OUT = opt('json', '');
const MARKDOWN_OUT = opt('markdown', '');

const TRACK_A = Array.from(synthIt(64));
const TRACK_B = Array.from(synthIt(63));

async function runOnce(engineName) {
  const { browser, engine, close } = await launchBrowser();
  try {
    const { page } = await openPage(browser, engine);
    // Any same-origin document served with COOP/COEP; it must not be the app.
    await goto(page, engine, `${BASE_URL}/worklets/README.md`, 60000);
    return await evaluate(page, async ({ engineName: which, a, b, steadyMs, changes }) => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'playback' });
      await ctx.resume();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.connect(ctx.destination);
      const rms = () => {
        const d = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(d);
        let s = 0;
        for (const v of d) s += v * v;
        return Math.sqrt(s / d.length);
      };
      const stats = () => {
        const s = ctx.playbackStats;
        return { events: s.underrunEvents, duration: s.underrunDuration, total: s.totalDuration };
      };
      const delta = (s0, s1) => {
        const seconds = s1.total - s0.total;
        return {
          seconds,
          underrunEvents: s1.events - s0.events,
          underrunMs: (s1.duration - s0.duration) * 1000,
          eventsPerMinute: seconds > 0 ? ((s1.events - s0.events) * 60) / seconds : null,
        };
      };

      /** @type {{ load: (bytes: Uint8Array) => Promise<{ readyMs: number, blockedMs: number }> }} */
      let eng;
      if (which === 'js') {
        await ctx.audioWorklet.addModule('/worklets/openmpt-worklet.js');
        const node = new AudioWorkletNode(ctx, 'openmpt-processor', {
          numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { baseUrl: '/' },
        });
        node.connect(analyser);
        let onLoaded = null;
        node.port.onmessage = (e) => { if (e.data?.type === 'loaded' && onLoaded) onLoaded(); };
        const [glue, wasm] = await Promise.all([
          fetch('/worklets/libopenmpt-worklet.js').then((r) => r.text()),
          fetch('/worklets/libopenmpt-worklet.wasm').then((r) => r.arrayBuffer()),
        ]);
        node.port.postMessage({ type: 'initLib', scriptText: glue, wasmBytes: wasm }, [wasm]);
        node.port.postMessage({ type: 'setRenderParam', param: 3, value: 8 }); // Sinc+LP, as the app
        eng = {
          load: (bytes) => new Promise((resolve) => {
            const t0 = performance.now();
            onLoaded = () => { onLoaded = null; resolve({ readyMs: performance.now() - t0, blockedMs }); };
            const copy = bytes.slice().buffer;
            const tb = performance.now();
            node.port.postMessage({ type: 'load', moduleData: copy }, [copy]);
            const blockedMs = performance.now() - tb;
          }),
        };
      } else {
        const addModule = AudioWorklet.prototype.addModule;
        AudioWorklet.prototype.addModule = function (url, options) {
          let u = url;
          if (typeof u === 'string' && /openmpt-native\.aw\.js/.test(u) && !u.includes('/worklets/')) u = `/worklets/${u.split('/').pop()}`;
          return addModule.call(this, u, options);
        };
        const ns = await import('/worklets/openmpt-native.js');
        const M = await (ns.default ?? ns.createOpenMPTModule)({ locateFile: (p) => `/worklets/${p}`, print: () => {}, printErr: () => {} });
        M._init_audio_with_context(M.emscriptenRegisterAudioObject(ctx), 48000);
        const t0 = performance.now();
        while (!M._get_worklet_node() && performance.now() - t0 < 8000) await sleep(20);
        M.emscriptenGetAudioObject(M._get_worklet_node()).connect(analyser);
        let started = false;
        eng = {
          load: async (bytes) => {
            const t = performance.now();
            const ptr = M._malloc(bytes.length);
            M.HEAPU8.set(bytes, ptr);
            if (!M._load_module(ptr, bytes.length) || !M._commit_module()) throw new Error('native load failed');
            if (!started) { M._resume_audio(); started = true; }
            const blockedMs = performance.now() - t; // parse + snapshot run on this (main) thread
            return { readyMs: blockedMs, blockedMs };
          },
        };
      }

      const A = new Uint8Array(a);
      const B = new Uint8Array(b);
      await eng.load(A);
      const ta = performance.now();
      while (rms() < 0.005 && performance.now() - ta < 10000) await sleep(10);
      if (rms() < 0.005) return { error: `${which}: no audio from the first module` };
      await sleep(3000);

      const s0 = stats();
      await sleep(steadyMs);
      const steady = delta(s0, stats());

      const loads = [];
      const c0 = stats();
      for (let i = 0; i < changes; i++) {
        loads.push(await eng.load(i % 2 ? A : B));
        await sleep(4000);
      }
      const trackChange = delta(c0, stats());

      const med = (xs) => xs.slice().sort((p, q) => p - q)[Math.floor(xs.length / 2)];
      return {
        steady,
        trackChange: {
          ...trackChange,
          changes,
          readyMsMedian: med(loads.map((l) => l.readyMs)),
          mainThreadBlockedMsMedian: med(loads.map((l) => l.blockedMs)),
        },
        stillAudible: rms() > 0.005,
      };
    }, { engineName, a: TRACK_A, b: TRACK_B, steadyMs: STEADY_MS, changes: CHANGES });
  } finally {
    await close();
  }
}

const results = [];
for (let round = 1; round <= ROUNDS; round++) {
  for (const name of round % 2 ? ['js', 'native'] : ['native', 'js']) {
    const r = await runOnce(name);
    results.push({ round, engine: name, ...r });
    console.error(`round ${round} ${name}: ${JSON.stringify(r)}`);
  }
}

const med = (xs) => {
  const v = xs.filter((x) => typeof x === 'number').sort((p, q) => p - q);
  return v.length ? v[Math.floor(v.length / 2)] : null;
};
const summary = Object.fromEntries(['js', 'native'].map((name) => {
  const rs = results.filter((r) => r.engine === name && !r.error);
  return [name, {
    runs: rs.length,
    steadyUnderrunsPerMinute: med(rs.map((r) => r.steady?.eventsPerMinute)),
    steadyUnderrunMsPerMinute: med(rs.map((r) => (r.steady?.seconds ? (r.steady.underrunMs * 60) / r.steady.seconds : null))),
    trackChangeUnderrunsPerChange: med(rs.map((r) => (r.trackChange ? r.trackChange.underrunEvents / r.trackChange.changes : null))),
    trackChangeUnderrunMsPerChange: med(rs.map((r) => (r.trackChange ? r.trackChange.underrunMs / r.trackChange.changes : null))),
    loadReadyMs: med(rs.map((r) => r.trackChange?.readyMsMedian)),
    mainThreadBlockedMs: med(rs.map((r) => r.trackChange?.mainThreadBlockedMsMedian)),
  }];
}));
console.log(JSON.stringify({ baseUrl: BASE_URL, rounds: ROUNDS, steadyMs: STEADY_MS, changes: CHANGES, summary }, null, 2));
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ summary, results }, null, 2));
if (MARKDOWN_OUT) {
  const f = (x, d = 1) => (typeof x === 'number' ? x.toFixed(d) : '—');
  const rows = [
    ['steady underruns / min (64-ch IT)', 'steadyUnderrunsPerMinute'],
    ['steady underrun ms / min', 'steadyUnderrunMsPerMinute'],
    ['underruns per track change', 'trackChangeUnderrunsPerChange'],
    ['underrun ms per track change', 'trackChangeUnderrunMsPerChange'],
    ['load → module ready, ms', 'loadReadyMs'],
    ['main thread blocked by the load call, ms', 'mainThreadBlockedMs'],
  ];
  const lines = [
    `### Real AudioWorklet, headless Chromium — JS vs native (${ROUNDS} rounds, median; steady ${STEADY_MS / 1000} s, ${CHANGES} track changes)`,
    '',
    '| metric | JS | native |',
    '|---|---|---|',
    ...rows.map(([label, key]) => {
      const v = (name) => summary[name][key];
      return `| ${label} | ${f(v('js'))} | ${f(v('native'))} |`;
    }),
    '',
  ];
  writeFileSync(MARKDOWN_OUT, lines.join('\n'));
}
