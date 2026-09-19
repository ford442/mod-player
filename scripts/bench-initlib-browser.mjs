#!/usr/bin/env node
/**
 * In-browser "first play" latency of the JS engine: how long the worklet takes to get libopenmpt
 * ready and acknowledge a module, from a cold browser context each iteration.
 *
 * Works against ANY build of the app (used to compare the real-WASM engine with the old 5 MB
 * wasm2js glue): it only stamps the app's own [PLAY] log lines, which both builds print.
 *
 *   fetchStart  "[PLAY] Fetching libopenmpt assets for worklet..."   (main thread starts downloading)
 *   sent        "[PLAY] Sending module data to worklet"              (assets in hand, initLib + load posted)
 *   loaded      "[PLAY] Worklet loaded module"                       (worklet: eval + instantiate + create + ack)
 *
 *   assetsMs      = sent   − fetchStart   main-thread fetch (+ validation / sniffing)
 *   initToLoadedMs = loaded − sent         initLib clone + glue eval + wasm instantiate + module load
 *   initLibMs     = loaded − fetchStart   everything between "start fetching libopenmpt" and "ready"
 *   clickToLoadedMs = loaded − click       what the user waits after pressing Play (includes addModule)
 *
 * Usage (a preview server for the build under test must be running):
 *   npx vite preview --outDir <dist> --port 4173 --host 127.0.0.1 &
 *   BASE_URL=http://127.0.0.1:4173 RUNS=5 node scripts/bench-initlib-browser.mjs
 *
 * Env: BASE_URL (default http://127.0.0.1:4173)  RUNS (default 5)  TIMEOUT ms (default 90000)
 *      OUTPUT_DIR (default ./artifacts/initlib-bench)  LABEL (tag written into the report)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluate, goto, launchBrowser, openPage, waitForFunction } from './lib/browser-launch.mjs';

const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:4173').replace(/\/$/, '');
const RUNS = Number(process.env.RUNS || 5);
const TIMEOUT = Number(process.env.TIMEOUT || 90000);
const OUTPUT_DIR = process.env.OUTPUT_DIR || join(process.cwd(), 'artifacts', 'initlib-bench');
const LABEL = process.env.LABEL || BASE_URL;

mkdirSync(OUTPUT_DIR, { recursive: true });

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

async function once(browser, engine) {
  const { page, context } = await openPage(browser, engine);
  try {
    if (engine === 'playwright') {
      await context.addInitScript(() => {
        window.__initMarks = {};
        const orig = console.log.bind(console);
        console.log = (...a) => {
          const s = typeof a[0] === 'string' ? a[0] : '';
          const m = window.__initMarks;
          const now = performance.now();
          if (s.startsWith('[PLAY] Starting playback')) m.click ??= now;
          if (s.startsWith('[PLAY] Fetching libopenmpt assets')) m.fetchStart ??= now;
          if (s.startsWith('[PLAY] Sending module data to worklet')) m.sent ??= now;
          if (s.includes('Worklet loaded module')) m.loaded ??= now;
          orig(...a);
        };
      });
    }
    await goto(page, engine, `${BASE_URL}/?renderer=webgl2&engine=js`, TIMEOUT);
    await waitForFunction(page, () => window.__TEST_HOOKS__?.isModuleLoaded?.() === true, { timeout: TIMEOUT });
    await evaluate(page, () => {
      const play = [...document.querySelectorAll('button')].find((b) => /play/i.test(b.textContent ?? ''));
      play?.click();
    });
    await waitForFunction(page, () => window.__initMarks?.loaded != null, { timeout: TIMEOUT });
    const m = await evaluate(page, () => window.__initMarks);
    return {
      assetsMs: m.sent - m.fetchStart,
      initToLoadedMs: m.loaded - m.sent,
      initLibMs: m.loaded - m.fetchStart,
      clickToLoadedMs: m.loaded - m.click,
    };
  } finally {
    await context?.close();
  }
}

const { browser, engine, close } = await launchBrowser();
if (engine !== 'playwright') {
  console.error('bench-initlib-browser needs Playwright (addInitScript).');
  await close();
  process.exit(1);
}

const rows = [];
try {
  for (let i = 0; i < RUNS; i++) {
    const row = await once(browser, engine);
    rows.push(row);
    console.log(
      `run ${i + 1}/${RUNS}: initLib ${row.initLibMs.toFixed(0)} ms ` +
        `(fetch ${row.assetsMs.toFixed(0)} + init/load ${row.initToLoadedMs.toFixed(0)}), ` +
        `click→loaded ${row.clickToLoadedMs.toFixed(0)} ms`,
    );
  }
} finally {
  await close();
}

const summary = {
  label: LABEL,
  baseUrl: BASE_URL,
  runs: rows.length,
  medianInitLibMs: median(rows.map((r) => r.initLibMs)),
  medianAssetsMs: median(rows.map((r) => r.assetsMs)),
  medianInitToLoadedMs: median(rows.map((r) => r.initToLoadedMs)),
  medianClickToLoadedMs: median(rows.map((r) => r.clickToLoadedMs)),
  rows,
};
writeFileSync(join(OUTPUT_DIR, 'report.json'), JSON.stringify(summary, null, 2));
console.log(
  `\n${LABEL}: median initLib ${summary.medianInitLibMs.toFixed(0)} ms ` +
    `(fetch ${summary.medianAssetsMs.toFixed(0)} + init/load ${summary.medianInitToLoadedMs.toFixed(0)}), ` +
    `click→loaded ${summary.medianClickToLoadedMs.toFixed(0)} ms  → ${join(OUTPUT_DIR, 'report.json')}`,
);
