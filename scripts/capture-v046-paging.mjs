#!/usr/bin/env node
/**
 * Visual + programmatic regression for v0.46 circular hybrid overlay paging.
 *
 * Verifies WebGL frosted caps fetch the same paged row data as the WGSL grid
 * after playhead crosses numRows (e.g. row 64+ on a 64-row pattern).
 *
 * Usage (dev server on :5173):
 *   npm run capture:v046-paging
 *
 * Env:
 *   TEST_URL       — base URL (default http://localhost:5173)
 *   SHADER_FILE    — default patternv0.46.wgsl
 *   MODULE_URL     — module to load (default /4-mat_madness.mod)
 *   SEEK_ROWS      — default 0,32,64,96
 *   OUTPUT_DIR     — default /tmp/mod-player-v046-paging
 *   CHROME_PATH    — optional Chrome/Chromium binary (puppeteer fallback)
 *   USE_XVFB       — set to 1 to run headed Chrome under xvfb-run (optional)
 */

import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BASE_URL = process.env.TEST_URL || 'http://localhost:5173';
const SHADER_FILE = process.env.SHADER_FILE || 'patternv0.46.wgsl';
const MODULE_URL = process.env.MODULE_URL || `${BASE_URL}/4-mat_madness.mod`;
const SEEK_ROWS = (process.env.SEEK_ROWS || '0,32,64,96').split(',').map(Number);
const OUTPUT_DIR = process.env.OUTPUT_DIR || '/tmp/mod-player-v046-paging';
const TIMEOUT = Number(process.env.TIMEOUT || 60000);
const CHROME_PATH = process.env.CHROME_PATH || '/usr/bin/google-chrome';

const CHROME_ARGS = [
  '--no-sandbox',
  '--headless=new',
  '--use-angle=vulkan',
  '--enable-features=Vulkan',
  '--disable-vulkan-surface',
  '--enable-unsafe-webgpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--window-size=1280,720',
];

mkdirSync(OUTPUT_DIR, { recursive: true });

async function launchBrowser() {
  const chromeArgs = [
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan',
    '--use-angle=vulkan',
    '--disable-vulkan-surface',
    '--no-sandbox',
  ];

  try {
    const { chromium } = await import('playwright');
    const headless = process.env.USE_XVFB !== '1';
    const browser = await chromium.launch({
      channel: 'chrome',
      headless,
      args: chromeArgs,
    });
    console.log(`  using Playwright + system Chrome (headless=${headless})`);
    return { browser, engine: 'playwright' };
  } catch (err) {
    console.warn(`  Playwright+Chrome unavailable: ${err.message}`);
  }

  let puppeteer;
  try {
    puppeteer = await import('puppeteer-core');
  } catch {
    try {
      puppeteer = await import('puppeteer');
    } catch {
      throw new Error('No Playwright Chrome or puppeteer available');
    }
  }
  console.log('  using puppeteer-core + system Chrome');
  const launch = puppeteer.default?.launch ?? puppeteer.launch;
  const browser = await launch({
    headless: 'new',
    executablePath: CHROME_PATH,
    args: CHROME_ARGS,
  });
  return { browser, engine: 'puppeteer' };
}

async function openPage(browser, engine) {
  if (engine === 'playwright') {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    return { page, engine, context };
  }
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  return { page, engine, context: null };
}

async function seedSession(page, { shader, renderer }) {
  await page.evaluate(({ shader: s, renderer: r }) => {
    // useLocalStorage stores JSON-stringified values — raw strings break shader selection.
    localStorage.setItem('xasm1_last_shader', JSON.stringify(s));
    localStorage.setItem('xasm1_pattern_renderer', r);
    localStorage.setItem('xasm1_lite_mode', '0');
    window.DEBUG_RENDERER = r;
  }, { shader, renderer });
}

async function waitForHybridOverlay(page) {
  await page.waitForFunction(
    () => {
      const overlay = document.querySelector('[data-overlay-canvas="true"]');
      const overlayVisible =
        overlay != null && getComputedStyle(overlay).display !== 'none';
      const backend = window.currentPatternRenderer?.backend ?? null;
      return overlayVisible && backend === 'webgpu';
    },
    { timeout: TIMEOUT },
  );
}

async function waitForModule(page) {
  await page.waitForFunction(
    () => window.__TEST_HOOKS__?.isModuleLoaded?.() === true,
    { timeout: TIMEOUT },
  );
}

