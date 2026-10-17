/**
 * Output-device selection (#492 Phase 3). The PlayerEngine routes playback with `setSinkId()` on the
 * ONE AudioContext (pitfall 12): before the first play it only remembers the choice, and the start
 * path applies it to the context it creates — after resume, before any engine is connected. A refused
 * switch keeps the previous device; the browser moving the output (`sinkchange`), a device vanishing
 * (`devicechange`, `error`) and a stale saved id all end on a device that exists, with the UI told why.
 *
 * Headless: a fake AudioContext with setSinkId is installed as the global constructor, so contexts
 * really come from utils/audioContextFactory.ts and its construction count is the pitfall-12 check.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerEngine, type StartAudioPlayback } from '../audio/engine/PlayerEngine';
import {
  describeSinkError,
  SINK_UNSUPPORTED_MESSAGE,
  type OutputDeviceEnv,
} from '../audio/engine/outputDevice';
import { createEngineRefs } from '../audio/engine/engineRefs';
import { TransportMachine } from '../audio/engine/transport';
import type { AudioGraphCallbacks, AudioGraphConfig } from '../hooks/audioGraph/types';
import type { LibOpenMPT } from '../types';
import {
  __resetSharedPlayerAudioContextForTests,
  createPlayerAudioContext,
  getPlayerAudioContextConstructionCount,
  readAudioSinkId,
} from '../utils/audioContextFactory';
import {
  listAudioOutputDevices,
  OUTPUT_DEVICE_STORAGE_KEY,
  readStoredOutputDevice,
  writeStoredOutputDevice,
  type AudioOutputList,
  type StoredOutputDevice,
} from '../utils/audioOutputDevices';

const events: string[] = [];

/** A Chromium-like context: `setSinkId` resolves for known devices and fires `sinkchange` first. */
class FakeSinkContext extends EventTarget {
  static devices = new Set(['', 'usb-dac', 'hdmi']);
  state: AudioContextState = 'suspended';
  currentTime = 5;
  sampleRate = 48000;
  baseLatency = 0.01;
  outputLatency = 0.02;
  sinkId = '';
  onstatechange: (() => void) | null = null;
  readonly sinkCalls: string[] = [];
  readonly suspend = vi.fn(() => Promise.resolve());
  readonly close = vi.fn(() => {
    this.state = 'closed';
    return Promise.resolve();
  });

  constructor(readonly options?: AudioContextOptions) {
    super();
  }

  resume(): Promise<void> {
    events.push('resume');
    this.state = 'running';
    return Promise.resolve();
  }

  setSinkId(id: string): Promise<void> {
    this.sinkCalls.push(id);
    events.push(`setSinkId:${id}`);
    if (!FakeSinkContext.devices.has(id)) {
      return Promise.reject(new DOMException(`the device ${id} is not found`, 'NotFoundError'));
    }
    this.sinkId = id;
    this.dispatchEvent(new Event('sinkchange'));
    return Promise.resolve();
  }

  /** The browser moved the output by itself (e.g. its own fallback). */
  browserMovesTo(id: string): void {
    this.sinkId = id;
    this.dispatchEvent(new Event('sinkchange'));
  }
}

function memoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  };
}

interface FakeEnv extends OutputDeviceEnv {
  outputs: AudioOutputList;
  saved: StoredOutputDevice | null;
  writes: (StoredOutputDevice | null)[];
  deviceChange(): Promise<void>;
}

function fakeEnv(saved: StoredOutputDevice | null = null, supported = true): FakeEnv {
  const deviceEvents = new EventTarget();
  const env: FakeEnv = {
    supported,
    saved,
    writes: [],
    outputs: {
      devices: [{ deviceId: 'usb-dac', label: 'USB DAC' }, { deviceId: 'hdmi', label: 'HDMI' }],
      defaultLabel: 'Speakers',
      hidden: false,
    },
    storage: {
      read: () => env.saved,
      write: (device) => {
        env.saved = device;
        env.writes.push(device);
      },
    },
    deviceEvents,
    listOutputs: () => Promise.resolve(env.outputs),
    async deviceChange() {
      deviceEvents.dispatchEvent(new Event('devicechange'));
      await settle(); // listOutputs → setSinkId → report
    },
  };
  return env;
}

