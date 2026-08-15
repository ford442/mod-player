#!/usr/bin/env node
/**
 * Audio product-flow smoke — real-browser AudioWorklet + libopenmpt session (#380).
 *
 * Usage (preview must be running):
 *   npm run build && npm run preview -- --port 4173 --host 127.0.0.1 &
 *   npm run smoke:audio          # headed (local)
 *   npm run smoke:audio:ci       # headless (CI)
 *
 * Env:
 *   BASE_URL              default http://localhost:4173
 *   OUTPUT_DIR            default ./artifacts/audio-smoke
 *   AUDIO_SMOKE_HEADLESS  1 = headless (CI sets this)
 *   TIMEOUT               page timeout ms (default 90000)
 *   AUDIO_SMOKE_ADVANCE_MS  counter sample window (default 2000)
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
import {
  ADVANCE_SAMPLE_MS,
  ADVANCE_POLL_MS,
  AUDIO_CHROME_ARGS,
  XM_FIXTURE_PATH,
  DEFAULT_MOD_PATH,
  buildAudioSmokeUrl,
  classifyAudioConsole,
} from './lib/audio-smoke-config.mjs';
import {
  countersAdvanced,
  checkAudioDiag,
  readPlaybackCountersInBrowser,
} from './lib/audio-smoke-counters.mjs';

const BASE_URL = (process.env.BASE_URL || 'http://localhost:4173').replace(/\/$/, '');
const OUTPUT_DIR = process.env.OUTPUT_DIR || join(process.cwd(), 'artifacts', 'audio-smoke');
const TIMEOUT = Number(process.env.TIMEOUT || 90000);
const HEADLESS = process.env.AUDIO_SMOKE_HEADLESS === '1' || process.env.CI === 'true';

mkdirSync(OUTPUT_DIR, { recursive: true });

/** @type {string[]} */
const consoleLines = [];

function attachConsoleCollector(page, engine) {
  const onConsole = (msg) => {
    const type = msg.type?.() ?? 'log';
    const text = msg.text?.() ?? String(msg);
    if (type === 'error' || type === 'warning' || type === 'warn') {
      consoleLines.push(`[${type}] ${text}`);
    }
    // Worklet/protocol failures sometimes log at default level.
    if (/\[PLAY\]|\[AudioDiag\]|\[Worklet/i.test(text)) {
      consoleLines.push(`[${type}] ${text}`);
    }
  };

  if (engine === 'playwright') {
    page.on('console', onConsole);
  } else {
    page.on('console', (msg) => onConsole(msg));
  }
}

async function waitForDefaultModule(page) {
  await waitForFunction(
    page,
    () => window.__TEST_HOOKS__?.isModuleLoaded?.() === true,
    { timeout: TIMEOUT },
  );
  const engine = await evaluate(page, () => window.__TEST_HOOKS__?.getAudioEngine?.() ?? null);
  if (engine && engine !== 'worklet') {
    throw new Error(`expected JS worklet engine (worklet), got ${engine}`);
  }
}

async function readCounters(page) {
  return evaluate(page, readPlaybackCountersInBrowser);
}

async function clickPlay(page, engine) {
  if (engine === 'playwright') {
    const playBtn = page.getByRole('button', { name: /play/i }).first();
    await playBtn.click({ timeout: 10000 });
  } else {
    await evaluate(page, () => {
      const buttons = [...document.querySelectorAll('button')];
      const play = buttons.find((b) => /play/i.test(b.textContent ?? ''));
      play?.click();
    });
  }
  // Worklet must fetch ~5 MB wasm2js glue on first play — allow full TIMEOUT.
  await waitForFunction(
    page,
    () => window.__TEST_HOOKS__?.getIsPlaying?.() === true,
    { timeout: TIMEOUT },
  );
}

async function clickStop(page, engine) {
  if (engine === 'playwright') {
    const stopBtn = page.getByRole('button', { name: /stop/i }).first();
    await stopBtn.click({ timeout: 10000 });
  } else {
    await evaluate(page, () => {
      const buttons = [...document.querySelectorAll('button')];
      const stop = buttons.find((b) => /stop/i.test(b.textContent ?? ''));
      stop?.click();
    });
  }
  await new Promise((r) => setTimeout(r, 400));
}

async function assertCountersAdvance(page, phaseLabel, { wrapBaseline = null } = {}) {
  const before = await readCounters(page);
  const baseWrap = wrapBaseline ?? (before.audioDiag?.wrapOverruns ?? 0);
  const start = Date.now();
  const warmupEnd = start + 500; // 500ms warmup period
  // To ensure steady state, we sample the full window
  const deadline = start + ADVANCE_SAMPLE_MS;
  
  let current = before;
  let verdict = countersAdvanced(before, current);
  let steadyStateWrapBaseline = null;
  
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((r) => setTimeout(r, Math.min(ADVANCE_POLL_MS, remaining)));
    current = await readCounters(page);
    
    if (!verdict.advanced) {
      verdict = countersAdvanced(before, current);
    }
    
    // Check steady state if warmup is over
    if (Date.now() >= warmupEnd) {
      if (steadyStateWrapBaseline === null) {
        steadyStateWrapBaseline = current.audioDiag?.wrapOverruns ?? 0;
      } else {
        const wrapDeltaSteady = (current.audioDiag?.wrapOverruns ?? 0) - steadyStateWrapBaseline;
        if (wrapDeltaSteady > 0) {
          throw new Error(`${phaseLabel}: steady-state wrapOverruns +${wrapDeltaSteady} after warmup (steadyBaseline=${steadyStateWrapBaseline}, now=${current.audioDiag?.wrapOverruns ?? 0})`);
        }
      }
    }
  }

  if (!verdict.advanced) {
    throw new Error(`${phaseLabel}: counters did not advance within ${ADVANCE_SAMPLE_MS}ms — ${verdict.reason}`);
  }

  // Bound the total warmup transient
  const totalWrapDelta = (current.audioDiag?.wrapOverruns ?? 0) - baseWrap;
  if (totalWrapDelta > 1) { // Tolerate up to 1 warmup transient overrun
    throw new Error(
      `${phaseLabel}: excessive warmup wrapOverruns +${totalWrapDelta} during playback window (baseline=${baseWrap}, now=${current.audioDiag?.wrapOverruns ?? 0}, max allowed 1)`,
    );
  }

  return { before, after: current, verdict, wrapBaseline: baseWrap, wrapDelta: totalWrapDelta };
}

