/**
 * #453 acceptance: toggling any FX module produces no discontinuity above
 * −60 dBFS on the crossfade. Offline renders on real Web Audio
 * (node-web-audio-api), scored with audio/fx/testing/clickMetric.ts — the same
 * metric the Chromium harness applies on Chrome's implementation.
 *
 * Each module is toggled on at T1 and off at T2, with the on/off states
 * differing only in `enabled`, so the wet path's history matches a render with
 * the module statically on. The metric's self-check: a hard switch and a 1 ms
 * fade must FAIL both M1 and M2 — otherwise the metric proves nothing.
 */
import { describe, expect, it } from 'vitest';
import { FxRack } from '../audio/fx/FxRack';
import { defaultFxRackState, parseFxRackState } from '../audio/fx/spec/schema';
import {
  CLICK_LIMIT,
  conformanceResidual,
  discontinuity,
} from '../audio/fx/testing/clickMetric';
import { lowSine } from '../audio/fx/testing/testSignals';
import type { FxModuleId, FxRackState } from '../audio/fx/types';
import {
  CHARACTER_WORKLET,
  FX_CROSSFADE_S,
  quantumTime,
  renderFadeCurve,
  renderRack,
} from './helpers/fxRender';
import {
  bufferFrom,
  channelsOf,
  createOfflineContext,
  installWebAudioGlobals,
  maxAbsDiff,
  nwa,
  startRenderingWithTimeout,
} from './helpers/webAudioNode';

const SR = 48_000;
const SECONDS = 1;
const T1 = quantumTime(0.3, SR);
const T2 = quantumTime(0.6, SR);
const WARMUP: Record<FxModuleId, number> = { eq: 0.01, comp: 0.02, character: 0.005, room: 0 };

/** 55 Hz at −12 dBFS plus DC: no high-frequency content of its own, so M2 sees clicks. */
const input = () => lowSine({ sampleRate: SR, seconds: SECONDS, freq: 55, amp: 0.25, dc: 0.1 });

function states(module: FxModuleId, params: Record<string, unknown>): { off: FxRackState; on: FxRackState } {
  const off = defaultFxRackState();
  Object.assign(off.modules[module].params, params);
  const on = parseFxRackState(off);
  on.modules[module].enabled = true;
  return { off: parseFxRackState(off), on };
}

interface Scored {
  m1: number;
  m2: ReturnType<typeof discontinuity>;
}

async function score(module: FxModuleId, params: Record<string, unknown>, fadeSeconds?: number): Promise<Scored> {
  const signal = input();
  const { off, on } = states(module, params);
  const toggled = await renderRack({
    input: signal,
    sampleRate: SR,
    initial: off,
    prepare: [module],
    toggles: [
      { at: T1, state: on },
      { at: T2, state: off },
    ],
    ...(fadeSeconds !== undefined ? { fadeSeconds } : {}),
  });
  const dry = await renderRack({ input: signal, sampleRate: SR, initial: off });
  const wet = await renderRack({ input: signal, sampleRate: SR, initial: on, mode: 'static' });
  const onFade = T1 + WARMUP[module];
  const g = await renderFadeCurve({ sampleRate: SR, length: signal[0]!.length, onFadeStart: onFade, offFadeStart: T2 });

  const window = (start: number): [number, number] => [
    Math.round((start - 0.005) * SR),
    Math.round((start + FX_CROSSFADE_S + 0.05) * SR),
  ];
  return {
    m1: conformanceResidual(toggled.out, dry.out, wet.out, g),
    m2: discontinuity(toggled.out, [dry.out, wet.out], SR, [window(onFade), window(T2)]),
  };
}

const MODULES: { id: FxModuleId; params: Record<string, unknown> }[] = [
  { id: 'eq', params: { lowGain: 6, lowFreq: 200, highGain: -3 } },
  { id: 'comp', params: { threshold: -24, ratio: 4, knee: 6, attack: 0.005, release: 0.2, makeup: 6 } },
  { id: 'character', params: { tapeOn: true, drive: 0.6, ledOn: true, ledModel: 'a500' } },
];

describe('FX crossfades are click-free (#453 acceptance 2)', () => {
  for (const { id, params } of MODULES) {
    it(`${id}: follows the spec'd 10 ms crossfade (M1) with no discontinuity (M2)`, async () => {
      const { m1, m2 } = await score(id, params);
      expect(m1).toBeLessThan(CLICK_LIMIT);
      expect(m2.excess).toBeLessThan(CLICK_LIMIT);
    });
  }

  it('self-check: a hard switch and a 1 ms fade both FAIL M1 and M2', async () => {
    const loud = { lowGain: 12, lowFreq: 200 };
    for (const fadeSeconds of [0, 0.001]) {
      const { m1, m2 } = await score('eq', loud, fadeSeconds);
      expect(m1, `M1 @ ${fadeSeconds * 1000} ms`).toBeGreaterThan(CLICK_LIMIT);
      expect(m2.excess, `M2 @ ${fadeSeconds * 1000} ms`).toBeGreaterThan(CLICK_LIMIT);
    }
    // …while the real 10 ms fade passes the same loud case.
    const { m1, m2 } = await score('eq', loud);
    expect(m1).toBeLessThan(CLICK_LIMIT);
    expect(m2.excess).toBeLessThan(CLICK_LIMIT);
  });

  it('attaching and collapsing a bypassed rack is inaudible: exact outside the fades, ≤ 1e-6 inside', async () => {
    installWebAudioGlobals();
    const signal = input();
    const ctx = createOfflineContext({ length: signal[0]!.length, sampleRate: SR });
    const masterInput = ctx.createGain();
    const masterDirect = ctx.createGain();
    const analyser = ctx.createGain(); // stand-in: the analyser is a unity pass-through
    masterInput.connect(masterDirect).connect(analyser).connect(ctx.destination);
    const rack = await FxRack.create(ctx, defaultFxRackState(), {
      mode: 'live',
      characterWorkletUrl: CHARACTER_WORKLET,
    });
    rack.attach({ masterInput, masterDirect, analyser }, T1);
    rack.collapse(T2);
    const src = new nwa.AudioBufferSourceNode(ctx, { buffer: bufferFrom(ctx, signal) });
    src.connect(masterInput);
    src.start(0);
    const out = channelsOf(await startRenderingWithTimeout(ctx));

    const f = (t: number) => Math.round(t * SR);
    const fadeEnd = (t: number) => f(t + FX_CROSSFADE_S) + 1;
    expect(maxAbsDiff(out, signal, 0, f(T1))).toBe(0);
    expect(maxAbsDiff(out, signal, fadeEnd(T1), f(T2))).toBe(0);
    expect(maxAbsDiff(out, signal, fadeEnd(T2))).toBe(0);
    expect(maxAbsDiff(out, signal)).toBeLessThan(1e-6);
  });
});