/** Let promise chains started by an event handler run to the end. */
const settle = () => new Promise<void>((resolve) => { setTimeout(resolve, 0); });

function makeNode() {
  return {
    port: { postMessage: vi.fn(), onmessage: null as unknown, addEventListener: vi.fn(), removeEventListener: vi.fn() },
    onprocessorerror: null as unknown,
    disconnect: vi.fn(),
  };
}

/**
 * An engine with a module installed, on a fake start path that handles the context exactly like
 * startAudioPlayback (hooks/useAudioGraph.ts): acquire through the factory, resume, let the engine
 * prepare it, then connect an engine. `sinksAtConnect` records the device each engine started on.
 */
function setup(env = fakeEnv()) {
  const node = makeNode();
  const sinksAtConnect: string[] = [];
  let callbacks: AudioGraphCallbacks | null = null;
  const start = vi.fn<StartAudioPlayback>(async (refs, cb) => {
    callbacks = cb;
    if (!refs.audioContextRef.current) refs.audioContextRef.current = createPlayerAudioContext();
    const ctx = refs.audioContextRef.current;
    if (ctx.state === 'suspended') await ctx.resume();
    const preparing = cb.prepareAudioContext?.(ctx);
    if (preparing) await preparing;
    refs.audioClockStartRef.current = ctx.currentTime;
    events.push(`connect:${readAudioSinkId(ctx)}`);
    sinksAtConnect.push(readAudioSinkId(ctx));
    refs.audioWorkletNodeRef.current = node as unknown as AudioWorkletNode;
    refs.playbackEngineRef.current = 'worklet';
    return 'pending';
  });
  const engine = new PlayerEngine({ strictTransport: true, startAudioPlayback: start, outputDeviceEnv: env });
  engine.transport.send('load');
  engine.transport.send('parsed', 'ready');
  const ctx = () => engine.getAudioContext() as unknown as FakeSinkContext;
  const play = async () => {
    await engine.play();
    callbacks!.setIsPlaying(true); // the worklet's `loaded` ack
  };
  return { engine, env, start, ctx, play, sinksAtConnect, snap: () => engine.getSnapshot() };
}

