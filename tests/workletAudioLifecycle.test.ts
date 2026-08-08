import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readLibOpenMPTSources, readTransportActionsSource } from './helpers/libOpenMPTSource';
import {
  canReuseWorkletNode,
  getStopMusicWorkletActions,
  planJsWorkletHotReloadPlay,
  shouldAcceptWorkletLoadedAck,
  shouldDisconnectWorkletOnPlay,
  shouldForceWorkletModuleLoad,
  shouldPostInitLib,
  shouldReportWorkletPosition,
  WORKLET_POSITION_REPORT_INTERVAL_SEC,
} from '../utils/workletAudioLifecycle';
import {
  ensureSharedLibOpenMPT,
  resetWorkletLibSingleton,
  type WorkletLibGlobals,
} from '../utils/workletLibSingleton';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function mockLib(): NonNullable<WorkletLibGlobals['__openmptWorkletLib']> {
  return { _openmpt_module_create_from_memory2: () => 1 };
}

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

describe('workletLibSingleton (#329 shared-scope init)', () => {
  it('evaluates glue only once across repeated ensureSharedLibOpenMPT calls', async () => {
    const globals: WorkletLibGlobals = {};
    let evalCount = 0;

    const evalScript = async () => {
      evalCount += 1;
      globals.__openmptWorkletLib = mockLib();
    };

    await ensureSharedLibOpenMPT(globals, 'fake-glue', null, evalScript);
    await ensureSharedLibOpenMPT(globals, 'other-glue', null, evalScript);

    expect(evalCount).toBe(1);
    expect(globals.__openmptWorkletLib).toBeDefined();
  });

  it('shares one init promise for concurrent callers', async () => {
    const globals: WorkletLibGlobals = {};
    let evalCount = 0;

    const evalScript = async () => {
      evalCount += 1;
      await new Promise((r) => setTimeout(r, 5));
      globals.__openmptWorkletLib = mockLib();
    };

    const [a, b] = await Promise.all([
      ensureSharedLibOpenMPT(globals, 'glue', null, evalScript),
      ensureSharedLibOpenMPT(globals, 'glue', null, evalScript),
    ]);

    expect(evalCount).toBe(1);
    expect(a).toBe(b);
  });

  it('reuses existing lib without re-evaluating when already initialised', async () => {
    const lib = mockLib();
    const globals: WorkletLibGlobals = { __openmptWorkletLib: lib };
    let evalCount = 0;

    const result = await ensureSharedLibOpenMPT(
      globals,
      'should-not-run',
      null,
      () => { evalCount += 1; },
    );

    expect(evalCount).toBe(0);
    expect(result).toBe(lib);
    resetWorkletLibSingleton(globals);
  });
});

describe('audio hook source invariants', () => {
  const useLibOpenMPT = readLibOpenMPTSources(ROOT);
  const transportActions = readTransportActionsSource(ROOT);
  const useAudioGraph = readFileSync(join(ROOT, 'hooks/useAudioGraph.ts'), 'utf8');
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
});

describe('workletAudioLifecycle (#354 pure helpers smoke)', () => {
  it('position throttle helper matches 1/60 s cadence', () => {
    expect(WORKLET_POSITION_REPORT_INTERVAL_SEC).toBeCloseTo(1 / 60, 12);
    expect(shouldReportWorkletPosition(0, Number.NEGATIVE_INFINITY)).toBe(true);
    expect(shouldReportWorkletPosition(0.001, 0)).toBe(false);
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
