#!/usr/bin/env node
/**
 * Screenshot check for mod-player shader renderers.
 *
 * Captures the pattern visualizer under each requested renderer and shader,
 * exercising WebGL2 (GLSL), the HTML fallback, and optionally WebGPU (WGSL).
 * In headless Colab/WebGPU is normally unavailable, so WebGPU is expected to
 * fail gracefully and is recorded as such.
 *
 * Usage:
 *   node scripts/screenshot-shader-check.mjs
 *
 * Env:
 *   BASE_URL       local URL (default http://localhost:4173)
 *   REMOTE_URL     optional remote URL to compare (e.g. https://test.1ink.us/xm-player)
 *   RENDERERS      comma list: webgl2,html,webgpu (default webgl2,html)
 *   SHADER_FILES   comma list of WGSL shader ids (default patternv0.40.wgsl,patternv0.50.wgsl,patternv0.55.wgsl)
 *   SEEK_ROWS      comma list of rows (default 0,8,16,32)
 *   OUTPUT_DIR     default /mnt/ramdisk/mod-player-screenshots
 *   TIMEOUT        page wait timeout ms (default 45000)
 *   WEBGPU_TIMEOUT shorter timeout for expected WebGPU failures (default 8000)
 */

import puppeteer from '/content/headless-chrome-nvidia-t4-gpu-support/examples/puppeteer/node_modules/puppeteer/lib/puppeteer/puppeteer.js';
import { mkdirSync, writeFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

const BASE_URL = process.env.BASE_URL || 'http://localhost:4173';
const REMOTE_URL = process.env.REMOTE_URL || '';
const RENDERERS = (process.env.RENDERERS || 'webgl2,html').split(',').map((s) => s.trim()).filter(Boolean);
const SHADER_FILES = (process.env.SHADER_FILES || 'patternv0.40.wgsl,patternv0.50.wgsl,patternv0.55.wgsl').split(',').map((s) => s.trim()).filter(Boolean);
const SEEK_ROWS = (process.env.SEEK_ROWS || '0,8,16,32').split(',').map(Number).filter((n) => !Number.isNaN(n));
const OUTPUT_DIR = process.env.OUTPUT_DIR || '/mnt/ramdisk/mod-player-screenshots';
const TIMEOUT = Number(process.env.TIMEOUT || 45000);
const WEBGPU_TIMEOUT = Number(process.env.WEBGPU_TIMEOUT || 8000);

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

if (existsSync(OUTPUT_DIR)) {
  rmSync(OUTPUT_DIR, { recursive: true, force: true });
}
mkdirSync(OUTPUT_DIR, { recursive: true });

function sanitize(name) {
  return name.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

async function waitForModuleLoad(page, timeout) {
  await page.waitForFunction(
    () => window.__TEST_HOOKS__?.isModuleLoaded?.() === true,
    { timeout },
  );
}


async function captureRenderer(browser, targetUrl, renderer, shaderFile) {
  const safeShader = sanitize(shaderFile);
  const runDir = join(OUTPUT_DIR, sanitize(new URL(targetUrl).hostname), renderer, safeShader);
  mkdirSync(runDir, { recursive: true });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  const logs = [];
  const errors = [];
  page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => errors.push(err.message));

  const result = {
    targetUrl,
    renderer,
    shaderFile,
    screenshots: [],
    activeRenderer: null,
    moduleLoaded: false,
    errors: [],
    status: 'PENDING',
  };

  try {
    // Seed localStorage on the target origin, then reload with renderer param.
    await page.goto(`${targetUrl}/`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.evaluate(
      ({ shader, renderer }) => {
        localStorage.setItem('xasm1_last_shader', shader);
        localStorage.setItem('xasm1_pattern_renderer', renderer);
        window.DEBUG_RENDERER = renderer;
      },
      { shader: shaderFile, renderer },
    );

    const navUrl = `${targetUrl}/?renderer=${renderer}`;
    await page.goto(navUrl, { waitUntil: 'networkidle2', timeout: TIMEOUT });

    // Wait for the libopenmpt module to load (default demo module or previous load).
    const moduleTimeout = renderer === 'webgpu' ? WEBGPU_TIMEOUT : TIMEOUT;
    try {
      await waitForModuleLoad(page, moduleTimeout);
      result.moduleLoaded = true;
    } catch (e) {
      result.moduleLoaded = false;
      if (renderer !== 'webgpu') throw e;
    }

    // Give the renderer a moment to initialize.
    await new Promise((r) => setTimeout(r, renderer === 'webgpu' ? 1000 : 3000));

    if (renderer === 'html') {
      await page.waitForSelector('.pattern-html-fallback', { timeout: TIMEOUT });
      const path = join(runDir, '00_initial.png');
      const el = await page.$('.pattern-html-fallback');
      if (el) await el.screenshot({ path });
      else await page.screenshot({ path, fullPage: false });
      result.screenshots.push({ label: '00_initial', path });
    } else {
      try {
        await page.waitForFunction(
          () => window.currentPatternRenderer?.getCanvas?.() != null,
          { timeout: renderer === 'webgpu' ? WEBGPU_TIMEOUT : TIMEOUT },
        );
      } catch {
        // WebGPU often fails in headless; record and continue.
      }
      const canvas = await page.$('canvas[data-shader-preview-source="true"]');
      if (canvas) {
        const path = join(runDir, '00_initial.png');
        await canvas.screenshot({ path });
        result.screenshots.push({ label: '00_initial', path });
      } else {
        const path = join(runDir, '00_initial.png');
        await page.screenshot({ path, fullPage: false });
        result.screenshots.push({ label: '00_initial', path });
      }
    }

    result.activeRenderer = await page.evaluate(() => window.__TEST_HOOKS__?.getActiveRenderer?.() ?? null);

    // Seek to representative rows and capture the pattern at each position.
    for (const row of SEEK_ROWS) {
      try {
        await page.evaluate((r) => window.__TEST_HOOKS__?.seekToRow?.(r), row);
        await new Promise((r) => setTimeout(r, 1200));

        const label = `row_${String(row).padStart(2, '0')}`;
        const path = join(runDir, `${label}.png`);

        if (renderer === 'html') {
          const el = await page.$('.pattern-html-fallback');
          if (el) await el.screenshot({ path });
          else await page.screenshot({ path, fullPage: false });
        } else {
          const canvas = await page.$('canvas[data-shader-preview-source="true"]');
          if (canvas) await canvas.screenshot({ path });
          else await page.screenshot({ path, fullPage: false });
        }
        result.screenshots.push({ label, path });
      } catch (e) {
        result.errors.push(`seek row ${row}: ${e.message}`);
      }
    }

    const warnings = logs.filter((l) =>
      /BOUNDS VIOLATION|CELL COUNT MISMATCH|buffer size mismatch|INVARIANT|WebGPU not available|Failed to initialize WebGPU/i.test(l),
    );
    result.consoleMessages = logs.length;
    result.bufferWarnings = warnings.length;

    // A blank WebGPU canvas in headless Colab is expected; use the saved file size as a proxy.
    const initialSize = result.screenshots.find((s) => s.label === '00_initial')?.path
      ? statSync(result.screenshots.find((s) => s.label === '00_initial').path).size
      : 0;
    result.initialScreenshotBytes = initialSize;

    if (renderer === 'webgpu' && (initialSize < 20000 || !result.moduleLoaded || !result.activeRenderer)) {
      result.status = 'EXPECTED_FAILURE — WebGPU canvas blank/unavailable in headless environment';
    } else if (result.errors.length > 0 || result.bufferWarnings > 0) {
      result.status = result.bufferWarnings > 0 ? 'FAIL — buffer warnings' : 'PARTIAL';
    } else {
      result.status = 'PASS';
    }
  } catch (e) {
    result.status = `FAIL — ${e.message}`;
    result.errors.push(e.message);
    // Save a fallback page screenshot so the failure is visible.
    try {
      const path = join(runDir, 'error_fallback.png');
      await page.screenshot({ path, fullPage: false });
      result.screenshots.push({ label: 'error_fallback', path });
    } catch { /* ignore */ }
  }

  await page.close();
  return result;
}

async function main() {
  console.log('=== Mod-Player Shader Screenshot Check ===');
  console.log(`Local: ${BASE_URL}`);
  if (REMOTE_URL) console.log(`Remote: ${REMOTE_URL}`);
  console.log(`Renderers: ${RENDERERS.join(', ')}`);
  console.log(`Shaders: ${SHADER_FILES.join(', ')}`);
  console.log(`Output: ${OUTPUT_DIR}\n`);

  const browser = await puppeteer.launch({
    headless: 'new',
    ignoreDefaultArgs: true,
    args: CHROME_ARGS,
  });

  const targets = [BASE_URL];
  if (REMOTE_URL) targets.push(REMOTE_URL);

  const results = [];
  for (const target of targets) {
    for (const renderer of RENDERERS) {
      for (const shader of SHADER_FILES) {
        console.log(`Capturing ${new URL(target).hostname} / ${renderer} / ${shader} ...`);
        const result = await captureRenderer(browser, target, renderer, shader);
        results.push(result);
        console.log(`  -> ${result.status} (${result.screenshots.length} screenshots, active=${result.activeRenderer})`);
      }
    }
  }

  await browser.close();

  const report = {
    timestamp: new Date().toISOString(),
    baseUrl: BASE_URL,
    remoteUrl: REMOTE_URL || null,
    renderers: RENDERERS,
    shaderFiles: SHADER_FILES,
    seekRows: SEEK_ROWS,
    results,
    summary: {
      total: results.length,
      pass: results.filter((r) => r.status === 'PASS').length,
      partial: results.filter((r) => r.status.startsWith('PARTIAL')).length,
      expectedFailure: results.filter((r) => r.status.includes('EXPECTED_FAILURE')).length,
      fail: results.filter((r) => r.status.startsWith('FAIL')).length,
    },
  };

  writeFileSync(join(OUTPUT_DIR, 'report.json'), JSON.stringify(report, null, 2));

  const md = generateMarkdownReport(report);
  writeFileSync(join(OUTPUT_DIR, 'SCREENSHOT_REPORT.md'), md);

  console.log('\n=== Screenshot check complete ===');
  console.log(md);
}

function generateMarkdownReport(report) {
  const lines = [
    '# Mod-Player Shader Renderer Screenshot Check',
    '',
    `**Date:** ${report.timestamp}`,
    `**Local:** ${report.baseUrl}`,
    report.remoteUrl ? `**Remote:** ${report.remoteUrl}` : '',
    `**Renderers:** ${report.renderers.join(', ')}`,
    `**Shaders:** ${report.shaderFiles.join(', ')}`,
    '',
    '## Summary',
    '',
    `- Total runs: ${report.summary.total}`,
    `- PASS: ${report.summary.pass}`,
    `- PARTIAL: ${report.summary.partial}`,
    `- Expected failure (WebGPU headless): ${report.summary.expectedFailure}`,
    `- FAIL: ${report.summary.fail}`,
    '',
    '## Results',
    '',
    '| Target | Renderer | Shader | Active Renderer | Status | Screenshots |',
    '|--------|----------|--------|-----------------|--------|-------------|',
  ];
  for (const r of report.results) {
    const host = new URL(r.targetUrl).hostname;
    const shotLinks = r.screenshots.map((s) => `[${s.label}](${s.path})`).join(' ');
    lines.push(`| ${host} | ${r.renderer} | ${r.shaderFile} | ${r.activeRenderer ?? '—'} | ${r.status} | ${shotLinks} |`);
  }
  lines.push('', '## Notes', '');
  lines.push('- WebGPU is expected to be unavailable in this headless Colab environment.');
  lines.push('- The HTML fallback renders a DOM pattern grid instead of a canvas.');
  lines.push('- Captures are saved under `<hostname>/<renderer>/<shader>/` in the output directory.');
  return lines.filter((l) => l !== '').join('\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
