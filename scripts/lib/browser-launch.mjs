/**
 * Shared Playwright / puppeteer launcher for headless visual smoke tests.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_CHROME_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--headless=new',
  '--use-angle=vulkan',
  '--enable-features=Vulkan',
  '--disable-vulkan-surface',
  '--enable-unsafe-webgpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--autoplay-policy=no-user-gesture-required',
  '--window-size=1280,720',
];

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

/** Resolve a Chromium binary when PLAYWRIGHT_BROWSERS_PATH layout differs from stock Playwright. */
export function resolvePlaywrightChromiumExecutable() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE && existsSync(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE)) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  }
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return null;
  const direct = join(root, 'chromium', 'chrome-linux', 'chrome');
  if (existsSync(direct)) return direct;
  try {
    for (const entry of readdirSync(root)) {
      if (!entry.startsWith('chromium')) continue;
      const candidate = join(root, entry, 'chrome-linux', 'chrome');
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function resolveChromePath() {
  for (const p of CHROME_CANDIDATES) {
    if (p && existsSync(p)) return p;
  }
  return CHROME_CANDIDATES[0] ?? '/usr/bin/google-chrome';
}

/**
 * Which Chromium Playwright launches, in order:
 *  1. an explicit binary: PLAYWRIGHT_CHROMIUM_EXECUTABLE, a PLAYWRIGHT_BROWSERS_PATH layout, or CHROME_PATH;
 *  2. PLAYWRIGHT_CHANNEL (e.g. `chrome`) — opt in to an installed browser, which floats with the machine;
 *  3. Playwright's own bundled Chromium (`chromium.executablePath()`), pinned by the playwright version in
 *     package-lock — so a browser upgrade only ever arrives with a deliberate playwright bump (#535).
 * The runner image's Google Chrome (channel `chrome`) used to be the CI default and drifted from 155 to 156
 * with the image, which turned the FX null check red. In CI a missing bundled Chromium is an error rather
 * than a silent fall-back to whatever the image ships.
 *
 * @returns {{ executablePath?: string, channel?: string, source: string }}
 */
export function resolvePlaywrightBrowser(chromium) {
  const explicit = resolvePlaywrightChromiumExecutable();
  if (explicit) return { executablePath: explicit, source: 'explicit executable' };
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) {
    return { executablePath: process.env.CHROME_PATH, source: 'CHROME_PATH' };
  }
  if (process.env.PLAYWRIGHT_CHANNEL) {
    return { channel: process.env.PLAYWRIGHT_CHANNEL, source: `channel ${process.env.PLAYWRIGHT_CHANNEL}` };
  }
  const bundled = chromium.executablePath();
  if (bundled && existsSync(bundled)) return { executablePath: bundled, source: 'playwright bundled chromium' };
  if (process.env.CI) {
    throw new Error(
      `Playwright's bundled Chromium is missing (${bundled}); run \`npx playwright install chromium\`. ` +
        'Refusing to fall back to the runner image\'s Chrome in CI, which floats with the image.',
    );
  }
  console.warn(`  Playwright's bundled Chromium is missing (${bundled}) — falling back to the installed Chrome.`);
  return { channel: 'chrome', source: 'channel chrome (fallback)' };
}

/** Print (and return) the browser identity — the first line of every smoke report, so drift shows up at a glance. */
export function announceBrowser(info) {
  const line = `browser: ${info.product} ${info.version} [${info.source}${info.executablePath ? `: ${info.executablePath}` : ''}]`;
  console.log(`  ${line}`);
  return line;
}

/**
 * @returns {Promise<{ browser: import('playwright').Browser | import('puppeteer').Browser, engine: 'playwright' | 'puppeteer', close: () => Promise<void>, info: { engine: string, product: string, version: string, source: string, executablePath?: string } }>}
 */
export async function launchBrowser(options = {}) {
  const chromeArgs = options.args ?? DEFAULT_CHROME_ARGS;
  const headless = options.headless !== false;

  try {
    const { chromium } = await import('playwright');
    const resolved = resolvePlaywrightBrowser(chromium);
    /** @type {import('playwright').LaunchOptions} */
    const launchOptions = {
      headless,
      args: chromeArgs.filter((a) => a !== '--headless=new'),
    };
    if (resolved.executablePath) launchOptions.executablePath = resolved.executablePath;
    if (resolved.channel) launchOptions.channel = resolved.channel;
    const browser = await chromium.launch(launchOptions);
    const info = {
      engine: 'playwright',
      product: 'Chromium',
      version: browser.version(),
      source: resolved.source,
      ...(resolved.executablePath ? { executablePath: resolved.executablePath } : {}),
    };
    announceBrowser(info);
    return {
      browser,
      engine: 'playwright',
      close: () => browser.close(),
      info,
    };
  } catch (err) {
    if (process.env.CI) throw err;
    console.warn(`  Playwright+Chrome unavailable: ${err.message}`);
  }

  let puppeteer;
  try {
    puppeteer = await import('puppeteer-core');
  } catch {
    try {
      puppeteer = await import('puppeteer');
    } catch {
      throw new Error(
        'No browser automation available. Install playwright (`npm i -D playwright`) or puppeteer-core + Chrome.',
      );
    }
  }

  const launch = puppeteer.default?.launch ?? puppeteer.launch;
  const browser = await launch({
    headless: 'new',
    executablePath: resolveChromePath(),
    args: chromeArgs,
    ignoreDefaultArgs: ['--enable-automation'],
  });
  const info = {
    engine: 'puppeteer',
    product: 'Chrome',
    version: (await browser.version()).replace(/^\D+\//, ''),
    source: 'puppeteer',
    executablePath: resolveChromePath(),
  };
  announceBrowser(info);
  return {
    browser,
    engine: 'puppeteer',
    close: () => browser.close(),
    info,
  };
}

/** @param {import('playwright').Browser | import('puppeteer').Browser} browser */
export async function openPage(browser, engine, viewport = { width: 1280, height: 720 }) {
  if (engine === 'playwright') {
    // Pin deviceScaleFactor to 1 so readPixels() returns canvas-resolution pixels
    // regardless of the CI runner's display configuration — required for deterministic
    // coverage computations across local and CI environments.
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await context.newPage();
    return { page, context, engine };
  }
  const page = await browser.newPage();
  await page.setViewport({ ...viewport, deviceScaleFactor: 1 });
  return { page, context: null, engine };
}

/** @param {import('playwright').Page | import('puppeteer').Page} page */
export async function goto(page, engine, url, timeout) {
  const waitUntil = engine === 'playwright' ? 'networkidle' : 'networkidle2';
  await page.goto(url, { waitUntil, timeout });
}

/**
 * Wait until `fn` is truthy in the page.
 *
 * Playwright: `page.waitForFunction(fn, arg?, options?)` — options are the **third** arg.
 * Puppeteer:  `page.waitForFunction(fn, options?)` — options are the **second** arg.
 * Passing `{ timeout }` as the second arg under Playwright treats it as the pageFunction
 * argument and silently keeps the default 30s timeout (flaky audio/visual smokes).
 *
 * @param {import('playwright').Page | import('puppeteer').Page} page
 * @param {Function} fn
 * @param {{ timeout?: number, polling?: number|string }} [options]
 */
export async function waitForFunction(page, fn, options = {}) {
  const timeout = options.timeout ?? 60000;
  /** @type {{ timeout: number, polling?: number|string }} */
  const opts = { timeout };
  if (options.polling != null) opts.polling = options.polling;

  // Playwright Page exposes context(); Puppeteer does not.
  const isPlaywright = typeof page.context === 'function';
  if (isPlaywright) {
    await page.waitForFunction(fn, undefined, opts);
  } else {
    await page.waitForFunction(fn, opts);
  }
}

/** @param {import('playwright').Page | import('puppeteer').Page} page */
export async function evaluate(page, fn, arg) {
  return page.evaluate(fn, arg);
}

/** @param {import('playwright').Page | import('puppeteer').Page} page */
export async function screenshotElement(page, engine, selector, path) {
  const el = await page.$(selector);
  if (!el) return false;
  if (engine === 'playwright') {
    await el.screenshot({ path });
  } else {
    await el.screenshot({ path });
  }
  return true;
}
