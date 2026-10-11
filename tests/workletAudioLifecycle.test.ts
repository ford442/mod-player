import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { readLibOpenMPTSources, readTransportActionsSource } from './helpers/libOpenMPTSource';
import { readAudioGraphSources } from './helpers/audioGraphSource';
import {
  canReuseWorkletNode,
  getStopMusicWorkletActions,
  planJsWorkletHotReloadPlay,
  shouldAcceptWorkletLoadedAck,
  shouldDisconnectWorkletOnPlay,
  shouldForceWorkletModuleLoad,
  shouldPostInitLib,
  shouldReportWorkletPosition,
  shouldFillNativePosition,
  shouldReloadNativeModule,
  nativeModuleFingerprint,
  WORKLET_POSITION_REPORT_INTERVAL_SEC,
} from '../utils/workletAudioLifecycle';
import { ensureSharedLib, type SharedLibHolder } from '../audio-worklet/libSingleton';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

interface FakeLib { _openmpt_module_create_from_memory2?: unknown }

function mockLib(): FakeLib {
  return { _openmpt_module_create_from_memory2: () => 1 };
}

/** Smallest thing with the \0asm magic — the singleton only checks the header, never instantiates. */
const WASM_BYTES = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

describe('workletAudioLifecycle (#329 hot reload)', () => {
  it('reuses worklet node when JS engine is loaded and node exists', () => {
    expect(
      canReuseWorkletNode({
        activeEngine: 'worklet',
        workletLoaded: true,
        hasWorkletNode: true,
      }),
    ).toBe(true);
  });

  it('does not reuse when engine is native-worklet', () => {
    expect(
      canReuseWorkletNode({
        activeEngine: 'native-worklet',
        workletLoaded: true,
        hasWorkletNode: true,
      }),
    ).toBe(false);
  });

  it('does not post initLib on hot reload', () => {
    expect(shouldPostInitLib(true, 'glue-js-text')).toBe(false);
  });

  it('posts initLib only on first node / cold start', () => {
    expect(shouldPostInitLib(false, 'glue-js-text')).toBe(true);
    expect(shouldPostInitLib(false, '')).toBe(false);
    expect(shouldPostInitLib(false, null)).toBe(false);
  });

  it('disconnects stale node when reuse is impossible', () => {
    expect(shouldDisconnectWorkletOnPlay(true, false)).toBe(true);
    expect(shouldDisconnectWorkletOnPlay(true, true)).toBe(false);
    expect(shouldDisconnectWorkletOnPlay(false, false)).toBe(false);
  });
});

describe('workletAudioLifecycle (#330 AudioContext keep-alive)', () => {
  it('never suspends AudioContext on normal stop', () => {
    const actions = getStopMusicWorkletActions(false, true);
    expect(actions.suspendAudioContext).toBe(false);
    expect(actions.pauseProcessor).toBe(true);
    expect(actions.disconnectNode).toBe(false);
    expect(actions.clearNodeRef).toBe(false);
  });

  it('never suspends AudioContext even on destroy teardown', () => {
    const actions = getStopMusicWorkletActions(true, true);
    expect(actions.suspendAudioContext).toBe(false);
    expect(actions.disconnectNode).toBe(true);
    expect(actions.clearNodeRef).toBe(true);
  });
});

