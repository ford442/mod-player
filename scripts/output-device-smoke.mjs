#!/usr/bin/env node
/**
 * Output-device smoke (#492 Phase 3) — an output-device switch works without recreating the AudioContext.
 *
 * Headless Chromium with `--use-fake-device-for-media-stream` and microphone permission lists fake
 * outputs ("Fake Audio Output 1/2") that `AudioContext.setSinkId()` really switches to. While the
 * default module plays, the run:
 *   1. switches to a fake output through the engine (test hook) and asserts: same AudioContext object
 *      (serial), still one construction (pitfall 12), transport still 'playing', the master analyser
 *      still carries signal, the playhead still advances, the snapshot names the device;
 *   2. asks for a device that does not exist: refused, previous device kept, `sinkError` set, still playing;
 *   3. switches through the picker <select> (the UI path), then back to the default output;
 *   4. reloads: the saved device is applied to the new session's context on its first play.
 * Without fake outputs (another browser build) it falls back to the default ↔ default round trip and
 * the refusal, and says so.
 *
 * Usage (preview must be running):
 *   npm run build && npx vite preview --port 4393 --strictPort &
 *   BASE_URL=http://localhost:4393 npm run smoke:output-device
 *
 * Env: BASE_URL (default http://localhost:4173), OUTPUT_DIR (default ./artifacts/output-device-smoke),
 *      TIMEOUT (ms, default 90000).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchBrowser, goto, waitForFunction, evaluate } from './lib/browser-launch.mjs';
import { AUDIO_CHROME_ARGS, buildAudioSmokeUrl } from './lib/audio-smoke-config.mjs';

const BASE_URL = (process.env.BASE_URL || 'http://localhost:4173').replace(/\/$/, '');
const OUTPUT_DIR = process.env.OUTPUT_DIR || join(process.cwd(), 'artifacts', 'output-device-smoke');
const TIMEOUT = Number(process.env.TIMEOUT || 90000);
/** Signal floor for "audio keeps playing" — the default module is far above this. */
const RMS_FLOOR = 1e-3;

mkdirSync(OUTPUT_DIR, { recursive: true });

const report = { baseUrl: BASE_URL, steps: [], failures: [], notes: [] };
const fail = (msg) => { report.failures.push(msg); console.error(`  ✗ ${msg}`); };
const pass = (msg) => console.log(`  ✓ ${msg}`);
const check = (cond, msg) => (cond ? pass(msg) : fail(msg));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Everything a step asserts on, read in one evaluate. */
function readState(page) {
  return evaluate(page, () => {
    const h = window.__TEST_HOOKS__;
    return {
      output: h.getOutputDevice(),
      serial: h.getAudioContextSerial(),
      constructions: h.getAudioContextConstructions(),
      transport: h.getTransportState(),
      contextState: h.getAudioContextState(),
      row: h.getPlaybackRowFraction(),
      rms: h.getMasterRms(),
    };
  });
}

/** Max analyser RMS and playhead travel over `ms`. */
async function sampleAudio(page, ms = 1200) {
  const start = await readState(page);
  let maxRms = 0;
  let moved = false;
  const until = Date.now() + ms;
  while (Date.now() < until) {
    await sleep(100);
    const s = await readState(page);
    maxRms = Math.max(maxRms, s.rms ?? 0);
    if (Math.abs(s.row - start.row) > 0.25) moved = true;
  }
  return { maxRms, moved };
}

async function assertStillPlaying(page, label, baseline) {
  const s = await readState(page);
  check(s.serial === baseline.serial, `${label}: same AudioContext object (serial ${s.serial})`);
  check(s.constructions === 1, `${label}: one AudioContext constructed this session (${s.constructions})`);
  check(s.transport === 'playing', `${label}: transport still playing (${s.transport})`);
  check(s.contextState === 'running', `${label}: context running (${s.contextState})`);
  const audio = await sampleAudio(page);
  check(audio.maxRms > RMS_FLOOR, `${label}: master analyser carries signal (rms ${audio.maxRms.toFixed(4)})`);
  check(audio.moved, `${label}: playhead advances`);
  report.steps.push({ label, state: s, audio });
  return s;
}

async function startDefaultModule(page) {
  await waitForFunction(page, () => window.__TEST_HOOKS__?.isModuleLoaded?.() === true, { timeout: TIMEOUT });
  await evaluate(page, () => window.__TEST_HOOKS__.startPlayback());
  await waitForFunction(page, () => window.__TEST_HOOKS__?.getIsPlaying?.() === true, { timeout: TIMEOUT });
  await sleep(800);
}