describe('output device (PlayerEngine + setSinkId on the one AudioContext)', () => {
  beforeEach(() => {
    events.length = 0;
    FakeSinkContext.devices = new Set(['', 'usb-dac', 'hdmi']);
    __resetSharedPlayerAudioContextForTests();
    vi.stubGlobal('AudioContext', FakeSinkContext);
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 7));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    __resetSharedPlayerAudioContextForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('before the first play: remembers the choice, and the start path opens the new context on it', async () => {
    const f = setup();
    expect(f.engine.getAudioContext()).toBeNull();
    await expect(f.engine.setOutputDevice('usb-dac', 'USB DAC')).resolves.toBe(true);
    expect(f.snap()).toMatchObject({ outputDeviceId: 'usb-dac', outputDeviceLabel: 'USB DAC', sinkError: null });
    expect(f.env.saved).toEqual({ deviceId: 'usb-dac', label: 'USB DAC' });

    await f.play();
    expect(getPlayerAudioContextConstructionCount()).toBe(1);
    // Constructed on the default output (never the constructor's sinkId), moved before any engine connected.
    expect(f.ctx().options).not.toHaveProperty('sinkId');
    expect(events).toEqual(['resume', 'setSinkId:usb-dac', 'connect:usb-dac']);
    expect(f.snap()).toMatchObject({ outputDeviceId: 'usb-dac', outputDeviceSwitching: false, isPlaying: true });
  });

  it('while playing: switches the SAME context (no new context, no suspend / close) and keeps playing', async () => {
    const f = setup();
    await f.play();
    const ctx = f.ctx();
    expect(f.snap().outputDeviceId).toBe('');

    await expect(f.engine.setOutputDevice('hdmi', 'HDMI')).resolves.toBe(true);
    expect(f.engine.getAudioContext()).toBe(ctx);
    expect(getPlayerAudioContextConstructionCount()).toBe(1);
    expect(ctx.sinkCalls).toEqual(['hdmi']);
    expect(ctx.suspend).not.toHaveBeenCalled();
    expect(ctx.close).not.toHaveBeenCalled();
    expect(f.snap()).toMatchObject({
      outputDeviceId: 'hdmi', outputDeviceLabel: 'HDMI', outputDeviceSwitching: false, sinkError: null,
      phase: 'playing', isPlaying: true,
    });
    expect(f.env.saved).toEqual({ deviceId: 'hdmi', label: 'HDMI' });

    // Back to the default ('default' is Chromium's alias for it): forgets the saved device.
    await expect(f.engine.setOutputDevice('default')).resolves.toBe(true);
    expect(ctx.sinkCalls).toEqual(['hdmi', '']);
    expect(f.snap().outputDeviceId).toBe('');
    expect(f.env.saved).toBeNull();
    expect(f.start).toHaveBeenCalledTimes(1); // the engine was never restarted
  });

  it('marks the switch in flight, so the picker can disable itself', async () => {
    const f = setup();
    await f.play();
    const pending = f.engine.setOutputDevice('hdmi', 'HDMI');
    expect(f.snap().outputDeviceSwitching).toBe(true);
    await pending;
    expect(f.snap().outputDeviceSwitching).toBe(false);
  });

  it('a refused setSinkId keeps the previous device, says why, and is not saved', async () => {
    const f = setup();
    await f.play();
    await f.engine.setOutputDevice('usb-dac', 'USB DAC');
    f.env.writes.length = 0;

    await expect(f.engine.setOutputDevice('bt-headphones', 'BT Headphones')).resolves.toBe(false);
    expect(f.ctx().sinkId).toBe('usb-dac');
    expect(f.snap()).toMatchObject({
      outputDeviceId: 'usb-dac',
      outputDeviceLabel: 'USB DAC',
      outputDeviceSwitching: false,
      sinkError: '“BT Headphones” is not available',
      isPlaying: true,
    });
    expect(f.env.writes).toEqual([]);
    expect(f.env.saved).toEqual({ deviceId: 'usb-dac', label: 'USB DAC' });

    // The next successful switch clears the notice.
    await f.engine.setOutputDevice('hdmi', 'HDMI');
    expect(f.snap().sinkError).toBeNull();
  });

  it('follows the browser moving the output (sinkchange), and re-anchors the playhead clock', async () => {
    const f = setup();
    await f.play();
    await f.engine.setOutputDevice('usb-dac', 'USB DAC');
    const ctx = f.ctx();
    ctx.currentTime = 42;

    ctx.browserMovesTo('');
    expect(f.snap()).toMatchObject({ outputDeviceId: '', outputDeviceLabel: '' });
    expect(f.snap().sinkError).toBe('The browser moved the output to the default output');
    // Drift detector re-anchored at the move (output latency belongs to the device).
    const refs = (f.engine as unknown as { refs: { audioClockStartRef: { current: number } } }).refs;
    expect(refs.audioClockStartRef.current).toBe(42);

    // …and back onto the chosen device: the notice goes away.
    ctx.browserMovesTo('usb-dac');
    expect(f.snap()).toMatchObject({ outputDeviceId: 'usb-dac', outputDeviceLabel: 'USB DAC', sinkError: null });
  });

  it('a sinkchange that arrives after setSinkId resolved does not overwrite the switch report', async () => {
    const f = setup();
    await f.play();
    await f.engine.setOutputDevice('usb-dac', 'USB DAC');
    const ctx = f.ctx();
    // A browser that resolves first and fires `sinkchange` in a later task.
    ctx.setSinkId = (id: string) => {
      ctx.sinkCalls.push(id);
      ctx.sinkId = id;
      setTimeout(() => ctx.dispatchEvent(new Event('sinkchange')), 0);
      return Promise.resolve();
    };
    FakeSinkContext.devices.delete('usb-dac');
    f.env.outputs = { ...f.env.outputs, devices: [{ deviceId: 'hdmi', label: 'HDMI' }] };
    await f.env.deviceChange();
    await settle();
    expect(f.snap()).toMatchObject({
      outputDeviceId: '',
      sinkError: '“USB DAC” disconnected — playing on the default output',
    });
  });

  it('restores the saved device at creation; a stale saved id plays on the default output with a notice', async () => {
    const ok = setup(fakeEnv({ deviceId: 'hdmi', label: 'HDMI' }));
    expect(ok.snap()).toMatchObject({ outputDeviceId: 'hdmi', outputDeviceLabel: 'HDMI' });
    await ok.play();
    expect(ok.sinksAtConnect).toEqual(['hdmi']);
    expect(ok.snap().sinkError).toBeNull();
    ok.engine.stop();

    __resetSharedPlayerAudioContextForTests();
    events.length = 0;
    const stale = setup(fakeEnv({ deviceId: 'unplugged-dac', label: 'Old DAC' }));
    await stale.play();
    expect(events).toEqual(['resume', 'setSinkId:unplugged-dac', 'connect:']);
    expect(stale.snap()).toMatchObject({
      outputDeviceId: '',
      sinkError: '“Old DAC” is not connected — playing on the default output',
      isPlaying: true,
    });
    // Still saved: it comes back when the device does (devicechange) or next session.
    expect(stale.env.saved).toEqual({ deviceId: 'unplugged-dac', label: 'Old DAC' });

    FakeSinkContext.devices.add('unplugged-dac');
    stale.env.outputs = { ...stale.env.outputs, devices: [{ deviceId: 'unplugged-dac', label: 'Old DAC' }] };
    await stale.env.deviceChange();
    expect(stale.snap()).toMatchObject({ outputDeviceId: 'unplugged-dac', sinkError: null });
  });

  it('falls back to the default output when the device it plays on disappears (devicechange)', async () => {
    const f = setup();
    await f.play();
    await f.engine.setOutputDevice('usb-dac', 'USB DAC');

    FakeSinkContext.devices.delete('usb-dac');
    f.env.outputs = { ...f.env.outputs, devices: [{ deviceId: 'hdmi', label: 'HDMI' }] };
    await f.env.deviceChange();
    expect(f.ctx().sinkId).toBe('');
    expect(f.snap()).toMatchObject({
      outputDeviceId: '',
      sinkError: '“USB DAC” disconnected — playing on the default output',
      isPlaying: true,
    });
    expect(f.env.saved).toEqual({ deviceId: 'usb-dac', label: 'USB DAC' });
    expect(getPlayerAudioContextConstructionCount()).toBe(1);
  });

  it('falls back to the default output when the context reports a device error', async () => {
    const f = setup();
    await f.play();
    await f.engine.setOutputDevice('hdmi', 'HDMI');
    f.ctx().dispatchEvent(new Event('error'));
    await settle();
    expect(f.ctx().sinkId).toBe('');
    expect(f.snap().sinkError).toBe('“HDMI” disconnected — playing on the default output');
  });

  it('where setSinkId does not exist: the picker is hidden and nothing is attempted', async () => {
    const f = setup(fakeEnv({ deviceId: 'hdmi', label: 'HDMI' }, false));
    expect(f.snap()).toMatchObject({ outputDeviceSupported: false, outputDeviceId: '' });
    await f.play();
    expect(f.ctx().sinkCalls).toEqual([]);
    await expect(f.engine.setOutputDevice('hdmi')).resolves.toBe(false);
    expect(f.snap().sinkError).toBe(SINK_UNSUPPORTED_MESSAGE);
  });

  it('describes refusals for the UI', () => {
    const notFound = new DOMException('x', 'NotFoundError');
    expect(describeSinkError(notFound, 'the saved output device', 'restore'))
      .toBe('The saved output device is not connected — playing on the default output');
    expect(describeSinkError(new DOMException('x', 'NotAllowedError'), '“A”', 'select')).toBe('Not allowed to play on “A”');
    expect(describeSinkError(new Error('boom'), '“A”', 'select')).toBe('Could not switch to “A”: boom');
  });
});

