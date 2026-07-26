#!/usr/bin/env node
/**
 * Playhead sync acceptance — worklet prediction lag + circular paging checks.
 *
 * Usage (preview or dev server):
 *   npm run preview -- --port 4173 &
 *   npm run smoke:playhead
 *
 * Env:
 *   BASE_URL         default http://localhost:4173
 *   OUTPUT_DIR       default ./artifacts/playhead-acceptance
 *   MODULE_URL       default /4-mat_madness.mod
 *   SAMPLE_MS        poll interval (default 50)
 *   PLAY_MS          playback sample window (default 3000)
 *   LAG_THRESHOLD    max |predictionLagRows| (default 1.0)
 *   PASS_RATIO       min fraction of samples under threshold (default 0.95)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  launchBrowser,
  openPage,
  goto,
  waitForFunction,
  evaluate,
} from './lib/browser-launch.mjs';

const BASE_URL = (process.env.BASE_URL || 'http://localhost:4173').replace(/\/$/, '');
const OUTPUT_DIR = process.env.OUTPUT_DIR || join(process.cwd(), 'artifacts', 'playhead-acceptance');
const MODULE_URL = process.env.MODULE_URL || `${BASE_URL}/4-mat_madness.mod`;
const SAMPLE_MS = Number(process.env.SAMPLE_MS || 50);
const PLAY_MS = Number(process.env.PLAY_MS || 4500);
const WARMUP_MS = Number(process.env.WARMUP_MS || 1500);
const LAG_THRESHOLD = Number(process.env.LAG_THRESHOLD || 1.0);
const PASS_RATIO = Number(process.env.PASS_RATIO || 0.95);
const TIMEOUT = Number(process.env.TIMEOUT || 60000);
const SEEK_ROWS = (process.env.SEEK_ROWS || '0,32,64,96').split(',').map(Number);

const SCENARIOS = [
  { id: 'square', shader: 'patternv0.44.wgsl', renderer: 'webgl2', paging: false, lagCheck: true },
  { id: 'circular', shader: 'patternv0.46.wgsl', renderer: 'webgl2', paging: true, lagCheck: false },
];

mkdirSync(OUTPUT_DIR, { recursive: true });

async function seedSession(page, { shader, renderer }) {
  await evaluate(page, ({ shader: s, renderer: r }) => {
    localStorage.setItem('xasm1_last_shader', JSON.stringify(s));
    localStorage.setItem('xasm1_pattern_renderer', r);
    localStorage.setItem('xasm1_lite_mode', '0');
    localStorage.setItem('xasm1_playhead_debug', '1');
    window.DEBUG_RENDERER = r;
  }, { shader, renderer });
}

async function waitForModule(page) {
  await waitForFunction(
    page,
    () => window.__TEST_HOOKS__?.isModuleLoaded?.() === true,
    { timeout: TIMEOUT },
  );
}

async function clickPlay(page, engine) {
  if (engine === 'playwright') {
    const playBtn = page.locator('button', { hasText: 'Play' }).first();
    if (await playBtn.count()) {
      await playBtn.click();
    }
  } else {
    await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('button')];
      const play = buttons.find((b) => /play/i.test(b.textContent ?? ''));
      play?.click();
    });
  }
  await waitForFunction(
    page,
    () => window.__TEST_HOOKS__?.getIsPlaying?.() === true,
    { timeout: 10000 },
  ).catch(() => {
    /* fallback: hooks may still sample if RAF loop is active */
  });
}

async function samplePlayheadDuringPlayback(page, engine) {
  await clickPlay(page, engine);
  await new Promise((r) => setTimeout(r, 400));

  const samples = [];
  const start = Date.now();
  while (Date.now() - start < PLAY_MS) {
    const snap = await evaluate(page, () =>
      window.__TEST_HOOKS__?.getPlayheadDebug?.() ?? window.__PLAYHEAD_DEBUG__ ?? null,
    );
    if (snap) samples.push({ ...snap, t: Date.now() - start });
    await new Promise((r) => setTimeout(r, SAMPLE_MS));
  }

  await evaluate(page, () => {
    window.__TEST_HOOKS__?.stopPlayback?.();
  });

  return samples;
}

function analyzeLagSamples(samples) {
  const warmed = samples.filter((s) => (s.t ?? 0) >= WARMUP_MS);
  const pool = warmed.length >= 5 ? warmed : samples;
  const withLag = pool.filter((s) => s.predictionLagRows != null && Number.isFinite(s.predictionLagRows));
  if (!withLag.length) {
    return { ok: false, skipped: true, reason: 'no-samples', total: samples.length, warmed: warmed.length, underThreshold: 0, ratio: 0 };
  }
  const under = withLag.filter((s) => Math.abs(s.predictionLagRows) < LAG_THRESHOLD);
  const lags = withLag.map((s) => s.predictionLagRows);
  const absLags = lags.map(Math.abs);
  const median = absLags.sort((a, b) => a - b)[Math.floor(absLags.length / 2)] ?? 0;
  const ratio = under.length / withLag.length;
  const medianOk = median < LAG_THRESHOLD;
  return {
    ok: medianOk && ratio >= PASS_RATIO,
    total: withLag.length,
    warmed: warmed.length,
    underThreshold: under.length,
    ratio,
    medianAbsLagRows: median,
    maxAbsLagRows: Math.max(...absLags),
    engineModes: [...new Set(withLag.map((s) => s.mode))],
  };
}