async function main() {
  console.log(`output-device smoke — ${BASE_URL}`);
  const { browser, engine, close } = await launchBrowser({
    args: [...AUDIO_CHROME_ARGS, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  if (engine !== 'playwright') {
    await close();
    throw new Error('needs Playwright (per-context microphone permission reveals the fake outputs)');
  }
  try {
    const context = await browser.newContext({ permissions: ['microphone'], viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    page.on('pageerror', (err) => fail(`page error: ${err.message}`));
    const url = buildAudioSmokeUrl(BASE_URL, { audioDiag: false });
    await goto(page, engine, url, TIMEOUT);
    await evaluate(page, () => localStorage.removeItem('xasm1_audio_output_device'));

    const supported = await evaluate(page, () => window.__TEST_HOOKS__?.getOutputDevice?.().supported ?? false);
    check(supported, 'AudioContext.setSinkId is available (picker shown)');
    if (!supported) return;

    await startDefaultModule(page);
    const baseline = await readState(page);
    check(baseline.output.deviceId === '', `plays on the default output first (${JSON.stringify(baseline.output.deviceId)})`);
    await assertStillPlaying(page, 'before any switch', baseline);

    const outputs = await evaluate(page, () => window.__TEST_HOOKS__.listOutputDevices());
    report.outputs = outputs;
    console.log(`  outputs: ${outputs.devices.map((d) => d.label).join(', ') || '(none)'}${outputs.hidden ? ' (+hidden)' : ''}`);
    const target = outputs.devices[0];

    if (target) {
      // 1. Engine path: a real switch to another (fake) device.
      const ok = await evaluate(page, ([id, label]) => window.__TEST_HOOKS__.setOutputDevice(id, label), [target.deviceId, target.label]);
      check(ok === true, `setOutputDevice("${target.label}") resolved true`);
      const s = await assertStillPlaying(page, `after switching to "${target.label}"`, baseline);
      check(s.output.deviceId === target.deviceId && s.output.label === target.label && s.output.error === null,
        `snapshot names the device (${s.output.label})`);
    } else {
      report.notes.push('no non-default outputs listed: only default ↔ default round trip is exercised');
      const ok = await evaluate(page, () => window.__TEST_HOOKS__.setOutputDevice(''));
      check(ok === true, 'setOutputDevice("") (same sink) resolved true');
      await assertStillPlaying(page, 'after the default ↔ default round trip', baseline);
    }

    // 2. A device that does not exist: refused, previous device kept.
    const before = (await readState(page)).output.deviceId;
    const refused = await evaluate(page, () => window.__TEST_HOOKS__.setOutputDevice('no-such-device-id', 'Ghost DAC'));
    check(refused === false, 'unknown device refused');
    const afterRefusal = await assertStillPlaying(page, 'after the refused switch', baseline);
    check(afterRefusal.output.deviceId === before, `previous device kept (${JSON.stringify(afterRefusal.output.deviceId)})`);
    check(/Ghost DAC/.test(afterRefusal.output.error ?? ''), `sinkError says why ("${afterRefusal.output.error}")`);

    // 3. UI path: the picker <select>.
    const select = page.locator('[data-testid="output-device-picker"] select');
    check(await select.count() === 1, 'output-device picker rendered');
    if (target && outputs.devices[1]) {
      const second = outputs.devices[1];
      await select.selectOption(second.deviceId);
      await waitForFunction(page, (id) => window.__TEST_HOOKS__.getOutputDevice().deviceId === id, { timeout: 10000 }).catch(() => {});
      const s = await assertStillPlaying(page, `after picking "${second.label}" in the picker`, baseline);
      check(s.output.deviceId === second.deviceId, 'the picker switched the engine');
    }
    await select.selectOption('');
    await waitForFunction(page, () => window.__TEST_HOOKS__.getOutputDevice().deviceId === '', { timeout: 10000 }).catch(() => {});
    const back = await assertStillPlaying(page, 'after picking the default output', baseline);
    check(back.output.deviceId === '' && back.output.error === null, 'back on the default output, notice cleared');

    // 4. The choice persists: a reload opens the new session's context on it.
    if (target) {
      await evaluate(page, ([id, label]) => window.__TEST_HOOKS__.setOutputDevice(id, label), [target.deviceId, target.label]);
      await page.reload({ waitUntil: 'networkidle', timeout: TIMEOUT });
      const idle = await evaluate(page, () => window.__TEST_HOOKS__.getOutputDevice());
      check(idle.deviceId === target.deviceId, `after reload the saved device is the one the context will open on (${idle.label})`);
      await startDefaultModule(page);
      const fresh = await readState(page);
      check(fresh.output.deviceId === target.deviceId && fresh.output.error === null, 'the new context plays on the saved device');
      await assertStillPlaying(page, 'after reload on the saved device', fresh);
      await evaluate(page, () => window.__TEST_HOOKS__.setOutputDevice(''));
    }
  } finally {
    await close();
    writeFileSync(join(OUTPUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  }
}

main()
  .then(() => {
    if (report.failures.length) {
      console.error(`\noutput-device smoke FAILED (${report.failures.length})`);
      process.exit(1);
    }
    console.log('\noutput-device smoke passed');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
