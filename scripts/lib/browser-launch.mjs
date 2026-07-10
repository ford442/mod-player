/**
 * Shared Playwright / puppeteer launcher for headless visual smoke tests.
 */
import { existsSync } from 'node:fs';

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
  '--window-size=1280,720',
];

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

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
    const browser = await chromium.launch({
      channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
      headless,
      args: chromeArgs.filter((a) => a !== '--headless=new'),
    });
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
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    return { page, context, engine };
  }
  const page = await browser.newPage();
  await page.setViewport(viewport);
  return { page, context: null, engine };
}

/** @param {import('playwright').Page | import('puppeteer').Page} page */
export async function goto(page, engine, url, timeout) {
  const waitUntil = engine === 'playwright' ? 'networkidle' : 'networkidle2';
  await page.goto(url, { waitUntil, timeout });
}

/** @param {import('playwright').Page | import('puppeteer').Page} page */
export async function waitForFunction(page, fn, options = {}) {
  const timeout = options.timeout ?? 60000;
  await page.waitForFunction(fn, { timeout, polling: options.polling });
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
