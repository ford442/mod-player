/**
 * PlayerEngine headless (#492): no React, no browser — a fake start path plays the audio engine's
 * part (installs a mock worklet node, reports `started` / a fault through the same callbacks the real
 * start paths use), and the test drives the engine the way the UI, the command bus and MIDI do.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAIN_TO_WORKLET } from '../audio-worklet/workletProtocolConstants';
import { PlayerEngine, type StartAudioPlayback } from '../audio/engine/PlayerEngine';
import type { AudioGraphCallbacks, AudioGraphConfig, AudioGraphRefs, AudioStartResult } from '../hooks/audioGraph/types';
import type { PatternMatrix } from '../types';

interface StartCall {
  refs: AudioGraphRefs;
  callbacks: AudioGraphCallbacks;
  config: AudioGraphConfig;
}

function makeNode() {
  return {
    port: {
      postMessage: vi.fn(),
      onmessage: null as unknown,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
    onprocessorerror: null as unknown,
    disconnect: vi.fn(),
  };
}

const matrix = (order: number, numRows: number) => ({ order, numRows, numChannels: 4, rows: [] }) as unknown as PatternMatrix;

/** An engine with a module installed (what processModuleData leaves behind), on a fake start path. */
function setup(results: AudioStartResult[] = ['pending']) {
  const node = makeNode();
  const gain = { gain: { value: -1 } };
  const panner = { pan: { value: -1 } };
  const calls: StartCall[] = [];
  const start = vi.fn<StartAudioPlayback>(async (refs, callbacks, config) => {
    calls.push({ refs, callbacks, config });
    // What startJsWorkletPlayback leaves behind; the `loaded` ack comes later (see ack()).
    refs.audioWorkletNodeRef.current = node as unknown as AudioWorkletNode;
    refs.playbackEngineRef.current = 'worklet';
    refs.gainNodeRef.current = gain as unknown as GainNode;
    refs.stereoPannerRef.current = panner as unknown as StereoPannerNode;
    refs.patternMatricesRef.current = [matrix(0, 64), matrix(1, 32), matrix(2, 64)];
    return results.shift() ?? 'pending';
  });
  const engine = new PlayerEngine({ strictTransport: true, startAudioPlayback: start });
  engine.transport.send('load');
  engine.transport.send('parsed', 'ready');
  const last = () => calls[calls.length - 1]!;
  return {
    engine,
    node,
    gain,
    panner,
    start,
    calls,
    /** The worklet's accepted `loaded` ack (acceptWorkletLoaded → setIsPlaying(true)). */
    ack: () => last().callbacks.setIsPlaying(true),
    /** handleWorkletFault → setIsPlaying(false). */
    fault: () => last().callbacks.setIsPlaying(false),
    sent: () => node.port.postMessage.mock.calls.map((c) => c[0] as { type: string; order?: number; row?: number }),
  };
}

async function playing(f: ReturnType<typeof setup>) {
  await f.engine.play();
  f.ack();
  expect(f.engine.transport.phase).toBe('playing');
}

