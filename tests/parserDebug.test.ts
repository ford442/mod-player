import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerParseMessage } from '../types';

// parserWorker.ts imports the worker as a Vite `?worker&url` asset; only its URL string matters here.
vi.mock('../workers/openmpt-parser.worker.ts?worker&url', () => ({ default: 'parser.worker.js' }));

async function freshParserDebug() {
  vi.resetModules();
  return import('../utils/parserDebug');
}

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('isParserDebugEnabled — main thread', () => {
  it.each([
    ['?debug=parser', true],
    ['?debug=parser,log', true],
    ['?debug=log,parser', true],
    ['?debug=log', false],
    ['?debug=parsers', false],
    ['', false],
  ])('URL %s → %s', async (search, expected) => {
    vi.stubGlobal('window', { location: { search } });
    vi.stubGlobal('localStorage', { getItem: () => null });
    const { isParserDebugEnabled } = await freshParserDebug();
    expect(isParserDebugEnabled()).toBe(expected);
  });

  it('honours localStorage xasm1_debug_parser=1', async () => {
    vi.stubGlobal('window', { location: { search: '' } });
    vi.stubGlobal('localStorage', { getItem: (k: string) => (k === 'xasm1_debug_parser' ? '1' : null) });
    const { isParserDebugEnabled } = await freshParserDebug();
    expect(isParserDebugEnabled()).toBe(true);
  });
});

describe('isParserDebugEnabled — worker (no window, no storage)', () => {
  it('is off until the main thread says otherwise, and follows the latest request', async () => {
    // A dedicated worker has no `window`; the test setup defines one, so remove it for this case.
    vi.stubGlobal('window', undefined);
    expect(typeof window).toBe('undefined');
    const { isParserDebugEnabled, setParserDebugFromMainThread, parserLog } = await freshParserDebug();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(isParserDebugEnabled()).toBe(false);
    parserLog('hidden');
    expect(log).not.toHaveBeenCalled();

    setParserDebugFromMainThread(true);
    expect(isParserDebugEnabled()).toBe(true);
    parserLog('shown', 42);
    expect(log).toHaveBeenCalledWith('[Parser]', 'shown', 42);

    setParserDebugFromMainThread(false);
    expect(isParserDebugEnabled()).toBe(false);
  });
});

describe('the parser worker applies the request’s debug flag', () => {
  type FakeSelf = {
    postMessage: (m: { type: string }) => void;
    onmessage: ((e: { data: unknown }) => void) | null;
    onerror: unknown;
    onmessageerror: unknown;
    setTimeout: typeof setTimeout;
    clearTimeout: typeof clearTimeout;
  };

  /** Load the real worker module against a fake `self`; the libopenmpt fetch is made to fail fast. */
  async function runWorker(extra: Record<string, unknown>) {
    vi.resetModules();
    const posted: Array<{ type: string }> = [];
    const fakeSelf: FakeSelf = {
      postMessage: (m) => void posted.push(m),
      onmessage: null,
      onerror: null,
      onmessageerror: null,
      setTimeout,
      clearTimeout,
    };
    vi.stubGlobal('self', fakeSelf);
    vi.stubGlobal('window', undefined); // a dedicated worker has no window
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await import('../workers/openmpt-parser.worker');
    expect(fakeSelf.onmessage, 'worker registers its message handler').toBeTypeOf('function');
    fakeSelf.onmessage?.({ data: { type: 'parse', fileData: new Uint8Array(4), fileName: 't.mod', ...extra } });
    await vi.waitFor(() => expect(posted.some((m) => m.type === 'error')).toBe(true));
    return log.mock.calls.filter((c) => c[0] === '[Parser]');
  }

  it('logs the worker side when the request carries debug: true', async () => {
    const calls = await runWorker({ debug: true });
    expect(calls.map((c) => c[1])).toContain('worker parse start');
  });

  it('stays quiet when the request has no debug flag', async () => {
    expect(await runWorker({})).toEqual([]);
  });
});

describe('parseInWorker forwards the debug switch to the worker', () => {
  class FakeWorker {
    posted: WorkerParseMessage[] = [];
    private listeners = new Map<string, Array<(e: unknown) => void>>();
    addEventListener(type: string, fn: (e: unknown) => void) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
    }
    removeEventListener(type: string, fn: (e: unknown) => void) {
      this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== fn));
    }
    postMessage(message: WorkerParseMessage) {
      this.posted.push(message);
      // Answer immediately so the returned promise settles.
      for (const fn of this.listeners.get('message') ?? []) fn({ data: { type: 'error', message: 'stub' } });
    }
    terminate() {}
  }

  const request = (): WorkerParseMessage => ({ type: 'parse', fileData: new Uint8Array([1, 2, 3]), fileName: 'x.mod' });

  async function post(search: string) {
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('location', { search });
    vi.stubGlobal('localStorage', { getItem: () => null });
    vi.resetModules();
    const { parseInWorker } = await import('../utils/parserWorker');
    const worker = new FakeWorker();
    await parseInWorker(worker as unknown as Worker, request(), []);
    return worker.posted[0];
  }

  it('adds debug: true when ?debug=parser is on', async () => {
    const sent = await post('?debug=parser');
    expect(sent?.debug).toBe(true);
    expect(sent?.fileName).toBe('x.mod');
    expect(sent?.fileData).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('leaves the message untouched when it is off', async () => {
    const sent = await post('');
    expect(sent).toBeDefined();
    expect('debug' in (sent ?? {})).toBe(false);
  });
});
