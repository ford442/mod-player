import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** The logger caches the viewer's opt-in at first use, so every test loads a fresh copy. */
async function freshLogger() {
  vi.resetModules();
  return import('../utils/log');
}

function spyConsole() {
  return {
    debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
    log: vi.spyOn(console, 'log').mockImplementation(() => {}),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
    error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    group: vi.spyOn(console, 'group').mockImplementation(() => {}),
    groupEnd: vi.spyOn(console, 'groupEnd').mockImplementation(() => {}),
  };
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('createLogger — development build', () => {
  it('prints debug and log with a [scope] prefix, and warn/error too', async () => {
    vi.stubEnv('DEV', true);
    const c = spyConsole();
    const { createLogger } = await freshLogger();
    const log = createLogger('PLAY');
    log.debug('d', 1);
    log.log('l', { a: 2 });
    log.group('section');
    log.warn('w');
    log.error('e');
    log.groupEnd();
    expect(c.group).toHaveBeenCalledWith('[PLAY]', 'section');
    expect(c.groupEnd).toHaveBeenCalledTimes(1);
    expect(c.debug).toHaveBeenCalledWith('[PLAY]', 'd', 1);
    expect(c.log).toHaveBeenCalledWith('[PLAY]', 'l', { a: 2 });
    expect(c.warn).toHaveBeenCalledWith('[PLAY]', 'w');
    expect(c.error).toHaveBeenCalledWith('[PLAY]', 'e');
  });
});

describe('createLogger — production build', () => {
  beforeEach(() => {
    vi.stubEnv('DEV', false);
  });

  it('is silent for debug/log by default but always prints warn/error', async () => {
    const c = spyConsole();
    const { createLogger, isDiagnosticLoggingEnabled } = await freshLogger();
    const log = createLogger('INIT');
    log.debug('d');
    log.log('l');
    log.group('g');
    log.groupEnd();
    log.warn('w');
    log.error('e');
    expect(isDiagnosticLoggingEnabled()).toBe(false);
    expect(c.group).not.toHaveBeenCalled();
    expect(c.groupEnd).not.toHaveBeenCalled();
    expect(c.debug).not.toHaveBeenCalled();
    expect(c.log).not.toHaveBeenCalled();
    expect(c.warn).toHaveBeenCalledWith('[INIT]', 'w');
    expect(c.error).toHaveBeenCalledWith('[INIT]', 'e');
  });

  it.each([
    ['?debug=log', true],
    ['?debug=parser,log', true],
    ['?x=1&debug=log,parser', true],
    ['?debug=parser', false],
    ['?debug=logger', false],
    ['', false],
  ])('URL %s → diagnostics %s', async (search, expected) => {
    vi.stubGlobal('location', { search });
    const c = spyConsole();
    const { createLogger, isDiagnosticLoggingEnabled } = await freshLogger();
    createLogger('PLAY').log('hello');
    expect(isDiagnosticLoggingEnabled()).toBe(expected);
    expect(c.log).toHaveBeenCalledTimes(expected ? 1 : 0);
  });

  it('honours localStorage xasm1_debug_log=1 and ignores other values', async () => {
    for (const [value, expected] of [['1', true], ['0', false], [null, false]] as const) {
      vi.stubGlobal('localStorage', { getItem: (k: string) => (k === 'xasm1_debug_log' ? value : null) });
      const { isDiagnosticLoggingEnabled } = await freshLogger();
      expect(isDiagnosticLoggingEnabled(), `localStorage value ${String(value)}`).toBe(expected);
    }
  });

  it('stays off, without throwing, when storage access throws (private mode)', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError');
      },
    });
    const { createLogger, isDiagnosticLoggingEnabled } = await freshLogger();
    expect(isDiagnosticLoggingEnabled()).toBe(false);
    expect(() => createLogger('X').log('hi')).not.toThrow();
  });
});

describe('the logger stays out of the AudioWorklet bundle', () => {
  // import.meta.env does not exist in the esbuild IIFE (audio-worklet/js → public/worklets/openmpt-worklet.js).
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? sources(p) : p.endsWith('.ts') ? [p] : [];
    });
  }

  const workletSources = [
    ...sources(join(ROOT, 'audio-worklet', 'js')),
    join(ROOT, 'audio-worklet', 'workletProtocolConstants.ts'),
    join(ROOT, 'audio-worklet', 'libRuntimeReady.ts'),
  ];

  it('finds the worklet sources it is meant to guard', () => {
    expect(workletSources.length).toBeGreaterThanOrEqual(3);
  });

  it.each(workletSources.map((p) => [p.slice(ROOT.length + 1), p]))('%s does not import utils/log', (_name, file) => {
    const text = readFileSync(file as string, 'utf8');
    expect(text).not.toMatch(/from\s+['"][^'"]*utils\/log['"]/);
    expect(text).not.toMatch(/import\s*\(\s*['"][^'"]*utils\/log['"]/);
    expect(text).not.toContain('import.meta.env');
  });
});
