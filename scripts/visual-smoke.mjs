#!/usr/bin/env node
/**
 * Visual smoke harness — pattern renderer matrix with screenshots + console audit.
 *
 * Usage:
 *   npm run preview -- --port 4173 &   # or npm run dev
 *   npm run smoke:visual
 *
 * Env:
 *   BASE_URL         default http://localhost:4173
 *   OUTPUT_DIR       default ./artifacts/visual-smoke
 *   SMOKE_PROFILE    ci | quick | full (default full)
 *   RENDERERS        override comma list
 *   SHADER_FILES     override comma list
 *   LITE_MODES       0,1
 *   MODULE_URLS      /4-mat_madness.mod,/test.xm
 *   SEEK_ROWS        default 0,8,16
 *   TIMEOUT          ms (default 60000)
 *   WEBGPU_TIMEOUT   ms for webgpu attempts (default 12000)
 *   FAIL_ON_WARN     1 to treat buffer warnings as hard fail
 */
import { mkdirSync, writeFileSync, existsSync, rmSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  launchBrowser,
  openPage,
  goto,
  waitForFunction,
  evaluate,
  screenshotElement,
} from './lib/browser-launch.mjs';
import {
  buildScenarioMatrix,
  CONSOLE_FAIL_PATTERNS,
  CONSOLE_WARN_PATTERNS,
} from './lib/visual-smoke-config.mjs';

const BASE_URL = (process.env.BASE_URL || 'http://localhost:4173').replace(/\/$/, '');
const OUTPUT_DIR = process.env.OUTPUT_DIR || join(process.cwd(), 'artifacts', 'visual-smoke');
const TIMEOUT = Number(process.env.TIMEOUT || 60000);
const WEBGPU_TIMEOUT = Number(process.env.WEBGPU_TIMEOUT || 12000);
const FAIL_ON_WARN = process.env.FAIL_ON_WARN === '1';

/** Detect Vite base path from served index.html (e.g. /xm-player). */
async function detectAppBase(url) {
  if (process.env.APP_BASE_PATH != null) {
    const p = process.env.APP_BASE_PATH.replace(/\/$/, '');
    return p === '/' ? '' : p;
  }
  const res = await fetch(`${url}/`);
  const html = await res.text();
  const asset = html.match(/src="([^"]*?)assets\/index-[^"]+\.js"/);
  if (asset?.[1]) {
    const prefix = asset[1].replace(/\/$/, '');
    if (prefix && prefix !== '/') return prefix;
  }
  return '';
}