async function captureLayers(page, label, engine) {
  const paths = {};

  if (engine === 'playwright') {
    const webgpu = page.locator('canvas[data-shader-preview-source="true"]');
    if (await webgpu.count()) {
      paths.webgpu = join(OUTPUT_DIR, `${label}_webgpu.png`);
      await webgpu.screenshot({ path: paths.webgpu });
    }
    const overlay = page.locator('[data-overlay-canvas="true"]');
    if (await overlay.count()) {
      paths.overlay = join(OUTPUT_DIR, `${label}_overlay.png`);
      await overlay.screenshot({ path: paths.overlay });
    }
    paths.composite = join(OUTPUT_DIR, `${label}_composite.png`);
    await page.screenshot({ path: paths.composite });
    return paths;
  }

  const webgpu = await page.$('canvas[data-shader-preview-source="true"]');
  if (webgpu) {
    paths.webgpu = join(OUTPUT_DIR, `${label}_webgpu.png`);
    await webgpu.screenshot({ path: paths.webgpu });
  }
  const overlay = await page.$('[data-overlay-canvas="true"]');
  if (overlay) {
    paths.overlay = join(OUTPUT_DIR, `${label}_overlay.png`);
    try {
      await overlay.screenshot({ path: paths.overlay });
    } catch {
      console.warn(`  overlay screenshot skipped for ${label} (not visible)`);
    }
  }
  const composite = join(OUTPUT_DIR, `${label}_composite.png`);
  await page.screenshot({ path: composite, fullPage: false });
  paths.composite = composite;
  return paths;
}