describe('the real start path (hooks/useAudioGraph.ts) prepares the context before any engine starts', () => {
  beforeEach(() => {
    events.length = 0;
    __resetSharedPlayerAudioContextForTests();
    vi.stubGlobal('AudioContext', FakeSinkContext);
    vi.stubGlobal('window', { ...globalThis.window, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), visibilityState: 'visible' });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });
  afterEach(() => {
    __resetSharedPlayerAudioContextForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.doUnmock('../hooks/audioGraph/startJsWorkletPlayback');
    vi.doUnmock('../hooks/audioGraph/masterGraph');
    vi.doUnmock('../audio-worklet/diagnostics');
    vi.resetModules();
  });

  it('resume → prepareAudioContext (setSinkId) → audio clock anchor → master nodes → engine', async () => {
    vi.resetModules();
    vi.doMock('../audio-worklet/diagnostics', () => ({ logWorkletDiagnostics: vi.fn() }));
    vi.doMock('../hooks/audioGraph/masterGraph', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../hooks/audioGraph/masterGraph')>()),
      ensureCommonMasterNodes: vi.fn(() => { events.push('masterNodes'); }),
    }));
    vi.doMock('../hooks/audioGraph/startJsWorkletPlayback', () => ({
      startJsWorkletPlayback: vi.fn(async (_refs: unknown, _cb: unknown, _cfg: unknown, ctx: AudioContext) => {
        events.push(`engine:${(ctx as unknown as FakeSinkContext).sinkId}`);
        return 'setup-complete';
      }),
    }));
    const factory = await import('../utils/audioContextFactory');
    const { startAudioPlayback } = await import('../hooks/useAudioGraph');

    const refs = createEngineRefs({ transport: new TransportMachine({ strict: true }), activeEngine: () => 'worklet' });
    refs.libopenmptRef.current = {} as LibOpenMPT;
    refs.fileDataRef.current = new Uint8Array([1, 2, 3, 4]);
    const callbacks: AudioGraphCallbacks = {
      setStatus: vi.fn(),
      setIsPlaying: vi.fn(),
      setActiveEngine: vi.fn(),
      setModuleInfo: vi.fn(),
      setSequencerMatrix: vi.fn(),
      stopMusic: vi.fn(),
      seekToStepWrapper: vi.fn(),
      updateUI: vi.fn(),
      prepareAudioContext: (ctx) => {
        events.push(`prepare:${ctx.state}`);
        return factory.switchPlayerAudioSink(ctx, 'usb-dac').then(() => {
          (ctx as unknown as FakeSinkContext).currentTime = 7;
        });
      },
    };
    const config: AudioGraphConfig = {
      activeEngine: 'worklet',
      isWorkletSupported: true,
      isNativeWorkletAvailable: false,
      panValue: 0,
      volume: 0.5,
      isLooping: true,
      WORKLET_URL: '/worklets/openmpt-worklet.js',
    };

    await expect(startAudioPlayback(refs, callbacks, config)).resolves.toBe('pending');
    expect(events).toEqual(['resume', 'prepare:running', 'setSinkId:usb-dac', 'masterNodes', 'engine:usb-dac']);
    // The clock is anchored after the switch, on the device that plays.
    expect(refs.audioClockStartRef.current).toBe(7);
    expect(factory.getPlayerAudioContextConstructionCount()).toBe(1);
  });
});

