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

export function shouldUseBundledPlaywrightChromium() {
  return resolvePlaywrightChromiumExecutable() != null;
}

export function resolveChromePath() {
  for (const p of CHROME_CANDIDATES) {
    if (p && existsSync(p)) return p;
  }
  return CHROME_CANDIDATES[0] ?? '/usr/bin/google-chrome';
}

/**
 * @returns {Promise<{ browser: import('playwright').Browser | import('puppeteer').Browser, engine: 'playwright' | 'puppeteer', close: () => Promise<void> }>}
 */
export async function launchBrowser(options = {}) {
  const chromeArgs = options.args ?? DEFAULT_CHROME_ARGS;
  const headless = options.headless !== false;

  try {
    const { chromium } = await import('playwright');
    const bundledExecutable = resolvePlaywrightChromiumExecutable();
    const useBundled = shouldUseBundledPlaywrightChromium();
    /** @type {import('playwright').LaunchOptions} */
    const launchOptions = {
      headless,
      args: chromeArgs.filter((a) => a !== '--headless=new'),
    };
    if (bundledExecutable) {
      launchOptions.executablePath = bundledExecutable;
    } else if (!useBundled) {
      launchOptions.channel = process.env.PLAYWRIGHT_CHANNEL || 'chrome';
    }
    const browser = await chromium.launch(launchOptions);
    return {
      browser,
      engine: 'playwright',
      close: () => browser.close(),
    };
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
  console.log(`  using puppeteer + ${resolveChromePath()}`);
  return {
    browser,
    engine: 'puppeteer',
    close: () => browser.close(),
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