describe('ensureSharedLib (#329 shared-scope init) — the code the worklet bundle runs', () => {
  // Previously these tests ran a hand-copied mirror in utils/workletLibSingleton.ts that lacked the
  // real function's glue evaluation, polyfills and runtime wait. The policy is now one shared module
  // (audio-worklet/libSingleton.ts, bundled into openmpt-worklet.js); only `bootstrap` is host-specific.
  const run = (
    holder: SharedLibHolder<FakeLib>,
    bootstrap: (script: string, bytes: ArrayBuffer | Uint8Array) => Promise<FakeLib>,
    script: string | undefined = 'glue',
    bytes: ArrayBuffer | Uint8Array | null | undefined = WASM_BYTES,
    log?: (...args: unknown[]) => void,
  ) => ensureSharedLib<FakeLib>(holder, script, bytes, { bootstrap, ...(log ? { log } : {}) });

  it('evaluates glue only once across repeated calls', async () => {
    const holder: SharedLibHolder<FakeLib> = {};
    let bootstraps = 0;
    const bootstrap = async () => { bootstraps += 1; return mockLib(); };

    await run(holder, bootstrap, 'glue');
    await run(holder, bootstrap, 'other-glue');

    expect(bootstraps).toBe(1);
    expect(holder.__openmptWorkletLib).toBeDefined();
  });

  it('shares one init promise for concurrent callers', async () => {
    const holder: SharedLibHolder<FakeLib> = {};
    let bootstraps = 0;
    const bootstrap = async () => {
      bootstraps += 1;
      await new Promise((r) => setTimeout(r, 5));
      return mockLib();
    };

    const [a, b] = await Promise.all([run(holder, bootstrap), run(holder, bootstrap)]);

    expect(bootstraps).toBe(1);
    expect(a).toBe(b);
  });

  it('hands bootstrap the script text and the real wasm bytes', async () => {
    const holder: SharedLibHolder<FakeLib> = {};
    let seen: [string, unknown] | undefined;
    await run(holder, async (script, bytes) => { seen = [script, bytes]; return mockLib(); }, 'the-glue');
    expect(seen).toEqual(['the-glue', WASM_BYTES]);
    expect(seen?.[1]).toBe(WASM_BYTES);
  });

  it('publishes the instance only after bootstrap resolves, never a half-initialised one', async () => {
    const holder: SharedLibHolder<FakeLib> = {};
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const pending = run(holder, async () => { await gate; return mockLib(); });

    expect(holder.__openmptWorkletLib).toBeUndefined();
    expect(holder.__openmptWorkletLibInitPromise).toBeDefined();
    release();
    const lib = await pending;
    expect(holder.__openmptWorkletLib).toBe(lib);
  });

  it('requires real wasm bytes — there is no wasm2js (JS-only) init path', async () => {
    let bootstraps = 0;
    const bootstrap = async () => { bootstraps += 1; return mockLib(); };

    await expect(run({}, bootstrap, 'glue', null)).rejects.toThrow(/missing wasmBytes/);
    await expect(run({}, bootstrap, 'glue', new Uint8Array(0))).rejects.toThrow(/missing wasmBytes/);
    expect(bootstraps).toBe(0);
  });

  it('requires the glue script text', async () => {
    let bootstraps = 0;
    await expect(
      run({}, async () => { bootstraps += 1; return mockLib(); }, ''),
    ).rejects.toThrow(/missing scriptText/);
    expect(bootstraps).toBe(0);
  });

  it('rejects wasmBytes without the \\0asm magic (e.g. an HTML 404 body)', async () => {
    const html = new TextEncoder().encode('<!doctype html><title>404</title>');
    let bootstraps = 0;
    await expect(
      run({}, async () => { bootstraps += 1; return mockLib(); }, 'glue', html),
    ).rejects.toThrow(/missing \\0asm magic/);
    expect(bootstraps).toBe(0);
  });

  it('reuses an existing lib without bootstrapping, and says so', async () => {
    const lib = mockLib();
    const holder: SharedLibHolder<FakeLib> = { __openmptWorkletLib: lib };
    const log = vi.fn();
    let bootstraps = 0;

    // Nothing needs to be valid on the reuse path: a second node attaches without initLib data.
    const result = await run(holder, async () => { bootstraps += 1; return mockLib(); }, '', null, log);

    expect(bootstraps).toBe(0);
    expect(result).toBe(lib);
    expect(log).toHaveBeenCalledWith('Reusing shared libopenmpt instance');
  });

  it('does not treat a lib whose exports are still lazy stubs as ready', async () => {
    // The glue defines `_openmpt_*` lazily at eval time, so a present-but-not-a-function export means
    // the runtime has not finished initialising.
    const holder: SharedLibHolder<FakeLib> = { __openmptWorkletLib: { _openmpt_module_create_from_memory2: undefined } };
    let bootstraps = 0;
    const ready = mockLib();
    const result = await run(holder, async () => { bootstraps += 1; return ready; });
    expect(bootstraps).toBe(1);
    expect(result).toBe(ready);
  });

  it('a failed init rejects every waiting caller and stays cached (a retry needs a fresh scope)', async () => {
    // Existing behaviour, pinned rather than changed here: the rejected promise is kept in the holder.
    const holder: SharedLibHolder<FakeLib> = {};
    let bootstraps = 0;
    const failing = async () => { bootstraps += 1; throw new Error('runtime init timeout'); };

    const results = await Promise.allSettled([run(holder, failing), run(holder, failing)]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    await expect(run(holder, async () => mockLib())).rejects.toThrow('runtime init timeout');
    expect(bootstraps).toBe(1);
  });
});

describe('audio hook source invariants', () => {
  const useLibOpenMPT = readLibOpenMPTSources(ROOT);
  const transportActions = readTransportActionsSource(ROOT);
  const useAudioGraph = readAudioGraphSources(ROOT);
  const workletSource = readFileSync(join(ROOT, 'public/worklets/openmpt-worklet.js'), 'utf8');

  it('stopMusic does not call audioContext.suspend()', () => {
    const fnMatch = transportActions.match(/export function createStopMusic[\s\S]*?^}/m);
    expect(fnMatch, 'createStopMusic should exist').toBeTruthy();
    const body = fnMatch![0];
    expect(body).not.toMatch(/audioContextRef\.current\.suspend\(/);
    expect(body).not.toMatch(/audioCtx\.suspend\(/);
    expect(body).toContain('getStopMusicWorkletActions');
    expect(useLibOpenMPT).toContain('createStopMusic');
  });

  it('play path gates initLib via shouldPostInitLib / reuse helper', () => {
    expect(useAudioGraph).toContain('shouldPostInitLib');
    expect(useAudioGraph).toContain('canReuseWorkletNode');
    expect(useAudioGraph).not.toMatch(/if\s*\(\s*!canReuseWorkletNode\s*&&\s*libJsText\s*\)/);
  });

  it('worklet source keeps shared-scope singleton guard', () => {
    expect(workletSource).toContain('function ensureSharedLibOpenMPT');
    expect(workletSource).toContain('__openmptWorkletLib');
    expect(workletSource).toContain('__openmptWorkletLibInitPromise');
    expect(workletSource).toContain('Reusing shared libopenmpt instance');
    expect(workletSource).toContain('Attached to pre-initialised shared libopenmpt');
  });

  it('worklet throttles position postMessage to ~60 Hz', () => {
    expect(workletSource).toContain('positionReportInterval');
    expect(workletSource).toContain('lastPositionReportTime');
    expect(workletSource).toMatch(/lastPositionReportTime\s*=\s*currentTime/);
  });

  it('play path skips disconnect on hot reload', () => {
    const jsDispatch = readFileSync(join(ROOT, 'audio-worklet/jsWorkletDispatch.ts'), 'utf8');
    expect(useAudioGraph).toContain('Hot reload — keeping existing worklet wiring');
    expect(useAudioGraph).toContain('wireMasterOutput');
    expect(useAudioGraph).toContain('forceModuleLoad');
    expect(useAudioGraph).toContain('workletModuleTokenRef');
    expect(useAudioGraph).toContain('shouldForceWorkletModuleLoad');
    expect(jsDispatch).toContain('shouldAcceptWorkletLoadedAck');
  });

  it('native pause silences render without AudioContext.suspend', () => {
    const cpp = readFileSync(join(ROOT, 'cpp/worklet_processor.cpp'), 'utf8');
    const suspendIdx = cpp.indexOf('void suspend_audio()');
    expect(suspendIdx).toBeGreaterThan(0);
    const suspendBody = cpp.slice(suspendIdx, suspendIdx + 280);
    expect(suspendBody).toContain('g_paused');
    expect(suspendBody).not.toMatch(/ctx\.suspend/);
    const engine = readFileSync(join(ROOT, 'audio-worklet/OpenMPTWorkletEngine.ts'), 'utf8');
    const initMatch = engine.match(/async init\([\s\S]*?async attachAudioContext/);
    expect(initMatch?.[0]).not.toContain('_init_audio(');
    expect(engine).toContain('_init_audio_with_context');
    expect(useAudioGraph).toContain('attachAudioContext');
    expect(useAudioGraph).toContain('broadcastPcmBlock');
  });
});

describe('workletAudioLifecycle (#354 pure helpers smoke)', () => {
  it('position throttle helper matches 1/60 s cadence', () => {
    expect(WORKLET_POSITION_REPORT_INTERVAL_SEC).toBeCloseTo(1 / 60, 12);
    expect(shouldReportWorkletPosition(0, Number.NEGATIVE_INFINITY)).toBe(true);
    expect(shouldReportWorkletPosition(0.001, 0)).toBe(false);
    expect(shouldFillNativePosition(0, Number.NEGATIVE_INFINITY)).toBe(true);
    expect(shouldFillNativePosition(0.001, 0)).toBe(false);
    expect(shouldFillNativePosition(1 / 60, 0)).toBe(true);
  });

  it('native fingerprint skip avoids a second parse of the same bytes', () => {
    const a = new Uint8Array([1, 2, 3, 4, 5]).buffer;
    const b = new Uint8Array([1, 2, 3, 4, 5]).buffer;
    const c = new Uint8Array([9, 2, 3, 4, 5]).buffer;
    const fp = nativeModuleFingerprint(a);
    expect(shouldReloadNativeModule(null, a)).toBe(true);
    expect(shouldReloadNativeModule(fp, b)).toBe(false);
    expect(shouldReloadNativeModule(fp, c)).toBe(true);
  });

  it('loaded-ack helper drops mismatched tokens', () => {
    expect(shouldAcceptWorkletLoadedAck(2, 1)).toBe(false);
    expect(shouldAcceptWorkletLoadedAck(2, 2)).toBe(true);
    expect(shouldForceWorkletModuleLoad(2, 1)).toBe(true);
    expect(shouldForceWorkletModuleLoad(1, 1, true)).toBe(true);
    expect(shouldForceWorkletModuleLoad(1, 1, false)).toBe(false);
  });

  it('hot-reload plan reuses node without disconnect or re-initLib', () => {
    const plan = planJsWorkletHotReloadPlay({
      activeEngine: 'worklet',
      workletLoaded: true,
      hasWorkletNode: true,
      libJsText: 'glue',
      moduleToken: 2,
      lastSentToken: 1,
      forceModuleLoad: true,
    });
    expect(plan.reuseNode).toBe(true);
    expect(plan.disconnectNode).toBe(false);
    expect(plan.postInitLib).toBe(false);
    expect(plan.postModuleLoad).toBe(true);
  });
});