describe('PlayerEngine (headless)', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 7));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('plays on the engine report, not on the play() call', async () => {
    const f = setup();
    await f.engine.play();
    expect(f.start).toHaveBeenCalledTimes(1);
    expect(f.engine.transport.phase).toBe('loading');
    expect(f.engine.getSnapshot().isPlaying).toBe(false);
    f.ack();
    const snap = f.engine.getSnapshot();
    expect(snap.phase).toBe('playing');
    expect(snap.isPlaying).toBe(true);
    expect(snap.transportState).toBe('playing');
  });

  it('pauses, resumes and stops through the FSM and the node that started playback', async () => {
    const f = setup();
    await playing(f);
    f.engine.pause();
    expect(f.engine.getSnapshot().transportState).toBe('paused');
    f.engine.dispatch({ type: 'togglePlayPause' }); // paused → resume
    expect(f.engine.getSnapshot().isPlaying).toBe(true);
    f.engine.stop();
    expect(f.engine.getSnapshot().phase).toBe('stopped');
    expect(f.sent().map((m) => m.type)).toEqual([
      MAIN_TO_WORKLET.getOscBuffer,
      MAIN_TO_WORKLET.pause,
      MAIN_TO_WORKLET.play,
      MAIN_TO_WORKLET.pause,
    ]);
    // Stop detaches the node's handlers: a late message or processorerror cannot restart it.
    expect(f.node.port.onmessage).toBeNull();
    expect(f.node.onprocessorerror).toBeNull();
    expect(f.engine.getPlaybackEngine()).toBeNull();
  });

  it('ignores a stale start report after the user stopped, and silences the engine again', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = setup();
    await f.engine.play();
    f.engine.stop(); // during the engine start
    f.node.port.postMessage.mockClear();
    f.ack(); // e.g. the native engine finishing its awaits
    expect(f.engine.transport.phase).toBe('stopped');
    expect(f.engine.getSnapshot().isPlaying).toBe(false);
    expect(f.sent().map((m) => m.type)).toEqual([MAIN_TO_WORKLET.pause]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('stale engine start while stopped'));
  });

  it('falls back to stopped when the start path gives up', async () => {
    const f = setup(['failed']);
    await f.engine.play();
    expect(f.engine.transport.phase).toBe('stopped');
    await f.engine.play(); // and play is a retry
    expect(f.start).toHaveBeenCalledTimes(2);
    expect(f.engine.transport.phase).toBe('loading');
  });

  it('ignores play while a start is already in flight', async () => {
    const f = setup();
    await f.engine.play();
    await f.engine.play();
    expect(f.start).toHaveBeenCalledTimes(1);
  });

  it('recovers a worklet fault: faulted → recovering → playing, or the ScriptProcessor fallback', async () => {
    const f = setup();
    await playing(f);
    const phases: string[] = [];
    f.engine.transport.subscribe((t) => phases.push(t.to));
    f.fault();
    expect(f.engine.transport.phase).toBe('recovering');
    expect(f.engine.getSnapshot().isPlaying).toBe(false);
    f.calls[0]!.refs.playbackEngineRef.current = 'scriptprocessor'; // the restart faulted too
    f.ack();
    expect(phases).toEqual(['faulted', 'recovering', 'spFallback']);
    expect(f.engine.getSnapshot().isPlaying).toBe(true);
  });

  it('keeps a paused transport paused through a background fault (#456)', async () => {
    const f = setup();
    await playing(f);
    f.engine.pause();
    f.fault();
    expect(f.engine.getSnapshot().transportState).toBe('paused');
  });

  it('cues a module load under a paused transport: the engine reloads, the transport stays paused', async () => {
    const f = setup();
    await playing(f);
    f.engine.pause();
    await f.engine.play({ forceModuleLoad: true });
    expect(f.start).toHaveBeenCalledTimes(2);
    expect(f.calls[1]!.config.forceModuleLoad).toBe(true);
    expect(f.engine.transport.phase).toBe('paused');
  });

  it('hands the start path live config: a loop toggle during playback reaches the `ended` handler', async () => {
    const f = setup();
    await playing(f);
    const { config } = f.calls[0]!;
    expect(config.isLooping).toBe(true);
    f.engine.dispatch({ type: 'toggleLoop' });
    expect(config.isLooping).toBe(false);
    f.engine.dispatch({ type: 'setVolume', value: 0.25 });
    expect(config.volume).toBe(0.25);
  });

  it('owns master volume / pan / mute: clamped, in the snapshot and on the master nodes only', async () => {
    const f = setup();
    await playing(f);
    f.engine.dispatch({ type: 'setVolume', value: 1.7 });
    expect(f.engine.getSnapshot().volume).toBe(1);
    f.engine.dispatch({ type: 'nudgeVolume', delta: -0.25 });
    expect(f.gain.gain.value).toBeCloseTo(0.75);
    f.engine.dispatch({ type: 'toggleMute' });
    expect(f.engine.getSnapshot()).toMatchObject({ isMuted: true, volume: 0 });
    expect(f.gain.gain.value).toBe(0);
    f.engine.dispatch({ type: 'toggleMute' });
    expect(f.engine.getSnapshot()).toMatchObject({ isMuted: false, volume: 0.75 });
    f.engine.dispatch({ type: 'setPan', value: -4 });
    expect(f.engine.getSnapshot().pan).toBe(-1);
    expect(f.panner.pan.value).toBe(-1);
  });

  it('seeks by row and by order in global steps, across patterns of different lengths', async () => {
    const f = setup();
    await playing(f);
    const seeks = () => f.sent().filter((m) => m.type === MAIN_TO_WORKLET.seek).map((m) => [m.order, m.row]);
    // Playhead at order 1 (32 rows), row 10.
    f.engine.playbackStateRef.current = { ...f.engine.playbackStateRef.current, currentOrder: 1, playheadRow: 10 };
    f.engine.dispatch({ type: 'seekRows', delta: 1 });
    f.engine.dispatch({ type: 'seekRows', delta: -1 });
    f.engine.dispatch({ type: 'seekOrders', delta: 1 });
    f.engine.dispatch({ type: 'jumpToOrder', order: 99 }); // clamped to the last order
    f.engine.dispatch({ type: 'jumpToOrder', order: 0 });
    expect(seeks()).toEqual([[1, 11], [1, 10], [2, 0], [2, 0], [0, 0]]);
  });

  it('notifies subscribers once per microtask, however many fields changed', async () => {
    const f = setup();
    const listener = vi.fn();
    f.engine.subscribe(listener);
    const before = f.engine.getSnapshot();
    f.engine.dispatch({ type: 'setVolume', value: 0.1 });
    f.engine.dispatch({ type: 'setPan', value: 0.5 });
    f.engine.dispatch({ type: 'toggleLoop' });
    expect(listener).not.toHaveBeenCalled();
    expect(f.engine.getSnapshot()).not.toBe(before);
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
    // A write that changes nothing keeps the same snapshot and notifies no one.
    const settled = f.engine.getSnapshot();
    f.engine.dispatch({ type: 'setVolume', value: 0.1 });
    await Promise.resolve();
    expect(f.engine.getSnapshot()).toBe(settled);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('throws on an illegal transport transition (strict engines: dev builds and tests)', () => {
    const engine = new PlayerEngine({ strictTransport: true, startAudioPlayback: vi.fn() });
    expect(() => engine.transport.send('pause')).toThrow(/'pause' is not legal from 'idle'/);
    // ...while the user-facing commands check first and simply do nothing.
    expect(() => engine.dispatch({ type: 'pause' })).not.toThrow();
    expect(() => engine.dispatch({ type: 'stop' })).not.toThrow();
  });
});
