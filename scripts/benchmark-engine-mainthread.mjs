#!/usr/bin/env node
/**
 * Main-thread RAF cost benchmark — JS vs native engine (when artifacts present).
 *
 * Usage (preview server running):
 *   npm run preview -- --port 4173 &
 *   npm run bench:engine
 *
 * Env:
 *   BASE_URL     default http://localhost:4173
 *   OUTPUT_DIR   default ./artifacts/engine-bench
 *   PLAY_MS      sample window per engine (default 4000)
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  launchBrowser,
  openPage,
  goto,
  waitForFunction,
  evaluate,
} from './lib/browser-launch.mjs';

const BASE_URL = (process.env.BASE_URL || 'http://localhost:4173').replace(/\/$/, '');
const OUTPUT_DIR = process.env.OUTPUT_DIR || join(process.cwd(), 'artifacts', 'engine-bench');
const PLAY_MS = Number(process.env.PLAY_MS || 4000);
const TIMEOUT = Number(process.env.TIMEOUT || 60000);

const NATIVE_GLUE = join(process.cwd(), 'public', 'worklets', 'openmpt-native.js');
const nativeAvailable = () =>
  existsSync(NATIVE_GLUE)
  && existsSync(join(process.cwd(), 'public', 'worklets', 'openmpt-native.wasm'));

mkdirSync(OUTPUT_DIR, { recursive: true });

async function benchEngine(browser, playwrightEngine, audioEngine) {
  const { page, context } = await openPage(browser, playwrightEngine);
  const engineParam = audioEngine === 'native' ? '&engine=native' : '&engine=js';
  const url = `${BASE_URL}/?renderer=webgl2&lite=0${engineParam}`;

  try {
    await goto(page, playwrightEngine, url, TIMEOUT);
    await waitForFunction(
      page,
      () => window.__TEST_HOOKS__?.isModuleLoaded?.() === true,
      { timeout: TIMEOUT },
    );

    await evaluate(page, () => {
      const play = [...document.querySelectorAll('button')].find((b) => /play/i.test(b.textContent ?? ''));
      play?.click();
    });
    await new Promise((r) => setTimeout(r, 500));

    const samples = await evaluate(page, async ({ playMs }) => {
      const hooks = window.__TEST_HOOKS__;
      const out = [];
      const start = performance.now();
      while (performance.now() - start < playMs) {
        const t0 = performance.now();
        hooks?.getPlayheadDebug?.();
        out.push(performance.now() - t0);
        await new Promise((res) => requestAnimationFrame(() => res()));
      }
      return {
        engine: hooks?.getAudioEngine?.() ?? 'unknown',
        samples: out,
        count: out.length,
      };
    }, { playMs: PLAY_MS });

    const sorted = [...samples.samples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const mean = sorted.reduce((a, b) => a + b, 0) / (sorted.length || 1);

    return {
      requestedEngine: audioEngine,
      observedEngine: samples.engine,
      sampleCount: samples.count,
      medianGetPlayheadDebugMs: median,
      meanGetPlayheadDebugMs: mean,
      maxGetPlayheadDebugMs: sorted[sorted.length - 1] ?? 0,
    };
  } finally {
    if (context) await context.close();
    else await page.close();
  }
}

async function main() {
  const engines = ['js'];
  if (nativeAvailable()) engines.push('native');

  const { browser, engine, close } = await launchBrowser();
  const results = [];

  try {
    for (const audioEngine of engines) {
      console.log(`\n▶ bench engine=${audioEngine}`);
      const row = await benchEngine(browser, engine, audioEngine);
      results.push(row);
      console.log(
        `  observed=${row.observedEngine} median=${row.medianGetPlayheadDebugMs.toFixed(3)}ms`
        + ` mean=${row.meanGetPlayheadDebugMs.toFixed(3)}ms`,
      );
    }
  } finally {
    await close();
  }

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    playMs: PLAY_MS,
    nativeArtifactsPresent: nativeAvailable(),
    results,
  };

  const md = [
    '# Engine main-thread benchmark',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '| Engine | Observed | Median getPlayheadDebug (ms) | Mean (ms) | Max (ms) |',
    '|--------|----------|------------------------------|-----------|----------|',
    ...results.map((r) =>
      `| ${r.requestedEngine} | ${r.observedEngine} | ${r.medianGetPlayheadDebugMs.toFixed(3)} | ${r.meanGetPlayheadDebugMs.toFixed(3)} | ${r.maxGetPlayheadDebugMs.toFixed(3)} |`,
    ),
    '',
    'Note: measures main-thread cost of playhead debug hook per RAF, not full updateUI.',
    'Native requires `npm run build:emcc`. Do not flip engine defaults on this alone.',
  ].join('\n');

  writeFileSync(join(OUTPUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(OUTPUT_DIR, 'BENCH.md'), md);
  console.log(`\nWrote ${OUTPUT_DIR}/report.json and BENCH.md`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