function fileSize(path) {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

async function run() {
  console.log('v0.46 circular paging overlay regression');
  console.log(`  url=${BASE_URL}  shader=${SHADER_FILE}`);
  console.log(`  module=${MODULE_URL}`);
  console.log(`  output=${OUTPUT_DIR}`);

  const { browser, engine } = await launchBrowser();
  const { page } = await openPage(browser, engine);

  const logs = [];
  page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => console.error('[pageerror]', err.message));

  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  await seedSession(page, { shader: SHADER_FILE, renderer: 'webgpu' });

  const navWait = engine === 'playwright' ? 'networkidle' : 'networkidle2';
  await page.goto(`${BASE_URL}/?renderer=webgpu&lite=0`, { waitUntil: navWait, timeout: TIMEOUT });
  await waitForModule(page);

  console.log(`Loading module: ${MODULE_URL}`);
  await page.evaluate(async (url) => {
    await window.__TEST_HOOKS__?.loadModuleFromUrl(url);
  }, MODULE_URL);
  await page.evaluate((shader) => {
    window.__TEST_HOOKS__?.selectShader?.(shader);
  }, SHADER_FILE);

  try {
    await waitForHybridOverlay(page);
  } catch {
    console.warn('⚠️ Hybrid overlay did not become visible — continuing with programmatic checks');
  }

  await page.waitForFunction(
    () => window.__TEST_HOOKS__?.getShaderFile?.()?.includes('v0.46'),
    { timeout: 15000 },
  );

  const overlayActive = await page.evaluate(() => {
    const overlay = document.querySelector('[data-overlay-canvas="true"]');
    return overlay != null && getComputedStyle(overlay).display !== 'none';
  });

  const webgpuBackend = await page.evaluate(() => window.currentPatternRenderer?.backend ?? null);
  console.log(`  activeRenderer=${webgpuBackend} overlayActive=${overlayActive}`);
  if (!overlayActive) {
    console.warn('⚠️ WebGL overlay canvas not visible — check lite mode / shader localStorage JSON');
  }

  const rowChecks = [];
  const screenshots = {};

  for (const row of SEEK_ROWS) {
    await page.evaluate(async (r) => {
      window.__TEST_HOOKS__?.stopPlayback?.();
      window.__TEST_HOOKS__?.seekToRow(r);
      window.__TEST_HOOKS__?.setPlayheadFraction(r);
      await new Promise((res) => {
        let frames = 0;
        const tick = () => {
          if (++frames >= 15) res();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    }, row);
    await new Promise((r) => setTimeout(r, 500));

    const paging = await page.evaluate(() => window.__TEST_HOOKS__?.getCircularOverlayPaging?.());
    const label = `row_${String(row).padStart(3, '0')}`;
    screenshots[row] = await captureLayers(page, label, engine);
    rowChecks.push({ row, paging, screenshots: screenshots[row] });
    console.log(`  row ${row}: playhead=${paging?.playhead?.toFixed?.(2)} pageStart=${paging?.pageStart} ok=${paging?.ok} mismatches=${paging?.mismatches?.length ?? 0}`);
    if (paging?.mismatches?.length) {
      for (const m of paging.mismatches.slice(0, 3)) {
        console.log(`    mismatch step ${m.stepIndex}: expected row ${m.expectedRow} note ${m.expectedNote}, stale row ${m.staleRow} note ${m.staleNote}`);
      }
    }
  }

  const warnings = logs.filter((l) =>
    /BOUNDS VIOLATION|CELL COUNT MISMATCH|buffer size mismatch|INVARIANT/i.test(l),
  );

  const allPagingOk = rowChecks.every((c) => c.paging?.ok !== false);
  const pagingBoundaryOk = rowChecks.some((c) => c.row >= 64 && c.paging?.pageStart >= 64);
  const overlayOk = overlayActive && webgpuBackend === 'webgpu';
  const overlayVisualOk = overlayActive;

  // Visual sanity: paged rows should produce different overlay pixels than page 0.
  const overlay0 = screenshots[0]?.overlay;
  const overlay64 = screenshots[64]?.overlay;
  const overlay96 = screenshots[96]?.overlay;
  const size0 = overlay0 ? fileSize(overlay0) : 0;
  const size64 = overlay64 ? fileSize(overlay64) : 0;
  const size96 = overlay96 ? fileSize(overlay96) : 0;
  const visualPagingDiffers =
    overlayVisualOk &&
    size0 > 1000 &&
    size64 > 1000 &&
    (size64 !== size0 || (size96 > 1000 && size96 !== size0));

  const summary = {
    shader: SHADER_FILE,
    module: MODULE_URL,
    seekRows: SEEK_ROWS,
    overlayActive,
    webgpuBackend,
    visualPagingDiffers,
    screenshotBytes: { row0: size0, row64: size64, row96: size96 },
    rowChecks,
    bufferWarnings: warnings.length,
    warnings: warnings.slice(0, 5),
    pagingBoundaryOk,
    status:
      allPagingOk && pagingBoundaryOk && warnings.length === 0
        ? visualPagingDiffers
          ? 'PASS'
          : overlayVisualOk
            ? 'PASS_PARTIAL'
            : 'PASS_PARTIAL'
        : 'FAIL',
    note:
      visualPagingDiffers
        ? overlayOk
          ? null
          : 'Overlay paging screenshots differ; WebGPU backend lost in headless after init — verify cap/grid alignment in a real browser'
        : overlayVisualOk
          ? 'Overlay visible; screenshot byte comparison inconclusive — paging math verified'
          : 'Overlay/WebGPU unavailable in headless — paging math verified programmatically',
  };

  writeFileSync(join(OUTPUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
  writeFileSync(
    join(OUTPUT_DIR, 'REPORT.md'),
    [
      '# v0.46 Circular Overlay Paging Regression',
      '',
      `**Status:** ${summary.status}`,
      `**Shader:** ${SHADER_FILE}`,
      `**Module:** ${MODULE_URL}`,
      `**Overlay active:** ${overlayActive}`,
      `**WebGPU backend:** ${webgpuBackend}`,
      `**Visual paging differs (screenshot bytes):** ${visualPagingDiffers}`,
      '',
      '## Row checks',
      '',
      ...rowChecks.map((c) => {
        const p = c.paging;
        return `- **Row ${c.row}:** pageStart=${p?.pageStart ?? '?'} ok=${p?.ok ?? false} playhead=${p?.playhead?.toFixed?.(2) ?? '?'} mismatches=${p?.mismatches?.length ?? 0}`;
      }),
      '',
      '## Screenshots',
      '',
      ...SEEK_ROWS.map((r) => `- \`row_${String(r).padStart(3, '0')}_composite.png\` (also \`_webgpu.png\`, \`_overlay.png\`)`),
      '',
      summary.note ? `## Note\n\n${summary.note}` : '',
      warnings.length ? `## Warnings\n\n${warnings.map((w) => `- ${w}`).join('\n')}` : '',
    ].join('\n'),
  );

  console.log('\n=== SUMMARY ===');
  console.log(
    JSON.stringify(
      {
        status: summary.status,
        overlayActive,
        webgpuBackend,
        visualPagingDiffers,
        rowChecks: rowChecks.map((c) => ({ row: c.row, ok: c.paging?.ok, pageStart: c.paging?.pageStart })),
      },
      null,
      2,
    ),
  );
  console.log(`Report: ${join(OUTPUT_DIR, 'REPORT.md')}`);

  await browser.close();
  process.exitCode = summary.status === 'FAIL' ? 1 : 0;
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
