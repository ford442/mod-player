#!/usr/bin/env node
/**
 * #513 acceptance in a real browser: load a 16 MiB, 64-channel IT while another module is playing,
 * once with the create worker (default on a crossOriginIsolated page) and once with
 * ?audioCreate=worklet (the old in-worklet create), and compare what the audio thread saw.
 *
 * Per mode, from the worklet's ?audioDiag=1 reports (window.__AUDIO_DIAG__) and the context:
 *   loadBlockMs     audio-thread time spent bringing the module in (create in-worklet; the swap otherwise)
 *   maxWallGapMs    worst wall-clock gap between two process() calls across the load, next to
 *                   the same metric over a no-load window first (quanta arrive in bursts)
 *   underrunEvents  AudioContext.playbackStats delta across the load (Chrome)
 *   lag median      |predictionLagRows| while the big module plays (must stay < 1 row)
 *
 * Usage (preview server running, like the other smokes):
 *   npm run preview -- --port 4173 &
 *   npm run smoke:create-thread
 *
 * Env: BASE_URL (default http://localhost:4173), OUTPUT_DIR, MODES (default "thread,worklet"),
 *      ASSERT (default 1: fail unless the create-worker mode keeps loadBlockMs under one quantum).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchBrowser, goto, waitForFunction, evaluate } from './lib/browser-launch.mjs';
import { synthIt } from './lib/synth-it.mjs';

const BASE_URL = (process.env.BASE_URL || 'http://localhost:4173').replace(/\/$/, '');
const OUTPUT_DIR = process.env.OUTPUT_DIR || join(process.cwd(), 'artifacts', 'create-thread-acceptance');
const MODES = (process.env.MODES || 'thread,worklet').split(',');
const ASSERT = process.env.ASSERT !== '0';
const BIG_URL = `${BASE_URL}/__synthetic__/stress-64ch-16mib.it`;
const SMALL_URL = `${BASE_URL}/4-mat_madness.mod`;
const QUANTUM_MS = (128 / 48000) * 1000;
const TIMEOUT = 60000;

mkdirSync(OUTPUT_DIR, { recursive: true });
const BIG = Buffer.from(synthIt(64, { sampleFrames: 2 << 20 }));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sampleLag(page, ms) {
  const lags = [];
  const start = Date.now();
  while (Date.now() - start < ms) {
    const snap = await evaluate(page, () => window.__TEST_HOOKS__?.getPlayheadDebug?.() ?? window.__PLAYHEAD_DEBUG__ ?? null);
    if (snap?.predictionLagRows != null && Number.isFinite(snap.predictionLagRows)) lags.push(Math.abs(snap.predictionLagRows));
    await sleep(50);
  }
  lags.sort((a, b) => a - b);
  return { samples: lags.length, median: lags[Math.floor(lags.length / 2)] ?? null, max: lags[lags.length - 1] ?? null };
}

async function runMode(browser, engine, mode) {
  // Block the PWA service worker: it would answer the synthetic module URL before page.route sees it.
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(m.text()));
  await page.route('**/__synthetic__/*', (route) => route.fulfill({ status: 200, contentType: 'application/octet-stream', body: BIG }));

  const query = `?audioDiag=1&debug=log${mode === 'worklet' ? '&audioCreate=worklet' : ''}`;
  await goto(page, engine, `${BASE_URL}/${query}`, TIMEOUT);
  await evaluate(page, () => {
    localStorage.setItem('xasm1_pattern_renderer', 'html');
    localStorage.setItem('xasm1_playhead_debug', '1');
    window.DEBUG_RENDERER = 'html';
  });
  await goto(page, engine, `${BASE_URL}/${query}`, TIMEOUT);
  await waitForFunction(page, () => typeof window.__TEST_HOOKS__?.loadModuleFromUrl === 'function', { timeout: TIMEOUT });

  // Module A plays first (the first load of a session races the create-worker handshake).
  await evaluate(page, (u) => window.__TEST_HOOKS__.loadModuleFromUrl(u), SMALL_URL);
  await waitForFunction(page, () => window.__TEST_HOOKS__?.isModuleLoaded?.() === true, { timeout: TIMEOUT });
  await evaluate(page, () => window.__TEST_HOOKS__.startPlayback());
  await waitForFunction(page, () => window.__TEST_HOOKS__?.getIsPlaying?.() === true, { timeout: 15000 });
  await sleep(1500);
  const createWorkerReady = logs.some((l) => l.includes('create worker ready'));

  // Baseline: the same metric over a window with no load — how far apart this browser's
  // process() calls are anyway (quanta arrive in bursts, well above one quantum apart).
  await evaluate(page, () => { window.__AUDIO_DIAG__ = undefined; });
  await sleep(2000);
  const baselineWallGapMs = await evaluate(page, () => window.__AUDIO_DIAG__?.maxWallGapMs ?? null);

  // Load the big module while A plays; measure from here.
  await evaluate(page, () => { window.__AUDIO_DIAG__ = undefined; });
  const before = await evaluate(page, () => window.__TEST_HOOKS__.getAudioPlaybackStats());
  const t0 = Date.now();
  await evaluate(page, (u) => window.__TEST_HOOKS__.loadModuleFromUrl(u), BIG_URL);
  try {
    // auto-lite ⇒ the 64-channel module is the one rendering
    await waitForFunction(page, () => window.__AUDIO_DIAG__?.audioLite === true, { timeout: TIMEOUT });
  } catch (err) {
    console.error(`  ${mode}: the big module never started rendering; page log tail:\n    ${logs.slice(-40).join('\n    ')}`);
    throw err;
  }
  const swapMs = Date.now() - t0;
  await sleep(1000);
  const after = await evaluate(page, () => window.__TEST_HOOKS__.getAudioPlaybackStats());
  const diag = await evaluate(page, () => window.__AUDIO_DIAG__);
  const lag = await sampleLag(page, 3000);
  const createLog = logs.find((l) => /create #\d+ ok/.test(l)) ?? null;
  await context.close();

  return {
    mode,
    createWorkerReady,
    createThread: diag?.createThread ?? null,
    loadBlockMs: diag?.loadBlockMs ?? null,
    maxWallGapMs: diag?.maxWallGapMs ?? null,
    baselineWallGapMs,
    sessionMaxProcessMs: diag?.sessionMaxProcessMs ?? null,
    overruns: diag?.totalOverruns ?? null,
    underrunEvents: before && after ? after.underrunEvents - before.underrunEvents : null,
    underrunMs: before && after ? (after.underrunDuration - before.underrunDuration) * 1000 : null,
    loadToPlayingMs: swapMs,
    lag,
    createLog,
    errors: logs.filter((l) => /error|PROCESS_FAULT/i.test(l) && !/favicon/i.test(l)).slice(0, 10),
  };
}

async function main() {
  console.log(`Create-thread acceptance (#513): 16 MiB 64-ch IT loaded while a MOD plays — ${BASE_URL}`);
  const { browser, engine, close } = await launchBrowser();
  if (engine !== 'playwright') throw new Error('needs Playwright (page.route serves the synthetic module)');
  const results = [];
  try {
    for (const mode of MODES) results.push(await runMode(browser, engine, mode));
  } finally {
    await close();
  }
  const f = (v, d = 2) => (v == null ? 'n/a' : Number(v).toFixed(d));
  for (const r of results) {
    console.log(
      `  ${r.mode.padEnd(8)} createThread=${r.createThread} loadBlock=${f(r.loadBlockMs)} ms ` +
        `maxWallGap=${f(r.maxWallGapMs)} ms (no-load ${f(r.baselineWallGapMs)}) underruns=${r.underrunEvents ?? 'n/a'} (${f(r.underrunMs, 1)} ms) ` +
        `lag median=${f(r.lag.median, 3)} max=${f(r.lag.max, 3)} (${r.lag.samples} samples)` +
        (r.createLog ? `\n           ${r.createLog}` : ''),
    );
  }
  const reportPath = join(OUTPUT_DIR, 'report.json');
  writeFileSync(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), baseUrl: BASE_URL, quantumMs: QUANTUM_MS, results }, null, 2));
  console.log(`Report: ${reportPath}`);

  if (!ASSERT) return;
  const failures = [];
  const thread = results.find((r) => r.mode === 'thread');
  if (thread) {
    if (thread.createThread !== true) failures.push('thread mode: the worklet did not report a create worker');
    if (!(thread.loadBlockMs != null && thread.loadBlockMs < QUANTUM_MS)) failures.push(`thread mode: audio thread spent ${f(thread.loadBlockMs)} ms on the load (≥ one quantum)`);
  }
  for (const r of results) {
    if (!(r.lag.median != null && r.lag.median < 1)) failures.push(`${r.mode}: playhead median lag ${f(r.lag.median, 3)} rows (must be < 1)`);
  }
  if (failures.length) {
    for (const x of failures) console.error(`  ✗ ${x}`);
    process.exit(1);
  }
  console.log('PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
