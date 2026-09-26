/**
 * #runtime-hardening: the shared AudioContext leaving `running` unexpectedly
 * (iOS/Safari `interrupted`, OS suspends — CLAUDE.md pitfall #12) must be
 * noticed and recovered, instead of only ever checking `ctx.state` inside
 * `play()` while the UI keeps showing "Playing" over silence.
 *
 * Covers both halves of the fix:
 *   - utils/audioContextFactory.ts reports the transition (wireStateChangeReporting)
 *   - hooks/useAudioGraph.ts recovers on the next user gesture (wireAudioSuspendRecovery)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPlayerAudioContext,
  setPlaybackActiveQuery,
  __resetSharedPlayerAudioContextForTests,
} from '../utils/audioContextFactory';
import {
  getAudioSuspendState,
  __resetAudioSuspendStateForTests,
} from '../utils/audioSuspendState';
import { wireAudioSuspendRecovery } from '../hooks/useAudioGraph';
import type { AudioGraphCallbacks, AudioGraphRefs } from '../hooks/audioGraph/types';

class MockAudioContext {
  state: AudioContextState = 'running';
  sampleRate: number;
  currentTime = 0;
  onstatechange: (() => void) | null = null;

  constructor(opts?: AudioContextOptions) {
    this.sampleRate = opts?.sampleRate ?? 48000;
  }
}

function installMockAudioContext(): void {
  Object.defineProperty(globalThis, 'AudioContext', {
    value: MockAudioContext,
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
    },
    configurable: true,
    writable: true,
  });
}

class FakeWindow extends EventTarget {
  location = { search: '' };
  localStorage = globalThis.localStorage;
}
class FakeDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';
}

function installWindowAndDocument(): void {
  Object.defineProperty(globalThis, 'window', {
    value: new FakeWindow(),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'document', {
    value: new FakeDocument(),
    configurable: true,
    writable: true,
  });
}

describe('AudioContext unexpected-suspend detection (audioContextFactory)', () => {
  beforeEach(() => {
    installMemoryLocalStorage();
    installWindowAndDocument();
    installMockAudioContext();
    __resetSharedPlayerAudioContextForTests();
    __resetAudioSuspendStateForTests();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    __resetSharedPlayerAudioContextForTests();
    __resetAudioSuspendStateForTests();
    Reflect.deleteProperty(globalThis, 'AudioContext');
    Reflect.deleteProperty(globalThis, 'window');
    Reflect.deleteProperty(globalThis, 'document');
  });

  it('reports suspended when the context leaves running while playback is expected', () => {
    const ctx = createPlayerAudioContext() as unknown as MockAudioContext;
    setPlaybackActiveQuery(() => true);

    ctx.state = 'suspended';
    ctx.onstatechange?.();

    expect(getAudioSuspendState().suspended).toBe(true);
    expect(getAudioSuspendState().contextState).toBe('suspended');
  });

  it('does not report suspended when playback was not expected (a real pause)', () => {
    const ctx = createPlayerAudioContext() as unknown as MockAudioContext;
    setPlaybackActiveQuery(() => false);

    ctx.state = 'suspended';
    ctx.onstatechange?.();

    expect(getAudioSuspendState().suspended).toBe(false);
  });

  it('clears suspended once the context returns to running', () => {
    const ctx = createPlayerAudioContext() as unknown as MockAudioContext;
    setPlaybackActiveQuery(() => true);

    ctx.state = 'suspended';
    ctx.onstatechange?.();
    expect(getAudioSuspendState().suspended).toBe(true);

    ctx.state = 'running';
    ctx.onstatechange?.();
    expect(getAudioSuspendState().suspended).toBe(false);
  });
});

describe('AudioContext suspend recovery on the next user gesture (useAudioGraph)', () => {
  beforeEach(() => {
    installMemoryLocalStorage();
    installWindowAndDocument();
    installMockAudioContext();
    __resetSharedPlayerAudioContextForTests();
    __resetAudioSuspendStateForTests();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    __resetSharedPlayerAudioContextForTests();
    __resetAudioSuspendStateForTests();
    Reflect.deleteProperty(globalThis, 'AudioContext');
    Reflect.deleteProperty(globalThis, 'window');
    Reflect.deleteProperty(globalThis, 'document');
  });

  function makeRefs(overrides: Partial<AudioGraphRefs> = {}): AudioGraphRefs {
    return {
      isPlayingRef: { current: true },
      audioClockStartRef: { current: 0 },
      workletTimeAtStartRef: { current: 0 },
      workletTimeRef: { current: 0 },
      driftAccumulatorRef: { current: 0 },
      ...overrides,
    } as unknown as AudioGraphRefs;
  }

  function makeCallbacks(): AudioGraphCallbacks & { setStatus: ReturnType<typeof vi.fn> } {
    return {
      setStatus: vi.fn(),
      setIsPlaying: vi.fn(),
      setActiveEngine: vi.fn(),
      setModuleInfo: vi.fn(),
      setSequencerMatrix: vi.fn(),
      stopMusic: vi.fn(),
      seekToStepWrapper: vi.fn(),
      updateUI: vi.fn(),
    } as unknown as AudioGraphCallbacks & { setStatus: ReturnType<typeof vi.fn> };
  }

  it('shows a status message while suspended and resumes + re-anchors on the next gesture', async () => {
    const ctx = createPlayerAudioContext() as unknown as MockAudioContext & { resume: () => Promise<void> };
    ctx.currentTime = 42;
    (ctx as unknown as { resume: () => Promise<void> }).resume = vi.fn(async () => {
      ctx.state = 'running';
    });

    const refs = makeRefs();
    const callbacks = makeCallbacks();
    wireAudioSuspendRecovery(ctx as unknown as AudioContext, refs, callbacks);

    setPlaybackActiveQuery(() => refs.isPlayingRef.current);
    ctx.state = 'interrupted' as AudioContextState;
    ctx.onstatechange?.();

    expect(getAudioSuspendState().suspended).toBe(true);
    expect(callbacks.setStatus).toHaveBeenCalledWith(
      expect.stringContaining('tap anywhere to resume'),
    );

    // Simulated user gesture — any of pointerdown/keydown/touchstart recovers it.
    globalThis.window.dispatchEvent(new Event('pointerdown'));
    // Let the ctx.resume().then(...) microtask chain settle.
    await Promise.resolve();
    await Promise.resolve();

    expect(getAudioSuspendState().suspended).toBe(false);
    expect(refs.audioClockStartRef.current).toBe(42);
    expect(callbacks.setStatus).toHaveBeenCalledWith('Playing...');
  });

  it('does not re-wire listeners twice for the same context (WeakSet guard)', () => {
    const ctx = createPlayerAudioContext() as unknown as AudioContext;
    const refs = makeRefs();
    const callbacks = makeCallbacks();

    wireAudioSuspendRecovery(ctx, refs, callbacks);
    wireAudioSuspendRecovery(ctx, refs, callbacks);

    setPlaybackActiveQuery(() => refs.isPlayingRef.current);
    (ctx as unknown as MockAudioContext).state = 'suspended';
    (ctx as unknown as MockAudioContext).onstatechange?.();

    // One 'tap to resume' status per actual transition — not doubled by a
    // second subscription from the second wire call.
    const tapCalls = callbacks.setStatus.mock.calls.filter(
      (args: unknown[]) => typeof args[0] === 'string' && args[0].includes('tap anywhere'),
    );
    expect(tapCalls).toHaveLength(1);
  });
});
