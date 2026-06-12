#!/usr/bin/env node
/**
 * GPU Colab / headless Chrome capture for Trigger + Sustain Tail verification.
 *
 * Usage (from mod-player root, dev server running on :5173):
 *   node scripts/capture-trigger-tail.mjs
 *
 * Env:
 *   TEST_URL       — base URL (default http://localhost:5173)
 *   SHADER_FILE    — WGSL shader id (default patternv0.50.wgsl)
 *   RENDERER       — webgl2 | webgpu | html (default webgl2 for Colab GPU)
 *   OUTPUT_DIR     — screenshot output dir (default /mnt/ramdisk/trigger-tail)
 *   SEEK_ROWS      — comma-separated rows to seek (default 0,8,16,32)
 */

import puppeteer from '/content/headless-chrome-nvidia-t4-gpu-support/examples/puppeteer/node_modules/puppeteer/lib/puppeteer/puppeteer.js';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const BASE_URL = process.env.TEST_URL || 'http://localhost:5173';
const SHADER_FILE = process.env.SHADER_FILE || 'patternv0.50.wgsl';
const RENDERER = process.env.RENDERER || 'webgl2';
const OUTPUT_DIR = process.env.OUTPUT_DIR || '/mnt/ramdisk/trigger-tail';
const SEEK_ROWS = (process.env.SEEK_ROWS || '0,8,16,32').split(',').map(Number);
const MODULE_URL = process.env.MODULE_URL || '';
const TIMEOUT = Number(process.env.TIMEOUT || 45000);

const CHROME_ARGS = [
  '--no-sandbox',
  '--headless=new',
  '--use-angle=vulkan',
  '--enable-features=Vulkan',
  '--disable-vulkan-surface',
  '--enable-unsafe-webgpu',
  '--disable-search-engine-choice-screen',
  '--ash-no-nudges',
  '--no-first-run',
  '--disable-features=Translate',
  '--no-default-browser-check',
  '--window-size=1280,720',
];

mkdirSync(OUTPUT_DIR, { recursive: true });

async function waitForModule(page) {
  await page.waitForFunction(
    () => window.__TEST_HOOKS__?.isModuleLoaded?.() === true,
    { timeout: TIMEOUT },
  );
}

async function waitForRenderer(page) {
  await page.waitForFunction(
    () => window.currentPatternRenderer?.getCanvas?.() != null,
    { timeout: TIMEOUT },
  );
}

async function captureCanvas(page, label) {
  const path = join(OUTPUT_DIR, `${label}.png`);
  const canvas = await page.$('canvas[data-shader-preview-source="true"]');
  if (canvas) {
    await canvas.screenshot({ path });
  } else {
    await page.screenshot({ path, fullPage: true });
  }
  console.log(`  saved ${path}`);
  return path;
}

async function readTriggerStats(page) {
  return page.evaluate(() => {
    const renderer = window.currentPatternRenderer;
    const pixels = renderer?.readPixels?.();
    if (!pixels || pixels.length === 0) {
      return { ok: false, reason: 'readPixels unavailable' };
    }
    let bright = 0;
    let dim = 0;
    const len = pixels.length / 4;
    for (let i = 0; i < len; i++) {
      const r = pixels[i * 4];
      const g = pixels[i * 4 + 1];
      const b = pixels[i * 4 + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum > 180) bright++;
      else if (lum > 40 && lum <= 120) dim++;
    }
    return { ok: true, bright, dim, totalPixels: len };
  });
}

async function run() {
  console.log(`Trigger+Tail capture`);
  console.log(`  url=${BASE_URL}  renderer=${RENDERER}  shader=${SHADER_FILE}`);
  console.log(`  output=${OUTPUT_DIR}`);

  const browser = await puppeteer.launch({
    headless: 'new',
    ignoreDefaultArgs: true,
    args: CHROME_ARGS,
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  const logs = [];
  page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => console.error('[pageerror]', err.message));

  // Seed localStorage on the app origin, then reload with renderer param
  console.log(`Seeding localStorage on ${BASE_URL}...`);
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  await page.evaluate(({ shader, renderer }) => {
    localStorage.setItem('xasm1_last_shader', shader);
    localStorage.setItem('xasm1_pattern_renderer', renderer);
    window.DEBUG_RENDERER = renderer;
  }, { shader: SHADER_FILE, renderer: RENDERER });

  const url = `${BASE_URL}/?renderer=${RENDERER}`;
  console.log(`Navigating to ${url}...`);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: TIMEOUT });

  console.log('Waiting for module load...');
  await waitForModule(page);

  if (MODULE_URL) {
    console.log(`Loading module: ${MODULE_URL}`);
    await page.evaluate(async (url) => {
      await window.__TEST_HOOKS__?.loadModuleFromUrl(url);
    }, MODULE_URL);
    await new Promise((r) => setTimeout(r, 4000));
  }
  console.log('Waiting for pattern renderer...');
  await waitForRenderer(page);

  // Let pattern matrix pack + first render settle
  await new Promise((r) => setTimeout(r, 3000));

  await captureCanvas(page, '00_initial');

  const stats = await readTriggerStats(page);
  const tailStats = await page.evaluate(() => window.__TEST_HOOKS__?.getTriggerTailStats?.());
  console.log('Trigger/tail data:', JSON.stringify(tailStats));
  console.log('Pixel stats:', JSON.stringify(stats));

  for (const row of SEEK_ROWS) {
    await page.evaluate((r) => window.__TEST_HOOKS__?.seekToRow(r), row);
    await new Promise((r) => setTimeout(r, 1200));
    await captureCanvas(page, `row_${String(row).padStart(2, '0')}`);
  }

  const warnings = logs.filter((l) =>
    /BOUNDS VIOLATION|CELL COUNT MISMATCH|buffer size mismatch|INVARIANT/i.test(l),
  );
  const packingLogs = logs.filter((l) => /packPatternMatrix|Packed .* notes/i.test(l));

  const summary = {
    shader: SHADER_FILE,
    renderer: RENDERER,
    seekRows: SEEK_ROWS,
    triggerTailStats: tailStats,
    pixelStats: stats,
    consoleMessages: logs.length,
    packingLogs: packingLogs.length,
    bufferWarnings: warnings.length,
    warnings: warnings.slice(0, 5),
  };

  writeFileSync(join(OUTPUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));

  if (warnings.length > 0) {
    console.error('\n⚠️ Buffer warnings detected');
    process.exitCode = 1;
  } else {
    console.log('\n✅ Capture complete — no buffer warnings');
  }

  await browser.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});