async function loadXmMidPlayback(page, baseUrl) {
  const xmUrl = `${baseUrl}${XM_FIXTURE_PATH}`;
  await evaluate(page, async (url) => {
    await window.__TEST_HOOKS__?.loadModuleFromUrl(url);
  }, xmUrl);
  await waitForFunction(
    page,
    () => window.__TEST_HOOKS__?.isModuleLoaded?.() === true,
    { timeout: TIMEOUT },
  );
  await waitForFunction(
    page,
    () => window.__TEST_HOOKS__?.getIsPlaying?.() === true,
    { timeout: 15000 },
  ).catch(() => {
    /* module reload may pause; play click happens in caller if needed */
  });
}

function auditConsole(phaseLines) {
  const { failures } = classifyAudioConsole(phaseLines);
  if (failures.length) {
    throw new Error(`console tripwire:\n${failures.join('\n')}`);
  }
}

async function main() {
  const appUrl = buildAudioSmokeUrl(BASE_URL);
  console.log('Audio product-flow smoke (#380)');
  console.log(`  base=${BASE_URL}`);
  console.log(`  url=${appUrl}`);
  console.log(`  defaultMod=${DEFAULT_MOD_PATH} xm=${XM_FIXTURE_PATH}`);
  console.log(`  headless=${HEADLESS}`);
  console.log(`  advanceWindow=${ADVANCE_SAMPLE_MS}ms`);

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    appUrl,
    defaultModule: DEFAULT_MOD_PATH,
    xmFixture: XM_FIXTURE_PATH,
    headless: HEADLESS,
    phases: [],
    status: 'PENDING',
    errors: [],
  };

  const { browser, engine, close } = await launchBrowser({
    headless: HEADLESS,
    args: HEADLESS ? AUDIO_CHROME_ARGS : AUDIO_CHROME_ARGS.filter((a) => a !== '--headless=new'),
  });

  const phaseConsoleStart = () => consoleLines.length;

  try {
    const { page, context } = await openPage(browser, engine);
    attachConsoleCollector(page, engine);

    try {
      await goto(page, engine, appUrl, TIMEOUT);
      report.phases.push({ id: 'boot', status: 'PASS' });

      const phaseStart = phaseConsoleStart();
      await waitForDefaultModule(page);
      auditConsole(consoleLines.slice(phaseStart));
      report.phases.push({ id: 'default-mod-load', status: 'PASS', module: DEFAULT_MOD_PATH });

      await clickPlay(page, engine);
      const playAdvance = await assertCountersAdvance(page, 'play');
      auditConsole(consoleLines.slice(phaseStart));
      report.phases.push({
        id: 'play-advance',
        status: 'PASS',
        ...playAdvance,
      });

      const xmPhaseStart = phaseConsoleStart();
      await loadXmMidPlayback(page, BASE_URL);
      await new Promise((r) => setTimeout(r, 800));
      let settled = await readCounters(page);
      if (!settled.isPlaying) {
        await clickPlay(page, engine);
        settled = await readCounters(page);
      }
      const wrapBaseline = settled.audioDiag?.wrapOverruns ?? 0;
      const xmAdvance = await assertCountersAdvance(page, 'xm-mid-playback', { wrapBaseline });
      auditConsole(consoleLines.slice(xmPhaseStart));
      report.phases.push({
        id: 'xm-mid-playback',
        status: 'PASS',
        fixture: XM_FIXTURE_PATH,
        wrapBaseline,
        ...xmAdvance,
      });

      const stopPhaseStart = phaseConsoleStart();
      const stopWrapBaseline = (await readCounters(page)).audioDiag?.wrapOverruns ?? 0;
      await clickStop(page, engine);
      await clickPlay(page, engine);
      const replayAdvance = await assertCountersAdvance(page, 'stop-play', { wrapBaseline: stopWrapBaseline });
      auditConsole(consoleLines.slice(stopPhaseStart));
      report.phases.push({
        id: 'stop-play',
        status: 'PASS',
        wrapBaseline: stopWrapBaseline,
        ...replayAdvance,
      });

      const finalDiag = await evaluate(page, () => window.__AUDIO_DIAG__ ?? null);
      report.finalAudioDiag = finalDiag;
      report.status = 'PASS';
    } catch (err) {
      report.status = 'FAIL';
      report.errors.push(err?.message ?? String(err));
      console.error('\n--- CONSOLE LINES ---');
      console.error(consoleLines.join('\n'));
      console.error('---------------------\n');
      throw err;
    } finally {
      if (context) await context.close();
      else await page.close();
    }
  } finally {
    await close();
  }

  const reportPath = join(OUTPUT_DIR, 'report.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nReport: ${reportPath}`);
  console.log(`Status: ${report.status}`);
  if (report.status !== 'PASS') process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
