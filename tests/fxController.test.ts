/**
 * Live FX rack controller + lazy bootstrap (#453), with FxRack faked so the
 * test sees exactly what the controller decides: build per context, attach
 * then apply once a module is on, collapse once everything is off and quiet,
 * rebuild on a new context, and load nothing until something is enabled.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FxRackState } from '../audio/fx/types';

interface Applied {
  state: FxRackState;
  opts: { at?: number } | undefined;
}

const racks: FakeRack[] = [];

class FakeRack {
  static create = vi.fn(async (ctx: unknown, _state: unknown, env: unknown) => {
    const rack = new FakeRack(ctx, env);
    racks.push(rack);
    return rack;
  });
  attached = false;
  quiet = false;
  collapses = 0;
  disposed = false;
  applied: Applied[] = [];
  unavailable = new Set<string>();
  constructor(
    readonly ctx: unknown,
    readonly env: unknown,
  ) {}
  get isAttached() {
    return this.attached;
  }
  attach() {
    this.attached = true;
    return { start: 0.005, end: 0.015 };
  }
  collapse() {
    this.collapses++;
    this.attached = false;
    return { start: 0.005, end: 0.015 };
  }
  apply(state: Applied['state'], opts?: Applied['opts']) {
    this.applied.push({ state, opts });
    return Promise.resolve();
  }
  isQuiet() {
    return this.quiet;
  }
  latencySeconds() {
    return 0;
  }
  tailSeconds() {
    return 0;
  }
  dispose() {
    this.disposed = true;
  }
}

vi.mock('../audio/fx/FxRack', () => ({ FxRack: FakeRack }));

function installMemoryLocalStorage(): void {
  const store = new Map<string, string>();
  const memory = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  Object.defineProperty(globalThis, 'localStorage', { value: memory, configurable: true, writable: true });
  Object.defineProperty(window, 'localStorage', { value: memory, configurable: true, writable: true });
  if (typeof window.dispatchEvent !== 'function') {
    Object.defineProperty(window, 'dispatchEvent', { value: () => true, configurable: true });
  }
  if (typeof globalThis.StorageEvent !== 'function') {
    (globalThis as unknown as { StorageEvent: unknown }).StorageEvent = class {};
  }
}

function fakeHost(label: string) {
  return {
    ctx: { currentTime: 0, state: 'running', label } as unknown as BaseAudioContext,
    masterInput: { label: `${label}:in` } as unknown as GainNode,
    masterDirect: { label: `${label}:direct` } as unknown as GainNode,
    analyser: { label: `${label}:analyser` } as unknown as AnalyserNode,
  };
}

async function setup() {
  vi.resetModules();
  racks.length = 0;
  FakeRack.create.mockClear();
  const store = await import('../store/fxStore');
  const host = await import('../audio/fx/fxHost');
  const controller = await import('../audio/fx/fxRackController');
  const bootstrap = await import('../audio/fx/fxBootstrap');
  return { useFxStore: store.useFxStore, ...host, ...controller, ...bootstrap };
}

beforeEach(() => {
  installMemoryLocalStorage();
});

afterEach(async () => {
  const { stopFxRackController } = await import('../audio/fx/fxRackController');
  stopFxRackController();
});

describe('FX rack controller (#453)', () => {
  it('waits for a context, then builds bypassed, attaches, and applies after the attach fade', async () => {
    const { useFxStore, publishFxHost, startFxRackController } = await setup();
    startFxRackController();
    useFxStore.getState().setModuleEnabled('eq', true);
    await new Promise((r) => setTimeout(r, 10));
    expect(FakeRack.create).not.toHaveBeenCalled(); // no context before the first play

    publishFxHost(fakeHost('a'));
    await vi.waitFor(() => expect(racks[0]?.applied.length).toBe(1));
    const rack = racks[0]!;
    const [, initial] = FakeRack.create.mock.calls[0]!;
    expect((initial as Applied['state']).modules.eq.enabled).toBe(false); // built bypassed
    expect(rack.attached).toBe(true);
    expect(rack.applied[0]!.state.modules.eq.enabled).toBe(true);
    expect(rack.applied[0]!.opts?.at).toBe(0.015); // after the attach fade
    expect(useFxStore.getState().rackStatus).toBe('ready');
  });

  it('collapses only once everything is off and the tails are done', async () => {
    const { useFxStore, publishFxHost, startFxRackController } = await setup();
    startFxRackController();
    publishFxHost(fakeHost('a'));
    useFxStore.getState().setModuleEnabled('comp', true);
    await vi.waitFor(() => expect(racks[0]?.attached).toBe(true));
    const rack = racks[0]!;

    useFxStore.getState().setModuleEnabled('comp', false);
    await vi.waitFor(() => expect(rack.applied.at(-1)!.state.modules.comp.enabled).toBe(false));
    await new Promise((r) => setTimeout(r, 450));
    expect(rack.collapses).toBe(0); // tails still ringing
    rack.quiet = true;
    await vi.waitFor(() => expect(rack.collapses).toBe(1), { timeout: 2000 });
  });

  it('re-enabling before the collapse keeps the rack attached', async () => {
    const { useFxStore, publishFxHost, startFxRackController } = await setup();
    startFxRackController();
    publishFxHost(fakeHost('a'));
    useFxStore.getState().setModuleEnabled('eq', true);
    await vi.waitFor(() => expect(racks[0]?.attached).toBe(true));
    const rack = racks[0]!;
    rack.quiet = true;
    useFxStore.getState().setModuleEnabled('eq', false);
    await vi.waitFor(() => expect(rack.applied.at(-1)!.state.modules.eq.enabled).toBe(false));
    useFxStore.getState().setModuleEnabled('eq', true);
    await vi.waitFor(() => expect(rack.applied.at(-1)!.state.modules.eq.enabled).toBe(true));
    await new Promise((r) => setTimeout(r, 450));
    expect(rack.collapses).toBe(0);
    expect(rack.attached).toBe(true);
  });

  it('rebuilds the rack on a new context and disposes it on teardown', async () => {
    const { useFxStore, publishFxHost, startFxRackController } = await setup();
    startFxRackController();
    useFxStore.getState().setModuleEnabled('character', true);
    publishFxHost(fakeHost('a'));
    await vi.waitFor(() => expect(racks[0]?.attached).toBe(true));
    publishFxHost(fakeHost('b'));
    await vi.waitFor(() => expect(racks[1]?.attached).toBe(true));
    expect(racks[0]!.disposed).toBe(true);
    expect(racks[1]!.ctx).not.toBe(racks[0]!.ctx);
    publishFxHost(null);
    expect(racks[1]!.disposed).toBe(true);
  });

  it('builds nothing while every module is off', async () => {
    const { publishFxHost, startFxRackController } = await setup();
    startFxRackController();
    publishFxHost(fakeHost('a'));
    await new Promise((r) => setTimeout(r, 20));
    expect(FakeRack.create).not.toHaveBeenCalled();
  });
});

describe('FX bootstrap (#453)', () => {
  it('loads the controller only once a module is enabled (incl. persisted state)', async () => {
    const { useFxStore, publishFxHost, startFxBootstrap } = await setup();
    const stop = startFxBootstrap();
    publishFxHost(fakeHost('a'));
    await new Promise((r) => setTimeout(r, 20));
    expect(FakeRack.create).not.toHaveBeenCalled();
    expect(useFxStore.getState().rackStatus).toBe('unloaded');

    useFxStore.getState().setModuleEnabled('eq', true);
    await vi.waitFor(() => expect(racks[0]?.attached).toBe(true));
    stop();
  });
});
