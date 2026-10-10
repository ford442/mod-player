#!/usr/bin/env node
/**
 * FX rack Chromium harness (#453): bypass null tests, click-free crossfades
 * (with the metric's self-check), static-vs-live parity, and the character
 * worklet's CPU share — on Chrome's Web Audio implementation.
 *
 * audio/fx/testing/browserHarness.ts is bundled in memory and served at
 * /__fx-harness.html on the preview origin (Playwright route), so the real
 * built dist/worklets/fx-character-worklet.js is what runs, and nothing extra
 * ships in dist/.
 *
 * Usage (preview must be running on a built dist/):
 *   npm run build && npm run preview -- --port 4173 --host 127.0.0.1 &
 *   BASE_URL=http://127.0.0.1:4173 npm run smoke:fx:ci
 *
 * Env:
 *   BASE_URL         default http://127.0.0.1:4173
 *   OUTPUT_DIR       default ./artifacts/fx-smoke
 *   FX_CPU_SECONDS   seconds of audio per CPU run (default 30)
 *   FX_CPU_RUNS      timed runs per variant (default 5)
 *   FX_CPU_LIMIT     max share of one core (default 0.05)
 *   TIMEOUT          harness timeout, ms (default 600000)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { launchBrowser } from './lib/browser-launch.mjs';
import { AUDIO_CHROME_ARGS } from './lib/audio-smoke-config.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:4173').replace(/\/$/, '');
const OUTPUT_DIR = process.env.OUTPUT_DIR || join(ROOT, 'artifacts', 'fx-smoke');
const TIMEOUT = Number(process.env.TIMEOUT || 600_000);
const HARNESS_PATH = '/__fx-harness.html';

async function bundleHarness() {
  const result = await esbuild.build({
    entryPoints: [join(ROOT, 'audio/fx/testing/browserHarness.ts')],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    platform: 'browser',
    write: false,
    logLevel: 'warning',
    // Vite injects import.meta.env; the harness never reads BASE_URL (it passes
    // absolute worklet URLs) but shared modules reference it.
    define: { 'import.meta.env': JSON.stringify({ BASE_URL: '/', DEV: false, PROD: true, MODE: 'production' }) },
  });
  return result.outputFiles[0].text;
}

function formatValue(v) {
  if (v === 0) return '0';
  return Math.abs(v) < 0.01 || Math.abs(v) >= 1000 ? v.toExponential(2) : v.toFixed(4);
}

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const version = JSON.parse(readFileSync(join(ROOT, 'audio-worklet/js/fx-character-version.generated.json'), 'utf8')).version;
  const code = await bundleHarness();
  const html = `<!doctype html><meta charset="utf-8"><title>FX harness</title><script>${code.replace(/<\/script/gi, '<\\/script')}</script>`;

  console.log('FX rack Chromium harness (#453)');
  console.log(`  base=${BASE_URL}`);

  const { browser, engine, close } = await launchBrowser({ args: AUDIO_CHROME_ARGS, headless: true });
  if (engine !== 'playwright') {
    await close();
    throw new Error(`fx-smoke needs Playwright (page.route); got ${engine}`);
  }
  const consoleLines = [];
  try {
    const page = await browser.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') consoleLines.push(`[${msg.type()}] ${msg.text()}`);
    });
    page.on('pageerror', (err) => consoleLines.push(`[pageerror] ${err.message}`));
    await page.route(`**${HARNESS_PATH}`, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }),
    );
    await page.goto(`${BASE_URL}${HARNESS_PATH}`, { waitUntil: 'load' });
    page.setDefaultTimeout(TIMEOUT);
    const report = await page.evaluate(
      (opts) => window.__FX_HARNESS__.runAll(opts),
      {
        workletUrl: `${BASE_URL}/worklets/fx-character-worklet.js?v=${version}`,
        cpuSeconds: Number(process.env.FX_CPU_SECONDS || 30),
        cpuRuns: Number(process.env.FX_CPU_RUNS || 5),
        cpuLimit: Number(process.env.FX_CPU_LIMIT || 0.05),
      },
    );
    report.console = consoleLines;
    writeFileSync(join(OUTPUT_DIR, 'report.json'), JSON.stringify(report, null, 2));

    console.log(`  ${report.userAgent}`);
    for (const c of report.checks) {
      const rel = c.expect === 'zero' ? '== 0' : c.expect === 'below' ? `< ${formatValue(c.limit)}` : `> ${formatValue(c.limit)}`;
      console.log(`  ${c.pass ? 'ok  ' : 'FAIL'} ${c.name}: ${formatValue(c.value)} (${rel})`);
    }
    const cpu = report.cpu;
    console.log(`  cpu runs (ms): baseline ${cpu.baselineMs.map((v) => v.toFixed(0)).join(' ')} | character ${cpu.characterMs.map((v) => v.toFixed(0)).join(' ')}`);
    console.log(`Report: ${join(OUTPUT_DIR, 'report.json')}`);
    console.log(`Status: ${report.ok ? 'PASS' : 'FAIL'}`);
    if (!report.ok) process.exitCode = 1;
  } finally {
    if (consoleLines.length) writeFileSync(join(OUTPUT_DIR, 'console.log'), consoleLines.join('\n'));
    await close();
  }
}

main().catch((err) => {
  console.error('fx-smoke failed:', err);
  process.exit(1);
});
