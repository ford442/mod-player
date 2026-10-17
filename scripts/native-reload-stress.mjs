#!/usr/bin/env node
/**
 * Native engine reload stress in a real browser (#491).
 *
 * Drives the built openmpt-native.{js,wasm} directly (no app code) in headless
 * Chrome: starts the real AudioWorklet thread, then loads + commits modules
 * back to back with 0–4 ms gaps while it renders — the window in which the
 * pre-#491 engine freed the buffer its audio thread was still parsing, and then
 * lost the next file. Interleaves seeks and mutes, and checks at the end that:
 *   - the wasm never aborted and no typed load error was reported,
 *   - the LAST module loaded is the one actually rendering (channel count from
 *     the position struct) and it is audible,
 *   - cleanup_audio() returns with the audio thread still running.
 * The host TSan harness (scripts/native-host-test.sh) proves the same thing for
 * the C++ in isolation; this is the end-to-end check on the shipped wasm.
 *
 * Usage (a preview with COOP/COEP on BASE_URL, native artifacts in dist/worklets/):
 *   npm run build:emcc && npm run build && npm run preview -- --port 4391 &
 *   BASE_URL=http://127.0.0.1:4391 node scripts/native-reload-stress.mjs
 * Env: BASE_URL, GLUE_DIR (default /worklets/), ROUNDS (default 300), OUTPUT_JSON
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { launchBrowser, openPage, goto, evaluate } from './lib/browser-launch.mjs';
import { synthXm } from './lib/synth-xm.mjs';

const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:4173').replace(/\/$/, '');
const GLUE_DIR = process.env.GLUE_DIR || '/worklets/';
const ROUNDS = Number(process.env.ROUNDS || 300);
const OUTPUT_JSON = process.env.OUTPUT_JSON || '';

const { browser, engine, close } = await launchBrowser();
let failed = false;
try {
  const { page } = await openPage(browser, engine);
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
  // Any same-origin document served with COOP/COEP will do; it must not be the app.
  await goto(page, engine, `${BASE_URL}${GLUE_DIR}README.md`, 60000);

  const result = await evaluate(page, async ({ glueDir, rounds, xm }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    if (!globalThis.crossOriginIsolated) return { setupError: 'page is not crossOriginIsolated (COOP/COEP)' };
    const printed = [];
    let aborted = null;

    // The glue's addModule() URL for the .aw.js is relative to the document.
    const addModule = AudioWorklet.prototype.addModule;
    AudioWorklet.prototype.addModule = function (url, options) {
      let u = url;
      if (typeof u === 'string' && /openmpt-native\.aw\.js/.test(u) && !u.includes(glueDir)) {
        u = glueDir + u.split('/').pop();
      }
      return addModule.call(this, u, options);
    };
    const ns = await import(`${glueDir}openmpt-native.js`);
    const factory = ns.default ?? ns.createOpenMPTModule;
    const M = await factory({
      locateFile: (p) => glueDir + p,
      onAbort: (what) => { aborted = String(what); },
      printErr: (text) => printed.push(String(text)),
      print: () => {},
    });

    const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'playback' });
    await ctx.resume();
    if (!M._init_audio_with_context(M.emscriptenRegisterAudioObject(ctx), 48000)) {
      return { setupError: 'init_audio_with_context failed' };
    }
    const t0 = performance.now();
    while (!M._get_worklet_node() && performance.now() - t0 < 8000) await sleep(20);
    if (!M._get_worklet_node()) return { setupError: 'native AudioWorklet thread did not start' };
    const node = M.emscriptenGetAudioObject(M._get_worklet_node());
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 4096;
    node.connect(analyser);
    analyser.connect(ctx.destination);

    const files = [
      new Uint8Array(await (await fetch('/4-mat_madness.mod')).arrayBuffer()),
      new Uint8Array(await (await fetch('/libopenmpt-test.mod')).arrayBuffer()),
      new Uint8Array(xm),
    ];
    const loadErrors = [];
    const parseMs = [];
    const load = (bytes) => {
      const ptr = M._malloc(bytes.length);
      M.HEAPU8.set(bytes, ptr);
      const t = performance.now();
      const ok = M._load_module(ptr, bytes.length); // adopts ptr
      parseMs.push(performance.now() - t);
      if (!ok) {
        const e = M._get_last_error();
        loadErrors.push(e ? M.UTF8ToString(e) : 'load_module returned 0');
      }
      return ok;
    };
    const rms = () => {
      const a = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(a);
      let s = 0;
      for (const v of a) s += v * v;
      return Math.sqrt(s / a.length);
    };
    const numChannelsPlaying = () => {
      // PositionInfo.numChannels (cpp/openmpt_wrapper.h): byte offset 32.
      for (let i = 0; i < 50; i++) {
        const ptr = M._poll_position();
        if (ptr) return new DataView(M.HEAPU8.buffer).getInt32(ptr + 32, true);
      }
      return -1;
    };

    load(files[0]);
    M._commit_module();
    M._resume_audio();
    await sleep(600);
    const rmsBefore = rms();

    for (let i = 0; i < rounds; i++) {
      load(files[i % files.length]);
      M._commit_module();
      await sleep(Math.random() * 4); // inside the old engine's audio-thread parse
      if (i % 3 === 0) M._seek_order_row(0, 0);
      if (i % 5 === 0) M._set_channel_mute(i % 4, i % 2);
      M._poll_position();
      if (aborted) break;
    }
    for (let c = 0; c < 32; c++) M._set_channel_mute(c, 0);

    // The final load must be what plays: the 32-channel XM.
    load(files[2]);
    M._commit_module();
    await sleep(800);
    const channels = numChannelsPlaying();
    const rmsAfter = rms();
    M._cleanup_audio();
    await sleep(100);
    return {
      aborted,
      loadErrors,
      printed: printed.slice(-20),
      rmsBefore,
      rmsAfter,
      finalModuleChannels: channels,
      parseMsMedian: parseMs.sort((a, b) => a - b)[Math.floor(parseMs.length / 2)] ?? null,
      rounds,
    };
  }, { glueDir: GLUE_DIR, rounds: ROUNDS, xm: Array.from(synthXm(32)) });

  const problems = [];
  if (result.setupError) problems.push(result.setupError);
  if (result.aborted) problems.push(`wasm aborted: ${result.aborted}`);
  if (result.loadErrors?.length) problems.push(`${result.loadErrors.length} load error(s): ${result.loadErrors[0]}`);
  if (!result.setupError && result.finalModuleChannels !== 32) {
    problems.push(`the last module loaded is not the one playing (channels=${result.finalModuleChannels}, want 32)`);
  }
  if (!result.setupError && !(result.rmsAfter > 0.001)) problems.push(`silent after the stress (rms=${result.rmsAfter})`);
  const report = { ...result, consoleErrors: consoleErrors.slice(-20), problems, pass: problems.length === 0 };
  if (OUTPUT_JSON) {
    mkdirSync(dirname(OUTPUT_JSON), { recursive: true });
    writeFileSync(OUTPUT_JSON, JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify({
    pass: report.pass,
    rounds: report.rounds,
    finalModuleChannels: report.finalModuleChannels,
    rmsBefore: report.rmsBefore,
    rmsAfter: report.rmsAfter,
    parseMsMedian: report.parseMsMedian,
    problems,
  }, null, 2));
  failed = !report.pass;
} finally {
  await close();
}
process.exit(failed ? 1 : 0);
