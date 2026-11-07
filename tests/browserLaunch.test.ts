import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { announceBrowser, resolvePlaywrightBrowser } from '../scripts/lib/browser-launch.mjs';

// The smokes must run on Playwright's bundled Chromium unless told otherwise: the runner image's Chrome
// floats with the image, and 155 → 156 turned the FX null check red (#535).

const KEYS = ['PLAYWRIGHT_CHROMIUM_EXECUTABLE', 'PLAYWRIGHT_BROWSERS_PATH', 'CHROME_PATH', 'PLAYWRIGHT_CHANNEL', 'CI'] as const;

describe('resolvePlaywrightBrowser', () => {
  const saved: Record<string, string | undefined> = {};
  let dir: string;
  let bundled: string;
  const chromium = { executablePath: () => bundled };

  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    dir = mkdtempSync(join(tmpdir(), 'browser-launch-'));
    bundled = join(dir, 'bundled-chrome');
    writeFileSync(bundled, '');
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.restoreAllMocks();
  });

  it('defaults to the bundled Playwright Chromium, never a channel', () => {
    expect(resolvePlaywrightBrowser(chromium)).toEqual({ executablePath: bundled, source: 'playwright bundled chromium' });
  });

  it('an explicit executable wins, then CHROME_PATH', () => {
    const other = join(dir, 'other-chrome');
    writeFileSync(other, '');
    process.env.CHROME_PATH = other;
    expect(resolvePlaywrightBrowser(chromium)).toMatchObject({ executablePath: other, source: 'CHROME_PATH' });
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE = bundled;
    expect(resolvePlaywrightBrowser(chromium)).toMatchObject({ executablePath: bundled, source: 'explicit executable' });
  });

  it('PLAYWRIGHT_CHANNEL opts in to an installed browser', () => {
    process.env.PLAYWRIGHT_CHANNEL = 'chrome';
    expect(resolvePlaywrightBrowser(chromium)).toEqual({ channel: 'chrome', source: 'channel chrome' });
  });

  it('refuses to fall back to the image Chrome in CI, warns elsewhere', () => {
    bundled = join(dir, 'missing');
    process.env.CI = 'true';
    expect(() => resolvePlaywrightBrowser(chromium)).toThrow(/bundled Chromium is missing/);
    delete process.env.CI;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolvePlaywrightBrowser(chromium)).toMatchObject({ channel: 'chrome' });
  });

  it('announces product, version and source on one line', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(announceBrowser({ engine: 'playwright', product: 'Chromium', version: '156.0.1', source: 'x', executablePath: '/p' })).toBe(
      'browser: Chromium 156.0.1 [x: /p]',
    );
  });
});
