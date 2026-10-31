#!/usr/bin/env node
/**
 * #492 acceptance — WebGL2 context loss → restore recovers, for both WebGL2 surfaces.
 *
 *   npm run build && npm run preview -- --port 4395 --strictPort
 *   BASE_URL=http://localhost:4395 npm run smoke:webgl2-context
 *
 * Scenario 1  opt-in WebGL2 pattern renderer (`?webgl2=1`, Chromium without WebGPU)
 * Scenario 2  hybrid WebGL overlay over the WebGPU canvas (shader v0.40, `?lite=0`)
 *
 * Each scenario: frames are drawing → `WEBGL_lose_context.loseContext()` → the app warns once and
 * issues no draw calls while lost → `restoreContext()` → draw calls resume, the canvas has real
 * pixels again, no WebGL INVALID_* errors → a second lose/restore cycle recovers too.
 *
 * Black-box: an init script records the contexts the app creates (so the probe never creates one
 * itself) and counts their draw calls. Pixels: scenario 1 reads through
 * `window.currentPatternRenderer.readPixels()` (preserveDrawingBuffer is on under automation —
 * also asserted); scenario 2 reads right after the overlay's own draw, inside the same task.
 *
 * Env: BASE_URL (default http://localhost:4173), SCENARIOS (default "1,2"), TIMEOUT_MS (default 90000).
 */
import { DEFAULT_CHROME_ARGS, launchBrowser, openPage, waitForFunction, evaluate } from './lib/browser-launch.mjs';

const BASE_URL = (process.env.BASE_URL ?? 'http://localhost:4173').replace(/\/$/, '');
const TIMEOUT = Number(process.env.TIMEOUT_MS ?? 90000);
const SCENARIOS = new Set((process.env.SCENARIOS ?? '1,2').split(',').map((s) => s.trim()));
/** While lost, the render loop keeps ticking (rAF) — this long with zero draw calls = paused. */
const LOST_WINDOW_MS = 1000;
/** Draw calls after `restoreContext()` that count as "resumed", and how long to wait for them. */
const RESUMED_DRAWS = 3;
const RESUME_TIMEOUT_MS = 15000;

const NO_WEBGPU_ARGS = DEFAULT_CHROME_ARGS.filter(
  (a) => !/^--(enable-unsafe-webgpu|use-angle=vulkan|enable-features=Vulkan|disable-vulkan-surface)$/.test(a),
);

const PATTERN_CANVAS = 'canvas[data-shader-preview-source="true"]';
const OVERLAY_CANVAS = 'canvas[data-overlay-canvas="true"]';
const HYBRID_SHADER = 'patternv0.40.wgsl';
/** Chromium reports GL errors as console warnings ("WebGL: INVALID_OPERATION: …", "GL_INVALID_…"). */
const GL_ERROR = /INVALID_(OPERATION|VALUE|ENUM|FRAMEBUFFER_OPERATION)|GL_OUT_OF_MEMORY|GL error/;