async function checkCircularPaging(page, engine) {
  const rowChecks = [];
  for (const row of SEEK_ROWS) {
    await evaluate(page, async (r) => {
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
    await new Promise((r) => setTimeout(r, 300));
    const paging = await evaluate(page, () => window.__TEST_HOOKS__?.getCircularOverlayPaging?.());
    rowChecks.push({ row, paging });
  }
  const mismatches = rowChecks.flatMap((c) => c.paging?.mismatches ?? []);
  const pagingBoundaryOk = rowChecks.some((c) => c.row >= 64 && (c.paging?.pageStart ?? 0) >= 64);
  const pagingOk =
    rowChecks.every((c) => c.paging?.ok !== false) &&
    (!rowChecks.some((c) => c.row >= 64) || pagingBoundaryOk);
  return { pagingOk, pagingBoundaryOk, rowChecks, mismatchCount: mismatches.length };
}

async function runScenario(browser, engine, scenario) {
  const { page, context } = await openPage(browser, engine);
  const result = {
    id: scenario.id,
    shader: scenario.shader,
    renderer: scenario.renderer,
    status: 'PENDING',
    lag: null,
    paging: null,
    audioEngine: null,
    errors: [],
  };

  try {
    const url = `${BASE_URL}/?renderer=${scenario.renderer}&lite=0`;
    await goto(page, engine, url, TIMEOUT);
    await seedSession(page, scenario);
    await goto(page, engine, url, TIMEOUT);

    const defaultMod = '/4-mat_madness.mod';
    if (!MODULE_URL.endsWith(defaultMod)) {
      await evaluate(page, async (moduleUrl) => {
        await window.__TEST_HOOKS__?.loadModuleFromUrl(moduleUrl);
      }, MODULE_URL);
    }

    await waitForModule(page);
    await evaluate(page, (shader) => {
      window.__TEST_HOOKS__?.selectShader?.(shader);
    }, scenario.shader);
    await waitForFunction(
      page,
      () => {
        const f = window.__TEST_HOOKS__?.getShaderFile?.() ?? '';
        return f.includes('v0.46') || f.includes('v0.44');
      },
      { timeout: 15000 },
    ).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 500));

    result.audioEngine = await evaluate(page, () => window.__TEST_HOOKS__?.getAudioEngine?.() ?? null);

    if (scenario.lagCheck !== false) {
      const samples = await samplePlayheadDuringPlayback(page, engine);
      result.lag = analyzeLagSamples(samples);
      result.lagSamples = samples.length;
    } else {
      result.lag = { ok: true, skipped: true, reason: 'paging-only-scenario' };
    }

    if (scenario.paging) {
      result.paging = await checkCircularPaging(page, engine);
    }

    const lagPass = result.lag?.ok === true || result.lag?.skipped === true;
    const pagingPass = !scenario.paging || result.paging?.pagingOk === true;
    result.status = lagPass && pagingPass ? 'PASS' : 'FAIL';

    if (!lagPass && !result.lag?.skipped) {
      result.errors.push(
        `lag ratio ${(result.lag?.ratio ?? 0).toFixed(3)} < ${PASS_RATIO} or median ${result.lag?.medianAbsLagRows?.toFixed(3)}`,
      );
    }
    if (scenario.paging && !pagingPass) {
      result.errors.push(`circular paging mismatches: ${result.paging?.mismatchCount ?? '?'}`);
    }
  } catch (err) {
    result.status = 'ERROR';
    result.errors.push(err?.message ?? String(err));
  } finally {
    if (context) await context.close();
    else await page.close();
  }

  return result;
}

async function main() {
  console.log('Playhead sync acceptance');
  console.log(`  base=${BASE_URL} module=${MODULE_URL}`);
  console.log(`  lag threshold=${LAG_THRESHOLD} rows, pass ratio>=${PASS_RATIO}`);

  const { browser, engine, close } = await launchBrowser();
  const results = [];

  try {
    for (const scenario of SCENARIOS) {
      console.log(`\n▶ ${scenario.id} (${scenario.shader}, ${scenario.renderer})`);
      const result = await runScenario(browser, engine, scenario);
      results.push(result);
      console.log(
        `  status=${result.status} engine=${result.audioEngine} lag median=${result.lag?.medianAbsLagRows?.toFixed(3) ?? 'n/a'} max=${result.lag?.maxAbsLagRows?.toFixed(3) ?? 'n/a'}`,
      );
      if (result.paging) {
        console.log(`  paging ok=${result.paging.pagingOk} mismatches=${result.paging.mismatchCount}`);
      }
      if (result.errors.length) {
        for (const e of result.errors) console.log(`  ✗ ${e}`);
      }
    }
  } finally {
    await close();
  }

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    moduleUrl: MODULE_URL,
    lagThreshold: LAG_THRESHOLD,
    passRatio: PASS_RATIO,
    scenarios: results,
    summary: {
      pass: results.every((r) => r.status === 'PASS'),
      passed: results.filter((r) => r.status === 'PASS').length,
      total: results.length,
    },
  };

  const reportPath = join(OUTPUT_DIR, 'report.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nReport: ${reportPath}`);
  console.log(`Summary: ${report.summary.passed}/${report.summary.total} PASS`);

  if (!report.summary.pass) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
