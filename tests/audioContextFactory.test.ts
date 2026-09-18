import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PLAYER_SAMPLE_RATE,
  __resetSharedPlayerAudioContextForTests,
  closeSharedPlayerAudioContext,
  createPlayerAudioContext,
  getSharedPlayerAudioContext,
  parseLatencyQueryParam,
  resolveAudioGraphProfile,
} from '../utils/audioContextFactory';
import { STAGE_MODE_STORAGE_KEY } from '../utils/stageModeSelection';

type CtorArgs = AudioContextOptions | undefined;

const constructed: CtorArgs[] = [];

/** Minimal AudioContext stand-in — records every construction arg bag. */
class MockAudioContext {
  state = 'suspended';
  sampleRate: number;
  baseLatency = 0.01;
  outputLatency = 0.02;
  setSinkIdCalls: string[] = [];

  constructor(opts?: AudioContextOptions) {
    constructed.push(opts);
    this.sampleRate = opts?.sampleRate ?? 44100;
  }

  setSinkId(id: string): Promise<void> {
    this.setSinkIdCalls.push(id);
    return Promise.resolve();
  }
}

function installMockAudioContext(impl: unknown = MockAudioContext): void {
  Object.defineProperty(globalThis, 'AudioContext', {
    value: impl,
    configurable: true,
    writable: true,
  });
}

function installWindow(search: string): void {
  Object.defineProperty(globalThis, 'window', {
    value: {
      location: { search },
      localStorage: globalThis.localStorage,
    },
    configurable: true,
    writable: true,
  });
}

function installMemoryLocalStorage(): void {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => { store.clear(); },
      get length() { return store.size; },
      key: (i: number) => [...store.keys()][i] ?? null,
    },
    configurable: true,
    writable: true,
  });
}