let failures = 0;
function check(label, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

/** Runs before any app code: remember the WebGL2 context of each app canvas, count its draws. */
function installContextProbe() {
  window.__glProbes = {};
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const ctx = orig.call(this, type, ...rest);
    if (type !== 'webgl2' || !ctx || !this.dataset) return ctx;
    const kind = this.dataset.overlayCanvas === 'true' ? 'overlay'
      : this.dataset.shaderPreviewSource === 'true' ? 'pattern' : null;
    if (!kind || window.__glProbes[kind]?.gl === ctx) return ctx;
    const probe = { gl: ctx, draws: 0, ext: ctx.getExtension('WEBGL_lose_context'), sampleAfterDraw: false, lit: -1 };
    for (const name of ['drawArrays', 'drawArraysInstanced']) {
      const draw = ctx[name].bind(ctx);
      ctx[name] = (...args) => {
        probe.draws += 1;
        const result = draw(...args);
        if (probe.sampleAfterDraw) {
          // Same task as the draw: the drawing buffer is still intact without preserveDrawingBuffer.
          probe.sampleAfterDraw = false;
          const w = ctx.drawingBufferWidth;
          const h = ctx.drawingBufferHeight;
          const px = new Uint8Array(w * h * 4);
          ctx.readPixels(0, 0, w, h, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
          let lit = 0;
          for (let i = 3; i < px.length; i += 4) if (px[i] > 0 && (px[i - 3] | px[i - 2] | px[i - 1]) > 0) lit += 1;
          probe.lit = lit;
        }
        return result;
      };
    }
    window.__glProbes[kind] = probe;
    return ctx;
  };
}

async function boot(label, args, query, seed = null) {
  console.log(`\n[${label}] ${BASE_URL}/${query}`);
  const session = await launchBrowser({ args });
  const { page } = await openPage(session.browser, session.engine);
  const messages = [];
  page.on('console', (m) => messages.push({ type: m.type(), text: m.text(), at: Date.now() }));
  page.on('pageerror', (e) => messages.push({ type: 'pageerror', text: String(e?.message ?? e), at: Date.now() }));
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  const init = (s) => {
    if (s) for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  };
  if (session.engine === 'playwright') {
    await page.addInitScript(installContextProbe);
    await page.addInitScript(init, seed);
  } else {
    await page.evaluateOnNewDocument(installContextProbe);
    await page.evaluateOnNewDocument(init, seed);
  }
  try {
    await page.goto(`${BASE_URL}/${query}`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await waitForFunction(page, () => window.__TEST_HOOKS__?.isModuleLoaded?.() === true, { timeout: TIMEOUT });
  } catch (err) {
    await session.close();
    throw new Error(`boot: module never loaded — ${err?.message ?? err}`);
  }
  return { page, messages, requests, close: session.close };
}

/** The opt-in renderer's lazy chunk (#492) — only a WebGL2 session may fetch it. */
const fetchedWebGL2Chunk = (requests) => requests.some((u) => /\/assets\/WebGL2PatternRenderer-[^/]+\.js/.test(u));

/** `waitForFunction` with an argument (Playwright: (fn, arg, opts); puppeteer: (fn, opts, arg)). */
async function waitWithArg(page, fn, arg, timeout) {
  if (typeof page.context === 'function') await page.waitForFunction(fn, arg, { timeout });
  else await page.waitForFunction(fn, { timeout }, arg);
}

const draws = (page, kind) => evaluate(page, (k) => window.__glProbes[k]?.draws ?? -1, kind);
const lost = (page, kind) => evaluate(page, (k) => window.__glProbes[k]?.gl.isContextLost() ?? null, kind);
const wait = (page, ms) => page.waitForTimeout(ms);

/** Distinct RGB values (capped) via the renderer handle — 1 means blank/uniform, -1 null. */
const distinctColours = (page) => evaluate(page, () => {
  const buf = window.currentPatternRenderer?.readPixels?.();
  if (!buf) return -1;
  const seen = new Set();
  for (let i = 0; i < buf.length && seen.size < 64; i += 4) seen.add((buf[i] << 16) | (buf[i + 1] << 8) | buf[i + 2]);
  return seen.size;
});

/** Lit pixels in the overlay, read right after its next draw call. */
async function overlayLit(page) {
  await evaluate(page, () => { window.__glProbes.overlay.sampleAfterDraw = true; window.__glProbes.overlay.lit = -1; });
  await waitForFunction(page, () => window.__glProbes.overlay.lit >= 0, { timeout: 5000 });
  return evaluate(page, () => window.__glProbes.overlay.lit);
}

/**
 * One lose → restore cycle on `kind`'s context. `lostWarn` / `restoredLog` match the app's
 * console lines; `pixelsOk` re-checks real output after the restore.
 */
async function loseAndRestore(page, messages, kind, { lostWarn, restoredLog, pixelsOk, cycle }) {
  const tag = `[cycle ${cycle}]`;
  const warnsBefore = messages.filter((m) => lostWarn.test(m.text)).length;
  await evaluate(page, (k) => window.__glProbes[k].ext.loseContext(), kind);
  await wait(page, 300); // the lost event is dispatched asynchronously
  check(`${tag} context reports lost`, (await lost(page, kind)) === true);
  const warns = messages.filter((m) => lostWarn.test(m.text)).length - warnsBefore;
  check(`${tag} app warned exactly once`, warns === 1, `saw ${warns}`);

  const frozenFrom = await draws(page, kind);
  await wait(page, LOST_WINDOW_MS);
  const frozenTo = await draws(page, kind);
  check(`${tag} no draw calls while lost (${LOST_WINDOW_MS} ms)`, frozenTo === frozenFrom, `${frozenFrom} → ${frozenTo}`);
  if (kind === 'pattern') check(`${tag} readPixels() is null while lost`, (await distinctColours(page)) === -1);

  const restoreAt = Date.now();
  await evaluate(page, (k) => window.__glProbes[k].ext.restoreContext(), kind);
  let resumed = true;
  try {
    // A few frames' worth of draws (headless SwiftShader on a loaded host can be ~1–2 fps); any
    // draw at all already contradicts the zero-draw window above.
    await waitWithArg(page, ([k, target]) => (window.__glProbes[k]?.draws ?? 0) >= target,
      [kind, frozenTo + RESUMED_DRAWS], RESUME_TIMEOUT_MS);
  } catch {
    resumed = false;
  }
  check(`${tag} draw calls resume after restoreContext()`, resumed, `draws ${frozenTo} → ${await draws(page, kind)}`);
  check(`${tag} context reports restored`, (await lost(page, kind)) === false);
  await wait(page, 1000); // let the cap texture reload
  const pixels = await pixelsOk();
  check(`${tag} renders real pixels again`, pixels.ok, pixels.detail);
  if (restoredLog) {
    check(`${tag} app logged the restore`, messages.some((m) => m.at >= restoreAt && restoredLog.test(m.text)));
  }
  const glErrors = messages.filter((m) => m.at >= restoreAt && GL_ERROR.test(m.text));
  check(`${tag} no WebGL errors after the restore`, glErrors.length === 0,
    glErrors.slice(0, 3).map((m) => m.text.slice(0, 140)).join(' | '));
}

async function scenarioPattern() {
  const { page, messages, requests, close } = await boot('1 opt-in WebGL2 pattern renderer', NO_WEBGPU_ARGS, '?webgl2=1&debug=log');
  try {
    await waitForFunction(page, () => window.currentPatternRenderer?.backend === 'webgl2' && !!window.__glProbes.pattern, { timeout: TIMEOUT });
    await evaluate(page, () => window.__TEST_HOOKS__?.startPlayback?.());
    await wait(page, 1500);
    check('the WebGL2 renderer chunk was lazy-loaded for the opt-in', fetchedWebGL2Chunk(requests));
    check('WebGL2 backend active, no init failure card',
      !(await evaluate(page, () => !!document.querySelector('[data-webgl2-init-failed]'))));
    check('preserveDrawingBuffer is on under automation (navigator.webdriver)',
      await evaluate(page, () => window.__glProbes.pattern.gl.getContextAttributes()?.preserveDrawingBuffer === true));
    check('WEBGL_lose_context available', await evaluate(page, () => !!window.__glProbes.pattern.ext));
    const d0 = await draws(page, 'pattern');
    await wait(page, 500);
    check('frames are drawing before the loss', (await draws(page, 'pattern')) > d0);
    const before = await distinctColours(page);
    check('readPixels() non-uniform before the loss', before > 1, `distinct colours = ${before}`);

    const pixelsOk = async () => {
      const n = await distinctColours(page);
      return { ok: n > 1, detail: `distinct colours = ${n}` };
    };
    for (const cycle of [1, 2]) {
      await loseAndRestore(page, messages, 'pattern', {
        cycle,
        lostWarn: /WebGL2 context lost/,
        restoredLog: /context restored — GL resources re-created/,
        pixelsOk,
      });
    }
    check('still the WebGL2 backend', (await evaluate(page, () => window.currentPatternRenderer?.backend)) === 'webgl2');
    const pageErrors = messages.filter((m) => m.type === 'pageerror');
    check('no page errors', pageErrors.length === 0, pageErrors.map((m) => m.text.slice(0, 120)).join(' | '));
  } finally {
    await close();
  }
}

async function scenarioOverlay() {
  const seed = { xasm1_last_shader: JSON.stringify(HYBRID_SHADER), xasm1_lite_mode: '0' };
  // The overlay is its own WebGL2 canvas and draws whether or not WebGPU comes up under it, so
  // this runs without the WebGPU flags: no headless Vulkan/WebGPU init to wait on or flake.
  const { page, messages, requests, close } = await boot(`2 hybrid overlay (${HYBRID_SHADER})`, NO_WEBGPU_ARGS, '?lite=0&debug=log', seed);
  try {
    try {
      await waitWithArg(page, (sel) => {
        const el = document.querySelector(sel);
        return !!el && getComputedStyle(el).display !== 'none' && (window.__glProbes.overlay?.draws ?? 0) > 0;
      }, OVERLAY_CANVAS, TIMEOUT);
    } catch (err) {
      throw new Error(`overlay never became visible / drew — ${err?.message ?? err}`);
    }
    check('pattern canvas is on the WebGPU backend (the overlay only runs there)',
      (await evaluate(page, (s) => document.querySelector(s)?.dataset.renderer, PATTERN_CANVAS)) === 'webgpu');
    check('a WebGPU session never fetches the WebGL2 renderer chunk', !fetchedWebGL2Chunk(requests));
    check('overlay: WEBGL_lose_context available', await evaluate(page, () => !!window.__glProbes.overlay.ext));
    const lit0 = await overlayLit(page);
    check('overlay draws lit pixels before the loss', lit0 > 0, `lit = ${lit0}`);

    const pixelsOk = async () => {
      const lit = await overlayLit(page);
      return { ok: lit > 0, detail: `lit = ${lit} (before the loss: ${lit0})` };
    };
    for (const cycle of [1, 2]) {
      await loseAndRestore(page, messages, 'overlay', {
        cycle,
        lostWarn: /WebGL overlay context lost/,
        restoredLog: /WebGL overlay context restored/,
        pixelsOk,
      });
    }
    const pageErrors = messages.filter((m) => m.type === 'pageerror');
    check('no page errors', pageErrors.length === 0, pageErrors.map((m) => m.text.slice(0, 120)).join(' | '));
  } finally {
    await close();
  }
}

const runners = { 1: scenarioPattern, 2: scenarioOverlay };
for (const id of ['1', '2']) {
  if (!SCENARIOS.has(id)) continue;
  try {
    await runners[id]();
  } catch (err) {
    failures += 1;
    console.log(`  FAIL  scenario ${id} threw — ${err?.message ?? err}`);
  }
}

console.log(failures === 0 ? '\nwebgl2-context-loss-smoke: OK' : `\nwebgl2-context-loss-smoke: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