describe('saved output device (localStorage, per browser profile)', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { ...globalThis.window, localStorage: memoryStorage() });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips the choice; the default output (or its "default" alias) is stored as nothing', () => {
    expect(readStoredOutputDevice()).toBeNull();
    writeStoredOutputDevice({ deviceId: 'usb-dac', label: 'USB DAC' });
    expect(readStoredOutputDevice()).toEqual({ deviceId: 'usb-dac', label: 'USB DAC' });
    writeStoredOutputDevice({ deviceId: 'default', label: 'Default' });
    expect(window.localStorage.getItem(OUTPUT_DEVICE_STORAGE_KEY)).toBeNull();
    expect(readStoredOutputDevice()).toBeNull();
  });

  it('ignores an unreadable entry instead of failing playback', () => {
    window.localStorage.setItem(OUTPUT_DEVICE_STORAGE_KEY, '{not json');
    expect(readStoredOutputDevice()).toBeNull();
    window.localStorage.setItem(OUTPUT_DEVICE_STORAGE_KEY, JSON.stringify({ deviceId: 7 }));
    expect(readStoredOutputDevice()).toBeNull();
    window.localStorage.setItem(OUTPUT_DEVICE_STORAGE_KEY, JSON.stringify({ deviceId: 'hdmi' }));
    expect(readStoredOutputDevice()).toEqual({ deviceId: 'hdmi', label: '' });
  });

  it('a new engine reads the saved device as the one its context will open on', () => {
    writeStoredOutputDevice({ deviceId: 'gone', label: 'Gone DAC' });
    const engine = new PlayerEngine({
      outputDeviceEnv: {
        ...fakeEnv(),
        storage: { read: readStoredOutputDevice, write: writeStoredOutputDevice },
      },
    });
    expect(engine.getSnapshot()).toMatchObject({ outputDeviceId: 'gone', outputDeviceLabel: 'Gone DAC' });
  });
});

