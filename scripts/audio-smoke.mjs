#!/usr/bin/env node
/**
 * Audio playback smoke harness — verifies worklet lifecycle invariants in a real browser.
 *
 * Usage:
 *   npm run preview -- --port 4173 --host 127.0.0.1 &
 *   npm run smoke:audio
 *
 * Env:
 *   BASE_URL     default http://127.0.0.1:4173
 *   TIMEOUT      ms (default 90000)
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

const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:4173').replace(/\/$/, '');
const TIMEOUT = Number(process.env.TIMEOUT || 90000);
const OUTPUT_DIR = process.env.OUTPUT_DIR || join(process.cwd(), 'artifacts', 'audio-smoke');
const MOD_URL = '/4-mat_madness.mod';
const XM_URL = '/test.xm';

async function waitForModuleLoaded(page, timeout) {
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

async function getDiagnostics(page) {
  return evaluate(page, () => window.__TEST_HOOKS__?.getAudioDiagnostics?.() ?? null);
}

async function clickPlay(page) {
  await evaluate(page, () => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const playBtn = buttons.find((b) => (b.textContent ?? '').includes('Play'));
    if (!playBtn) throw new Error('Play button not found');
    playBtn.click();
  });
}

async function ensurePlaying(page, timeout = TIMEOUT) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const diag = await getDiagnostics(page);
    if (diag?.isPlaying && diag?.contextState === 'running') return diag;
    await new Promise((r) => setTimeout(r, 300));
  }
  await clickPlay(page);
  await waitForPlaying(page, timeout);
  return getDiagnostics(page);
}

async function waitForPlaying(page, timeout = TIMEOUT) {
  await waitForFunction(
    page,
    () => window.__TEST_HOOKS__?.getAudioDiagnostics?.()?.isPlaying === true,
    { timeout },
  );
}

async function waitForPositionAdvance(page, minDelta = 0.05, waitMs = 3000) {
  await new Promise((r) => setTimeout(r, 1000));
  const start = await getDiagnostics(page);
  const startPos = start?.positionSeconds ?? 0;
  const startRms = start?.analyserRms ?? 0;
  await new Promise((r) => setTimeout(r, waitMs));
  const end = await getDiagnostics(page);
  const endPos = end?.positionSeconds ?? 0;
  const endRms = end?.analyserRms ?? 0;
  const advanced = endPos - startPos >= minDelta;
  const rmsActive = endRms > 0.5 || startRms > 0.5;
  return {
    startPos,
    endPos,
    startRms,
    endRms,
    delta: endPos - startPos,
    advanced: advanced || rmsActive,
  };
}

function assertPlaybackHealthy(label, diag, { initLibMax = 1, requireAdvance = true, advance } = {}) {
  const errors = [];
  if (!diag) errors.push('missing diagnostics');
  if (diag?.engine !== 'worklet') errors.push(`engine=${diag?.engine} (expected worklet)`);
  if (diag?.contextState !== 'running') errors.push(`contextState=${diag?.contextState}`);
  if ((diag?.initLibPostCount ?? 0) > initLibMax) {
    errors.push(`initLibPostCount=${diag?.initLibPostCount} (max ${initLibMax})`);
  }
  if (requireAdvance && advance && !advance.advanced) {
    errors.push(
      `no playback signal (rms ${advance.startRms ?? 0} -> ${advance.endRms ?? 0}, pos ${advance.startPos} -> ${advance.endPos})`,
    );
  }
  return { label, ok: errors.length === 0, errors, diag, advance };
}

async function runScenario(browser, engine, name, fn) {
  const { page } = await openPage(browser, engine);
  const logs = [];
  page.on('console', (msg) => {
    const text = typeof msg.text === 'function' ? msg.text() : String(msg);
    logs.push(text);
  });

  try {
    const result = await fn(page);
    return { name, status: 'PASS', ...result, logs };
  } catch (err) {
    return {
      name,
      status: 'FAIL',
      error: err?.message ?? String(err),
      logs,
    };
  } finally {
    await page.close();
  }
}

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const { browser, engine, close } = await launchBrowser();
  const results = [];

  try {
    // 1. Default auto-load → manual play (no auto-play on first paint)
    results.push(await runScenario(browser, engine, 'default-auto-load-then-play', async (page) => {
      await goto(page, engine, `${BASE_URL}/?renderer=webgl2`, TIMEOUT);
      await waitForModuleLoaded(page, TIMEOUT);
      const before = await getDiagnostics(page);
      if (before?.isPlaying) throw new Error('default load should not auto-play');
      await clickPlay(page);
      await waitForPlaying(page);
      const diag = await getDiagnostics(page);
      const advance = await waitForPositionAdvance(page);
      return assertPlaybackHealthy('default-auto-load-then-play', diag, { advance });
    }));

    // 2–4. loadModuleFromUrl paths (file-picker / playlist / storage convergence)
    results.push(await runScenario(browser, engine, 'file-picker-via-loadModuleFromUrl', async (page) => {
      await goto(page, engine, `${BASE_URL}/?renderer=webgl2`, TIMEOUT);
      await waitForModuleLoaded(page, TIMEOUT);
      await clickPlay(page);
      await waitForPlaying(page);
      await evaluate(page, async (url) => {
        await window.__TEST_HOOKS__?.loadModuleFromUrl(url);
      }, XM_URL);
      await ensurePlaying(page);
      const diag = await getDiagnostics(page);
      const advance = await waitForPositionAdvance(page);
      return assertPlaybackHealthy('file-picker-via-loadModuleFromUrl', diag, { advance });
    }));

    // 5. MOD → XM switch
    results.push(await runScenario(browser, engine, 'mod-to-xm-switch', async (page) => {
      await goto(page, engine, `${BASE_URL}/?renderer=webgl2`, TIMEOUT);
      await waitForModuleLoaded(page, TIMEOUT);
      await clickPlay(page);
      await waitForPlaying(page);
      await evaluate(page, async (url) => {
        await window.__TEST_HOOKS__?.loadModuleFromUrl(url);
      }, XM_URL);
      await ensurePlaying(page);
      const diag = await getDiagnostics(page);
      const advance = await waitForPositionAdvance(page);
      return assertPlaybackHealthy('mod-to-xm-switch', diag, { advance });
    }));

    // 6. XM → MOD switch
    results.push(await runScenario(browser, engine, 'xm-to-mod-switch', async (page) => {
      await goto(page, engine, `${BASE_URL}/?renderer=webgl2`, TIMEOUT);
      await waitForModuleLoaded(page, TIMEOUT);
      await evaluate(page, async (url) => {
        await window.__TEST_HOOKS__?.loadModuleFromUrl(url);
      }, XM_URL);
      await ensurePlaying(page);
      await evaluate(page, async (url) => {
        await window.__TEST_HOOKS__?.loadModuleFromUrl(url);
      }, MOD_URL);
      await ensurePlaying(page);
      const diag = await getDiagnostics(page);
      const advance = await waitForPositionAdvance(page);
      return assertPlaybackHealthy('xm-to-mod-switch', diag, { advance });
    }));

    // 7. Stop → reload same module
    results.push(await runScenario(browser, engine, 'stop-reload-same-module', async (page) => {
      await goto(page, engine, `${BASE_URL}/?renderer=webgl2`, TIMEOUT);
      await waitForModuleLoaded(page, TIMEOUT);
      await evaluate(page, async (url) => {
        await window.__TEST_HOOKS__?.loadModuleFromUrl(url);
      }, XM_URL);
      await ensurePlaying(page);
      await evaluate(page, () => window.__TEST_HOOKS__?.stopPlayback?.());
      await evaluate(page, async (url) => {
        await window.__TEST_HOOKS__?.loadModuleFromUrl(url);
      }, XM_URL);
      await ensurePlaying(page);
      const diag = await getDiagnostics(page);
      if (diag?.contextState === 'suspended') {
        return { label: 'stop-reload-same-module', ok: false, errors: ['context suspended after reload'], diag };
      }
      const advance = await waitForPositionAdvance(page);
      return assertPlaybackHealthy('stop-reload-same-module', diag, { advance });
    }));

    // 8. Share / deep-link auto-play
    results.push(await runScenario(browser, engine, 'share-url-autoplay', async (page) => {
      const shareUrl = `${BASE_URL}/?renderer=webgl2&mod=${encodeURIComponent(`${BASE_URL}${XM_URL}`)}`;
      await goto(page, engine, shareUrl, TIMEOUT);
      await waitForModuleLoaded(page, TIMEOUT);
      await ensurePlaying(page);
      const diag = await getDiagnostics(page);
      const advance = await waitForPositionAdvance(page);
      return assertPlaybackHealthy('share-url-autoplay', diag, { advance });
    }));

    // 9. No ended→seek loop (position should not repeatedly snap to 0)
    results.push(await runScenario(browser, engine, 'no-ended-seek-loop', async (page) => {
      await goto(page, engine, `${BASE_URL}/?renderer=webgl2`, TIMEOUT);
      await waitForModuleLoaded(page, TIMEOUT);
      await clickPlay(page);
      await waitForPlaying(page);
      const samples = [];
      for (let i = 0; i < 5; i++) {
        const d = await getDiagnostics(page);
        samples.push(d?.positionSeconds ?? 0);
        await new Promise((r) => setTimeout(r, 800));
      }
      const snapToZeroCount = samples.filter((p) => p < 0.01).length;
      if (snapToZeroCount >= 3) {
        return {
          label: 'no-ended-seek-loop',
          ok: false,
          errors: [`position snapped to 0 too often: ${samples.join(', ')}`],
          samples,
        };
      }
      return { label: 'no-ended-seek-loop', ok: true, errors: [], samples };
    }));
  } finally {
    await close();
  }

  const failures = results.filter((r) => r.status === 'FAIL' || r.ok === false);
  const report = {
    baseUrl: BASE_URL,
    timestamp: new Date().toISOString(),
    results,
    summary: {
      total: results.length,
      passed: results.length - failures.length,
      failed: failures.length,
    },
  };

  writeFileSync(join(OUTPUT_DIR, 'report.json'), JSON.stringify(report, null, 2));

  console.log('\n=== Audio Smoke Report ===');
  for (const r of results) {
    const status = r.status === 'FAIL' || r.ok === false ? 'FAIL' : 'PASS';
    console.log(`${status}  ${r.name}`);
    if (r.error) console.log(`       ${r.error}`);
    if (r.errors?.length) console.log(`       ${r.errors.join('; ')}`);
    if (r.diag) {
      console.log(
        `       engine=${r.diag.engine} ctx=${r.diag.contextState} initLib=${r.diag.initLibPostCount} pos=${r.diag.positionSeconds?.toFixed(2)}`,
      );
    }
  }
  console.log(`\n${report.summary.passed}/${report.summary.total} passed\n`);

  if (failures.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