describe('audioContextFactory', () => {
  beforeEach(() => {
    constructed.length = 0;
    __resetSharedPlayerAudioContextForTests();
    installMemoryLocalStorage();
    installWindow('');
    installMockAudioContext();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    __resetSharedPlayerAudioContextForTests();
    Reflect.deleteProperty(globalThis, 'AudioContext');
    Reflect.deleteProperty(globalThis, 'window');
  });

  it('locks sampleRate 48000 and latencyHint playback by default', () => {
    createPlayerAudioContext();
    expect(constructed).toHaveLength(1);
    expect(constructed[0]).toEqual({ sampleRate: 48000, latencyHint: 'playback' });
    expect(PLAYER_SAMPLE_RATE).toBe(48000);
  });

  it('uses interactive latencyHint for the interactive profile', () => {
    createPlayerAudioContext({ profile: 'interactive' });
    expect(constructed[0]).toEqual({ sampleRate: 48000, latencyHint: 'interactive' });
  });

  it('accepts an explicit 44100 rate', () => {
    createPlayerAudioContext({ sampleRate: 44100 });
    expect(constructed[0]).toEqual({ sampleRate: 44100, latencyHint: 'playback' });
  });

  it('returns one context per page session and ignores later options', () => {
    const first = createPlayerAudioContext();
    const second = createPlayerAudioContext({ profile: 'interactive' });
    expect(second).toBe(first);
    expect(constructed).toHaveLength(1);
    expect(getSharedPlayerAudioContext()).toBe(first);
  });

  it('getSharedPlayerAudioContext is null before the first create', () => {
    expect(getSharedPlayerAudioContext()).toBeNull();
  });

  it('getSharedPlayerAudioContext is null once the context is closed', () => {
    const ctx = createPlayerAudioContext() as unknown as MockAudioContext;
    ctx.state = 'closed';
    expect(getSharedPlayerAudioContext()).toBeNull();
  });

  it('falls back to the device default rate on one context, not two', () => {
    let attempt = 0;
    class PickyAudioContext extends MockAudioContext {
      constructor(opts?: AudioContextOptions) {
        // Record before throwing so the assertion below can see both bags.
        super(opts);
        attempt += 1;
        if (attempt === 1 && opts?.sampleRate != null) {
          throw new Error('sampleRate not supported');
        }
      }
    }
    installMockAudioContext(PickyAudioContext);

    const ctx = createPlayerAudioContext();
    expect(constructed[0]).toEqual({ sampleRate: 48000, latencyHint: 'playback' });
    expect(constructed[1]).toEqual({ latencyHint: 'playback' });
    // One *surviving* context: the rejected constructor never produced one.
    expect(getSharedPlayerAudioContext()).toBe(ctx);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('closeSharedPlayerAudioContext closes and clears the singleton', async () => {
    const closed: string[] = [];
    class ClosableAudioContext extends MockAudioContext {
      close(): Promise<void> {
        closed.push('close');
        this.state = 'closed';
        return Promise.resolve();
      }
    }
    installMockAudioContext(ClosableAudioContext);

    const first = createPlayerAudioContext();
    closeSharedPlayerAudioContext();
    await Promise.resolve();
    expect(closed).toEqual(['close']);
    expect(getSharedPlayerAudioContext()).toBeNull();

    // A fresh session gets a fresh context, not the dead one.
    const second = createPlayerAudioContext();
    expect(second).not.toBe(first);
    expect(constructed).toHaveLength(2);
  });

  it('applies sinkId when supported', () => {
    const ctx = createPlayerAudioContext({ sinkId: 'device-7' }) as unknown as MockAudioContext;
    expect(ctx.setSinkIdCalls).toEqual(['device-7']);
  });

  it('throws when Web Audio is unavailable rather than returning a stub', () => {
    Reflect.deleteProperty(globalThis, 'AudioContext');
    installWindow('');
    expect(() => createPlayerAudioContext()).toThrow(/Web Audio API is not available/);
  });

  it('parses ?latency=', () => {
    expect(parseLatencyQueryParam('?latency=interactive')).toBe('interactive');
    expect(parseLatencyQueryParam('latency=playback')).toBe('playback');
    expect(parseLatencyQueryParam('?latency=bogus')).toBeNull();
    expect(parseLatencyQueryParam('')).toBeNull();
  });

  it('resolves profile from ?latency=, then stage mode, else playback', () => {
    expect(resolveAudioGraphProfile('')).toBe('playback');
    expect(resolveAudioGraphProfile('?latency=interactive')).toBe('interactive');
    expect(resolveAudioGraphProfile('?stage=1')).toBe('interactive');
    // ?latency= wins over stage mode.
    expect(resolveAudioGraphProfile('?stage=1&latency=playback')).toBe('playback');
    localStorage.setItem(STAGE_MODE_STORAGE_KEY, 'true');
    expect(resolveAudioGraphProfile('')).toBe('interactive');
  });

  it('reads the profile from the URL when no options are passed', () => {
    installWindow('?latency=interactive');
    createPlayerAudioContext();
    expect(constructed[0]).toEqual({ sampleRate: 48000, latencyHint: 'interactive' });
  });
});

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SKIP_DIRS = new Set([
  'node_modules', 'dist', '.git', 'tests', 'vendor',
  '_codeql_detected_source_root',
]);

/** Strip comments so prose about the removed call sites does not trip a check. */
function readCode(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function walkSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walkSources(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('audioContextFactory is the only construction site', () => {
  it('no other .ts/.tsx source constructs an AudioContext', () => {
    const offenders = walkSources(ROOT)
      .filter((f) => f !== join(ROOT, 'utils/audioContextFactory.ts'))
      .filter((f) => /new\s+(?:\(\s*window\.)?(?:webkit)?AudioContext\b/.test(readCode(f)))
      .map((f) => f.slice(ROOT.length));
    expect(offenders).toEqual([]);
  });

  it('the dual-context native path is gone from the tree', () => {
    const hits = walkSources(ROOT)
      .filter((f) => /nativeCtx|isNativeLegacyAudioContext|native-bridge-processor/
        .test(readCode(f)))
      .map((f) => f.slice(ROOT.length));
    expect(hits).toEqual([]);
  });
});