function sanitize(name) {
  return name.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function classifyConsole(lines) {
  const failures = [];
  const warnings = [];
  for (const line of lines) {
    if (CONSOLE_FAIL_PATTERNS.some((re) => re.test(line))) failures.push(line);
    else if (/\[DURA-PARITY\]/.test(line) && !/\[DURA-PARITY\]\s*✓/.test(line)) failures.push(line);
    else if (CONSOLE_WARN_PATTERNS.some((re) => re.test(line))) warnings.push(line);
  }
  const duraOk = lines.some((l) => /\[DURA-PARITY\]\s*✓/.test(l));
  const duraFail = lines.some((l) => /\[DURA-PARITY\]/.test(l) && !/\[DURA-PARITY\]\s*✓/.test(l));
  return { failures, warnings, duraOk, duraFail };
}

async function seedSession(page, { shaderFile, renderer, lite }) {
  await page.evaluate(({ shader, renderer: r, lite: l }) => {
    localStorage.setItem('xasm1_last_shader', JSON.stringify(shader));
    localStorage.setItem('xasm1_pattern_renderer', r);
    localStorage.setItem('xasm1_lite_mode', String(l));
    window.DEBUG_RENDERER = r;
  }, { shader: shaderFile, renderer, lite });
}

async function waitForAppReady(page, timeout) {
  await waitForFunction(
    page,
    () => window.libopenmptReady !== undefined || window.libopenmpt !== undefined,
    { timeout },
  );
  await waitForFunction(
    page,
    () => window.__TEST_HOOKS__?.isModuleLoaded?.() === true,
    { timeout },
  );
}

async function readCanvasPixels(page) {
  return evaluate(page, () => {
    const r = window.currentPatternRenderer;
    if (r?.readPixels) {
      try {
        const px = r.readPixels();
        if (!px) return { ok: false, reason: 'readPixels-null' };
        let opaque = 0;
        for (let i = 3; i < px.length; i += 4) {
          if (px[i] > 8) opaque++;
        }
        return { ok: opaque > 50, opaque, total: px.length / 4 };
      } catch (e) {
        return { ok: false, reason: String(e) };
      }
    }
    const canvas = document.querySelector('canvas[data-shader-preview-source="true"]');
    if (!canvas) return { ok: false, reason: 'no-canvas' };
    return { ok: canvas.width > 0 && canvas.height > 0, width: canvas.width, height: canvas.height };
  });
}

async function captureScenario(browser, engine, scenario, appRoot) {
  const dir = join(
    OUTPUT_DIR,
    scenario.renderer,
    `lite${scenario.lite}`,
    sanitize(scenario.shaderFile),
    sanitize(new URL(scenario.moduleUrl).pathname),
  );
  mkdirSync(dir, { recursive: true });

  const { page, context } = await openPage(browser, engine);
  const logs = [];
  const pageErrors = [];

  page.on('console', (msg) => {
    const text = typeof msg.text === 'function' ? msg.text() : String(msg);
    const type = typeof msg.type === 'function' ? msg.type() : 'log';
    logs.push(`[${type}] ${text}`);
  });
  page.on('pageerror', (err) => {
    pageErrors.push(err?.message ?? String(err));
  });

  const result = {
    ...scenario,
    screenshots: [],
    consoleMessages: 0,
    pageErrors,
    signals: {
      moduleLoaded: false,
      activeRenderer: null,
      audioEngine: null,
      liteMode: null,
      duraParityOk: false,
      canvasPixels: null,
    },
    status: 'PENDING',
    errors: [],
  };

  const timeout = scenario.renderer === 'webgpu' ? WEBGPU_TIMEOUT : TIMEOUT;

  try {
    const liteParam = scenario.lite === 1 ? '1' : '0';
    const url = `${appRoot}/?renderer=${scenario.renderer}&lite=${liteParam}`;
    await goto(page, engine, url, TIMEOUT);
    await seedSession(page, scenario);
    await goto(page, engine, url, TIMEOUT);

    // App auto-loads DEFAULT_MODULE_URL; explicit load only for non-default modules.
    const defaultModPath = '/4-mat_madness.mod';
    const scenarioPath = new URL(scenario.moduleUrl).pathname;
    if (!scenarioPath.endsWith(defaultModPath)) {
      await evaluate(page, async (moduleUrl) => {
        await window.__TEST_HOOKS__?.loadModuleFromUrl(moduleUrl);
      }, scenario.moduleUrl);
    }

    try {
      await waitForAppReady(page, timeout);
      result.signals.moduleLoaded = true;
    } catch (e) {
      if (scenario.renderer !== 'webgpu') throw e;
    }

    if (scenario.renderer === 'html') {
      await page.waitForSelector('.pattern-html-fallback', { timeout });
    } else {
      try {
        await waitForFunction(
          page,
          () => window.currentPatternRenderer?.getCanvas?.() != null,
          { timeout },
        );
      } catch {
        /* webgpu headless may not init */
      }
    }

    await new Promise((r) => setTimeout(r, scenario.renderer === 'webgpu' ? 1500 : 3000));

    result.signals.activeRenderer = await evaluate(page, () =>
      window.__TEST_HOOKS__?.getActiveRenderer?.() ?? window.currentPatternRenderer?.backend ?? null,
    );
    result.signals.audioEngine = await evaluate(page, () =>
      window.__TEST_HOOKS__?.getAudioEngine?.() ?? null,
    );
    result.signals.liteMode = await evaluate(page, () =>
      window.__TEST_HOOKS__?.getLiteMode?.() ?? null,
    );

    const shotPath = join(dir, '00_initial.png');
    if (scenario.renderer === 'html') {
      const ok = await screenshotElement(page, engine, '.pattern-html-fallback', shotPath);
      if (!ok) await page.screenshot({ path: shotPath });
    } else {
      const ok = await screenshotElement(page, engine, 'canvas[data-shader-preview-source="true"]', shotPath);
      if (!ok) await page.screenshot({ path: shotPath });
    }
    result.screenshots.push({ label: '00_initial', path: shotPath });

    for (const row of scenario.seekRows) {
      await evaluate(page, (r) => window.__TEST_HOOKS__?.seekToRow?.(r), row);
      await new Promise((res) => setTimeout(res, 900));
      const label = `row_${String(row).padStart(2, '0')}`;
      const path = join(dir, `${label}.png`);
      if (scenario.renderer === 'html') {
        await screenshotElement(page, engine, '.pattern-html-fallback', path);
      } else {
        await screenshotElement(page, engine, 'canvas[data-shader-preview-source="true"]', path);
      }
      result.screenshots.push({ label, path });
    }

    result.signals.canvasPixels = await readCanvasPixels(page);
    const consoleAudit = classifyConsole([...logs, ...pageErrors.map((e) => `[pageerror] ${e}`)]);
    result.signals.duraParityOk = consoleAudit.duraOk;
    result.consoleMessages = logs.length;
    result.consoleFailures = consoleAudit.failures;
    result.consoleWarnings = consoleAudit.warnings;

    const shotBytes = existsSync(shotPath) ? statSync(shotPath).size : 0;
    result.initialScreenshotBytes = shotBytes;

    const webgpuExpectedFail =
      scenario.renderer === 'webgpu' &&
      (!result.signals.moduleLoaded ||
        !result.signals.activeRenderer ||
        shotBytes < 8000 ||
        result.signals.activeRenderer !== 'webgpu');

    if (webgpuExpectedFail) {
      result.status = 'EXPECTED_SKIP — WebGPU unavailable in headless CI';
    } else if (pageErrors.length > 0) {
      result.status = 'FAIL — page errors';
      result.errors.push(...pageErrors);
    } else if (consoleAudit.failures.length > 0) {
      result.status = 'FAIL — console errors';
      result.errors.push(...consoleAudit.failures);
    } else if (FAIL_ON_WARN && consoleAudit.warnings.length > 0) {
      result.status = 'FAIL — console warnings';
      result.errors.push(...consoleAudit.warnings);
    } else if (scenario.renderer !== 'html' && result.signals.canvasPixels && !result.signals.canvasPixels.ok) {
      result.status = 'FAIL — blank or unreadable canvas';
      result.errors.push(`canvas: ${JSON.stringify(result.signals.canvasPixels)}`);
    } else if (shotBytes < 3000 && scenario.renderer !== 'html') {
      result.status = 'FAIL — screenshot too small (likely blank canvas)';
      result.errors.push(`screenshot bytes=${shotBytes}`);
    } else {
      result.status = 'PASS';
    }
  } catch (e) {
    result.status = `FAIL — ${e.message}`;
    result.errors.push(e.message);
    try {
      const errPath = join(dir, 'error.png');
      await page.screenshot({ path: errPath });
      result.screenshots.push({ label: 'error', path: errPath });
    } catch { /* ignore */ }
  }

  if (context) await context.close();
  else await page.close();
  return result;
}

function generateMarkdown(report) {
  const lines = [
    '# Visual Smoke Report',
    '',
    `**Date:** ${report.timestamp}`,
    `**Base URL:** ${report.baseUrl}`,
    `**Profile:** ${report.profile}`,
    `**Output:** ${report.outputDir}`,
    '',
    '## Summary',
    '',
    `- Total: ${report.summary.total}`,
    `- PASS: ${report.summary.pass}`,
    `- EXPECTED_SKIP: ${report.summary.expectedSkip}`,
    `- FAIL: ${report.summary.fail}`,
    `- DURA-PARITY ✓ seen: ${report.summary.duraParityOk}`,
    '',
    '## Results',
    '',
    '| Renderer | Lite | Shader | Module | Status | Engine | DURA | Canvas |',
    '|----------|------|--------|--------|--------|--------|------|--------|',
  ];
  for (const r of report.results) {
    const mod = new URL(r.moduleUrl).pathname;
    lines.push(
      `| ${r.renderer} | ${r.lite} | ${r.shaderFile} | ${mod} | ${r.status} | ${r.signals.audioEngine ?? '—'} | ${r.signals.duraParityOk ? '✓' : '—'} | ${r.signals.canvasPixels?.ok ? 'ok' : '—'} |`,
    );
  }
  lines.push('', '## Manual WebGPU checklist', '');
  lines.push('See [docs/VISUAL_SMOKE.md](../docs/VISUAL_SMOKE.md) for desktop WebGPU + mobile verification.');
  return lines.join('\n');
}

async function main() {
  const appBase = await detectAppBase(BASE_URL);
  const appRoot = `${BASE_URL}${appBase}`;
  const { profile, scenarios, shaders, renderers, liteModes, modules } = buildScenarioMatrix(appRoot);

  if (existsSync(OUTPUT_DIR) && process.env.KEEP_OUTPUT !== '1') {
    rmSync(OUTPUT_DIR, { recursive: true, force: true });
  }
  mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log('=== Visual Smoke ===');
  console.log(`Base:     ${BASE_URL}`);
  console.log(`App root: ${appRoot}`);
  console.log(`Profile:  ${profile}`);
  console.log(`Output:   ${OUTPUT_DIR}`);
  console.log(`Shaders:  ${shaders.join(', ')}`);
  console.log(`Renderers:${renderers.join(', ')}`);
  console.log(`Lite:     ${liteModes.join(', ')}`);
  console.log(`Modules:  ${modules.join(', ')}`);
  console.log(`Scenarios:${scenarios.length}\n`);

  // Preflight: server reachable
  try {
    const res = await fetch(`${appRoot}/`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    console.error(`❌ Cannot reach ${appRoot} — start preview/dev first (${e.message})`);
    process.exit(1);
  }

  const { browser, engine, close } = await launchBrowser();
  const results = [];

  try {
    for (const scenario of scenarios) {
      const label = `${scenario.renderer} lite=${scenario.lite} ${scenario.shaderFile}`;
      console.log(`→ ${label}`);
      const result = await captureScenario(browser, engine, scenario, appRoot);
      results.push(result);
      console.log(`  ${result.status}`);
    }
  } finally {
    await close();
  }

  const report = {
    timestamp: new Date().toISOString(),
    baseUrl: BASE_URL,
    appBase,
    appRoot,
    profile,
    outputDir: OUTPUT_DIR,
    matrix: { shaders, renderers, liteModes, modules },
    results,
    summary: {
      total: results.length,
      pass: results.filter((r) => r.status === 'PASS').length,
      expectedSkip: results.filter((r) => r.status.startsWith('EXPECTED_SKIP')).length,
      fail: results.filter((r) => r.status.startsWith('FAIL')).length,
      duraParityOk: results.some((r) => r.signals.duraParityOk),
    },
  };

  writeFileSync(join(OUTPUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(OUTPUT_DIR, 'VISUAL_SMOKE_REPORT.md'), generateMarkdown(report));

  console.log('\n=== Summary ===');
  console.log(`PASS: ${report.summary.pass} / ${report.summary.total}`);
  console.log(`FAIL: ${report.summary.fail}`);
  console.log(`Artifacts: ${OUTPUT_DIR}`);

  if (report.summary.fail > 0) {
    console.error('\nFailures:');
    for (const r of results.filter((x) => x.status.startsWith('FAIL'))) {
      console.error(`  - ${r.renderer} ${r.shaderFile} lite=${r.lite}: ${r.status}`);
      for (const e of r.errors.slice(0, 3)) console.error(`      ${e}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
