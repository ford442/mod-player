#!/usr/bin/env node
/**
 * #462 acceptance — the opt-in WebGL2 visualizer fallback is never silent.
 *
 *   BASE_URL=http://localhost:5173 node scripts/webgl2-optin-acceptance.mjs
 *
 * Scenario 1  `?webgl2=1`, Chromium WITHOUT --enable-unsafe-webgpu (requestAdapter() → null)
 *             → WebGL2 renders, badge present, no failure card, exactly one activation warn,
 *               readPixels() non-uniform, WebGPU never attempted.
 * Scenario 2  no param, same browser
 *             → failure card + "Use WebGL2 visualizer" button, no WebGL2 context on the pattern
 *               canvas. Click: badge + one warn (reason = the WebGPU status), same <canvas> node,
 *               same AudioContext, no further requestAdapter(), survives a shader switch
 *               (PerformanceStage remounts PatternDisplay), nothing persisted.
 * Scenario 3  no param, WITH --enable-unsafe-webgpu
 *             → no badge, no warn, WebGPU is the reported backend (data-renderer="webgpu";
 *               `EXPECTED_SKIP` for the "ready" check when this host's WebGPU cannot present).
 *
 * The app auto-loads `public/4-mat_madness.mod`; each scenario waits for it.
 * Not wired into package.json (off limits for the #462 slice) — run it directly.
 * Env: BASE_URL (default http://localhost:5173), SCENARIOS (default "1,2,3"), TIMEOUT_MS (default 90000).
 */
import { DEFAULT_CHROME_ARGS, launchBrowser, openPage, waitForFunction, evaluate } from './lib/browser-launch.mjs';

const BASE_URL = (process.env.BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const TIMEOUT = Number(process.env.TIMEOUT_MS ?? 90000);
const SCENARIOS = new Set((process.env.SCENARIOS ?? '1,2,3').split(',').map((s) => s.trim()));

const NO_WEBGPU_ARGS = DEFAULT_CHROME_ARGS.filter(
  (a) => !/^--(enable-unsafe-webgpu|use-angle=vulkan|enable-features=Vulkan|disable-vulkan-surface)$/.test(a),
);

const PATTERN_CANVAS = 'canvas[data-shader-preview-source="true"]';
const ACTIVATION_WARN = /WebGL2 fallback active/;
const GPU_ERROR = /webgpu|webgl|shader/i;

let failures = 0;
function check(label, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${detail}` : ''}`);
}
function skip(label, why) {
  console.log(`  EXPECTED_SKIP  ${label} — ${why}`);
}

/** Boot one page. `args` decides whether the browser has WebGPU. */
async function boot(label, args, query) {
  console.log(`\n[${label}] ${BASE_URL}/${query} (${args.includes('--enable-unsafe-webgpu') ? 'WebGPU flag ON' : 'WebGPU flag OFF'})`);
  const session = await launchBrowser({ args });
  const { page } = await openPage(session.browser, session.engine);
  const messages = [];
  page.on('console', (m) => messages.push({ type: m.type(), text: m.text() }));
  page.on('pageerror', (e) => messages.push({ type: 'pageerror', text: String(e?.message ?? e) }));

  const init = () => {
    // Count what the page does, before any app code runs.
    window.__webgl2PatternContexts = 0;
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      if (type === 'webgl2' && this.dataset && this.dataset.shaderPreviewSource === 'true') {
        window.__webgl2PatternContexts += 1;
      }
      return origGetContext.call(this, type, ...rest);
    };
    window.__audioContextCount = 0;
    const OrigAudioContext = window.AudioContext;
    if (OrigAudioContext) {
      window.AudioContext = class extends OrigAudioContext {
        constructor(...a) {
          super(...a);
          window.__audioContextCount += 1;
        }
      };
    }
    window.__requestAdapterCalls = 0;
    const gpu = navigator.gpu;
    if (gpu && typeof gpu.requestAdapter === 'function') {
      const origRequestAdapter = gpu.requestAdapter.bind(gpu);
      gpu.requestAdapter = (...a) => {
        window.__requestAdapterCalls += 1;
        return origRequestAdapter(...a);
      };
    }
  };
  if (session.engine === 'playwright') await page.addInitScript(init);
  else await page.evaluateOnNewDocument(init);

  await page.goto(`${BASE_URL}/${query}`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  await waitForFunction(page, () => window.__TEST_HOOKS__?.isModuleLoaded?.() === true, { timeout: TIMEOUT });
  return { page, messages, close: session.close, engine: session.engine };
}

/** Vite's dev error overlay (an unrelated dev-only native-engine import) intercepts pointer events. */
async function dismissViteOverlay(page) {
  await evaluate(page, () => document.querySelectorAll('vite-error-overlay').forEach((e) => e.remove()));
}