describe('listing outputs (enumerateDevices)', () => {
  const info = (kind: MediaDeviceKind, deviceId: string, label = '') =>
    ({ kind, deviceId, label, groupId: '' }) as MediaDeviceInfo;

  it('Chromium without permission: one anonymous output → nothing to list, more is hidden', async () => {
    const list = await listAudioOutputDevices({
      enumerateDevices: () => Promise.resolve([info('audioinput', ''), info('audiooutput', '')]),
    });
    expect(list).toEqual({ devices: [], defaultLabel: '', hidden: true });
  });

  it('with permission: the default entry names the default output, the rest are selectable', async () => {
    const list = await listAudioOutputDevices({
      enumerateDevices: () => Promise.resolve([
        info('audiooutput', 'default', 'Default - Speakers'),
        info('audiooutput', 'abc', 'USB DAC'),
        info('audiooutput', 'abc', 'USB DAC'),
        info('audiooutput', 'def', ''),
        info('audioinput', 'mic', 'Mic'),
      ]),
    });
    expect(list).toEqual({
      devices: [{ deviceId: 'abc', label: 'USB DAC' }, { deviceId: 'def', label: 'Output 2' }],
      defaultLabel: 'Default - Speakers',
      hidden: false,
    });
  });

  it('no mediaDevices (insecure context) or a throwing enumerateDevices → an empty list', async () => {
    expect(await listAudioOutputDevices(null)).toEqual({ devices: [], defaultLabel: '', hidden: false });
    expect(await listAudioOutputDevices({ enumerateDevices: () => Promise.reject(new Error('no')) }))
      .toEqual({ devices: [], defaultLabel: '', hidden: false });
  });
});