const has = (page, selector) => evaluate(page, (s) => !!document.querySelector(s), selector);
const warnCount = (messages) => messages.filter((m) => m.type === 'warning' && ACTIVATION_WARN.test(m.text)).length;
const gpuErrors = (messages) =>
  messages.filter((m) => (m.type === 'error' || m.type === 'pageerror') && GPU_ERROR.test(m.text));

/** Distinct RGB values (capped) in the live canvas — 1 means a blank/uniform frame. */
async function distinctColours(page) {
  return evaluate(page, () => {
    const r = window.currentPatternRenderer;
    const buf = r?.readPixels?.();
    if (!buf) return -1;
    const seen = new Set();
    for (let i = 0; i < buf.length && seen.size < 64; i += 4) seen.add((buf[i] << 16) | (buf[i + 1] << 8) | buf[i + 2]);
    return seen.size;
  });
}

async function scenario1() {
  const { page, messages, close } = await boot('1 opt-in via ?webgl2=1', NO_WEBGPU_ARGS, '?webgl2=1');
  try {
    await waitForFunction(page, () => window.currentPatternRenderer?.backend === 'webgl2', { timeout: TIMEOUT });
    await evaluate(page, () => window.__TEST_HOOKS__?.startPlayback?.());
    await page.waitForTimeout?.(2000);
    check('no WebGPU failure card', !(await has(page, '[data-webgpu-viz-hard-fail]')));
    check('WebGL2 fallback badge present', await has(page, '[data-webgl2-fallback-badge]'));
    const badgeText = await evaluate(page, () => document.querySelector('[data-webgl2-fallback-badge]')?.textContent?.trim());
    check('badge text', badgeText === 'WebGL2 fallback — WebGPU not in use', String(badgeText));
    check('no WebGL2 init failure card', !(await has(page, '[data-webgl2-init-failed]')));
    check('pattern canvas reports data-renderer="webgl2"',
      (await evaluate(page, (s) => document.querySelector(s)?.dataset.renderer, PATTERN_CANVAS)) === 'webgl2');
    check('exactly one activation console.warn', warnCount(messages) === 1, `saw ${warnCount(messages)}`);
    check('warn reason is url-optin', messages.some((m) => /reason: url-optin\)/.test(m.text)));
    const colours = await distinctColours(page);
    check('readPixels() is non-uniform', colours > 1, `distinct colours = ${colours}`);
    check('WebGPU was never attempted', await evaluate(page, () => window.__WEBGPU_PROBE__ === undefined && window.__requestAdapterCalls === 0));
    check('no console errors mentioning WebGPU/WebGL/shader', gpuErrors(messages).length === 0,
      gpuErrors(messages).map((m) => m.text.slice(0, 120)).join(' | '));
  } finally {
    await close();
  }
}

async function scenario2() {
  const { page, messages, close } = await boot('2 no param → failure card → button', NO_WEBGPU_ARGS, '');
  try {
    await waitForFunction(page, () => !!document.querySelector('[data-webgpu-viz-hard-fail]'), { timeout: TIMEOUT });
    check('failure card shown', true);
    check('"Use WebGL2 visualizer" button shown', await has(page, '[data-webgl2-optin-button]'));
    check('no badge before opt-in', !(await has(page, '[data-webgl2-fallback-badge]')));
    check('no activation warn before opt-in', warnCount(messages) === 0);
    check('pattern canvas is still data-renderer="webgpu"',
      (await evaluate(page, (s) => document.querySelector(s)?.dataset.renderer, PATTERN_CANVAS)) === 'webgpu');
    check('no WebGL2 context created on the pattern canvas',
      (await evaluate(page, () => window.__webgl2PatternContexts)) === 0);

    const before = await evaluate(page, (s) => {
      window.__canvasTag = document.querySelector(s);
      return { adapterCalls: window.__requestAdapterCalls, audioContexts: window.__audioContextCount };
    }, PATTERN_CANVAS);

    await dismissViteOverlay(page);
    await page.click('[data-webgl2-optin-button]');
    await waitForFunction(page, () => !!document.querySelector('[data-webgl2-fallback-badge]'), { timeout: TIMEOUT });
    await waitForFunction(page, () => window.currentPatternRenderer?.backend === 'webgl2', { timeout: TIMEOUT });
    await page.waitForTimeout?.(1500);

    check('failure card gone after opt-in', !(await has(page, '[data-webgpu-viz-hard-fail]')));
    check('badge present after opt-in', await has(page, '[data-webgl2-fallback-badge]'));
    check('exactly one activation console.warn', warnCount(messages) === 1, `saw ${warnCount(messages)}`);
    check('warn reason is the WebGPU hard-fail status (no-adapter)', messages.some((m) => /reason: no-adapter\)/.test(m.text)),
      messages.filter((m) => ACTIVATION_WARN.test(m.text)).map((m) => m.text).join(' | '));
    check('same <canvas> node (no remount)',
      await evaluate(page, (s) => document.querySelector(s) === window.__canvasTag, PATTERN_CANVAS));
    const after = await evaluate(page, () => ({ adapterCalls: window.__requestAdapterCalls, audioContexts: window.__audioContextCount }));
    check('button did not call requestAdapter()/requestDevice() again', after.adapterCalls === before.adapterCalls,
      `${before.adapterCalls} → ${after.adapterCalls}`);
    check('same AudioContext (audio graph not remounted)', after.audioContexts === before.audioContexts && after.audioContexts <= 1,
      `${before.audioContexts} → ${after.audioContexts}`);
    const colours = await distinctColours(page);
    check('readPixels() is non-uniform', colours > 1, `distinct colours = ${colours}`);
    check('opt-in is not persisted',
      await evaluate(page, () => localStorage.getItem('xasm1_pattern_renderer') === null && window.DEBUG_RENDERER === undefined));

    // PerformanceStage keys PatternDisplay by shader: a remount must keep WebGL2 and not retry WebGPU.
    const nextShader = await evaluate(page, () => {
      const current = window.__TEST_HOOKS__?.getShaderFile?.();
      const next = current === 'patternv0.50.wgsl' ? 'patternv0.51.wgsl' : 'patternv0.50.wgsl';
      window.__TEST_HOOKS__?.selectShader?.(next);
      return next;
    });
    await page.waitForTimeout?.(2500);
    check(`still WebGL2 after switching shader to ${nextShader}`,
      (await evaluate(page, () => window.currentPatternRenderer?.backend)) === 'webgl2'
      && (await has(page, '[data-webgl2-fallback-badge]'))
      && !(await has(page, '[data-webgpu-viz-hard-fail]')));
    check('shader switch did not retry WebGPU', (await evaluate(page, () => window.__requestAdapterCalls)) === before.adapterCalls);
    check('still exactly one activation warn after remount', warnCount(messages) === 1, `saw ${warnCount(messages)}`);
    const wgErrors = gpuErrors(messages).filter((m) => !/WebGPU (probe|device init)|requestAdapter|HARD FAIL/i.test(m.text));
    check('no unexpected console errors mentioning WebGPU/WebGL/shader', wgErrors.length === 0,
      wgErrors.map((m) => m.text.slice(0, 120)).join(' | '));
  } finally {
    await close();
  }
}

async function scenario3() {
  const { page, messages, close } = await boot('3 WebGPU-capable flags, no param', DEFAULT_CHROME_ARGS, '');
  try {
    // Either the GPU session comes up, or this host hard-fails (headless/cloud) — wait for one.
    await waitForFunction(
      page,
      () => window.currentPatternRenderer?.backend === 'webgpu' || !!document.querySelector('[data-webgpu-viz-hard-fail]'),
      { timeout: TIMEOUT },
    );
    await page.waitForTimeout?.(1500);
    const hardFail = await has(page, '[data-webgpu-viz-hard-fail]');
    check('no WebGL2 fallback badge', !(await has(page, '[data-webgl2-fallback-badge]')));
    check('no activation console.warn', warnCount(messages) === 0, `saw ${warnCount(messages)}`);
    check('pattern canvas reports data-renderer="webgpu"',
      (await evaluate(page, (s) => document.querySelector(s)?.dataset.renderer, PATTERN_CANVAS)) === 'webgpu');
    check('no WebGL2 context created on the pattern canvas',
      (await evaluate(page, () => window.__webgl2PatternContexts)) === 0);
    if (hardFail) {
      const probe = await evaluate(page, () => window.__WEBGPU_PROBE__ ? `${window.__WEBGPU_PROBE__.stage}: ${window.__WEBGPU_PROBE__.error}` : 'n/a');
      skip('WebGPU backend ready', `this host's WebGPU cannot initialise (${probe}); failure card + opt-in button shown, WebGL2 not started`);
      check('opt-in button offered (not auto-started)', await has(page, '[data-webgl2-optin-button]'));
    } else {
      check('WebGPU is the reported backend',
        (await evaluate(page, () => window.currentPatternRenderer?.backend)) === 'webgpu');
    }
  } finally {
    await close();
  }
}

const runners = { 1: scenario1, 2: scenario2, 3: scenario3 };
for (const id of ['1', '2', '3']) {
  if (!SCENARIOS.has(id)) continue;
  try {
    await runners[id]();
  } catch (err) {
    failures += 1;
    console.log(`  FAIL  scenario ${id} threw — ${err?.message ?? err}`);
  }
}

console.log(failures === 0 ? '\nwebgl2-optin-acceptance: OK' : `\nwebgl2-optin-acceptance: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
