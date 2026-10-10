/**
 * Chromium harness for the FX rack (#453). Not shipped: scripts/fx-smoke.mjs
 * bundles this file in memory and serves it on the preview origin, so the
 * real built `worklets/fx-character-worklet.js` (and later `ir/*.opus`) are
 * exercised on Chrome's Web Audio implementation.
 *
 * It repeats the vitest Web Audio checks (bypass null, crossfade M1/M2 with
 * the self-check, static-vs-live parity) on Chrome's nodes, and measures the
 * character worklet's CPU — the one thing only a real browser can answer.
 *
 * Renders never suspend: toggles are scheduled ahead of time, exactly like
 * the vitest renders, so both harnesses score identical scenarios.
 */
import { ensureCommonMasterNodes, wireMasterOutput } from '../../../hooks/audioGraph/masterGraph';
import type { AudioGraphRefs } from '../../../hooks/audioGraph/types';
import {
  CHARACTER_PARAM_DESCRIPTORS,
  CHARACTER_PROCESSOR_NAME,
} from '../../../audio-worklet/fxCharacterParams';
import { FX_CROSSFADE_S } from '../automation';
import { buildFxGraph } from '../buildFxGraph';
import { ensureCharacterWorklet } from '../character/characterWorkletLoader';
import { FxRack, type FxRackEnv } from '../FxRack';
import { fxTailSeconds, renderFxOffline } from '../offline/renderFxOffline';
import { IR_MANIFEST } from '../room/irCatalog';
import { sharedIrLoader } from '../room/irLoader';
import { FX_FACTORY_PRESETS } from '../spec/presets';
import { cloneFxRackState, defaultFxRackState, parseFxRackState } from '../spec/schema';
import type { FxModuleId, FxRackState, RoomIrId } from '../types';
import { CLICK_LIMIT, conformanceResidual, discontinuity } from './clickMetric';
import { lowSine, noise, program } from './testSignals';

export interface HarnessOptions {
  /** Absolute URL of the built character worklet on this origin. */
  workletUrl: string;
  /** Seconds of audio per CPU run (default 30). */
  cpuSeconds?: number;
  /** Timed runs per variant, after one warm-up each (default 5). */
  cpuRuns?: number;
  /** Max CPU share of one core for the character stage (default 0.05). */
  cpuLimit?: number;
}

export interface HarnessCheck {
  name: string;
  value: number;
  limit: number;
  /** 'below': pass when value < limit; 'above': pass when value > limit; 'zero': value === 0. */
  expect: 'below' | 'above' | 'zero';
  pass: boolean;
}

export interface HarnessReport {
  ok: boolean;
  userAgent: string;
  checks: HarnessCheck[];
  cpu: {
    seconds: number;
    runs: number;
    baselineMs: number[];
    characterMs: number[];
    /** (median character − median baseline) / audio duration. */
    characterShare: number;
  };
}

type Channels = Float32Array[];

const SR = 48_000;
const QUANTUM = 128;

function check(name: string, value: number, limit: number, expect: HarnessCheck['expect']): HarnessCheck {
  const pass = expect === 'zero' ? value === 0 : expect === 'below' ? value < limit : value > limit;
  return { name, value, limit, expect, pass };
}

function maxAbsDiff(a: Channels, b: Channels, from = 0, to = Number.POSITIVE_INFINITY): number {
  let max = 0;
  for (let c = 0; c < Math.min(a.length, b.length); c++) {
    const x = a[c]!;
    const y = b[c]!;
    const end = Math.min(x.length, y.length, to);
    for (let i = Math.max(0, from); i < end; i++) max = Math.max(max, Math.abs(x[i]! - y[i]!));
  }
  return max;
}

function toBuffer(ctx: BaseAudioContext, channels: Channels): AudioBuffer {
  const buffer = ctx.createBuffer(channels.length, channels[0]!.length, ctx.sampleRate);
  channels.forEach((data, c) => buffer.getChannelData(c).set(data));
  return buffer;
}

function channelsOf(buffer: AudioBuffer): Channels {
  return Array.from({ length: buffer.numberOfChannels }, (_, c) => Float32Array.from(buffer.getChannelData(c)));
}

const quantumTime = (t: number, sr: number) => (Math.floor((t * sr) / QUANTUM) * QUANTUM) / sr;

interface Toggle {
  at: number;
  state: FxRackState;
}

async function renderRack(
  env: Omit<FxRackEnv, 'mode'>,
  input: Channels,
  sampleRate: number,
  initial: FxRackState,
  opts: { mode?: FxRackEnv['mode']; toggles?: Toggle[]; prepare?: FxModuleId[]; fadeSeconds?: number } = {},
): Promise<Channels> {
  const ctx = new OfflineAudioContext(2, input[0]!.length, sampleRate);
  const rack = await FxRack.create(ctx, initial, {
    ...env,
    mode: opts.mode ?? 'live',
    ...(opts.fadeSeconds !== undefined ? { fadeSeconds: opts.fadeSeconds } : {}),
  });
  if (opts.prepare) await rack.prepare(opts.prepare);
  const src = ctx.createBufferSource();
  src.buffer = toBuffer(ctx, input);
  src.connect(rack.input);
  rack.output.connect(ctx.destination);
  src.start(0);
  for (const t of opts.toggles ?? []) await rack.apply(t.state, { at: t.at });
  return channelsOf(await ctx.startRendering());
}

async function renderFadeCurve(length: number, onFadeStart: number, offFadeStart: number): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, length, SR);
  const dc = ctx.createConstantSource();
  const probe = ctx.createGain();
  probe.gain.value = 0;
  probe.gain.setValueAtTime(0, onFadeStart);
  probe.gain.linearRampToValueAtTime(1, onFadeStart + FX_CROSSFADE_S);
  probe.gain.setValueAtTime(1, offFadeStart);
  probe.gain.linearRampToValueAtTime(0, offFadeStart + FX_CROSSFADE_S);
  dc.connect(probe).connect(ctx.destination);
  dc.start(0);
  return (await ctx.startRendering()).getChannelData(0).slice();
}

// ── Null tests (acceptance 1) ────────────────────────────────────────────────

async function nullChecks(env: Omit<FxRackEnv, 'mode'>): Promise<HarnessCheck[]> {
  const input = program({ sampleRate: SR, seconds: 0.5 });
  const volume = 0.8;
  const pan = 0.25;

  const legacyCtx = new OfflineAudioContext(2, input[0]!.length, SR);
  const legacySrc = legacyCtx.createBufferSource();
  legacySrc.buffer = toBuffer(legacyCtx, input);
  const analyser = legacyCtx.createAnalyser();
  analyser.fftSize = 2048;
  const panner = legacyCtx.createStereoPanner();
  panner.pan.value = pan;
  const gain = legacyCtx.createGain();
  gain.gain.value = volume;
  legacySrc.connect(analyser).connect(panner).connect(gain).connect(legacyCtx.destination);
  legacySrc.start(0);
  const legacy = channelsOf(await legacyCtx.startRendering());

  const production = async (withRack: boolean) => {
    const ctx = new OfflineAudioContext(2, input[0]!.length, SR);
    const refs = {
      masterInputRef: { current: null },
      masterDirectRef: { current: null },
      analyserRef: { current: null },
      stereoPannerRef: { current: null },
      gainNodeRef: { current: null },
    } as unknown as AudioGraphRefs;
    ensureCommonMasterNodes(ctx as unknown as AudioContext, refs, volume, pan);
    const attachAt = (QUANTUM * 10) / SR;
    const collapseAt = (QUANTUM * 100) / SR;
    if (withRack) {
      const rack = await FxRack.create(ctx, defaultFxRackState(), { ...env, mode: 'live' });
      await rack.prepare(['character', 'eq', 'comp']);
      rack.attach(
        { masterInput: refs.masterInputRef.current!, masterDirect: refs.masterDirectRef.current!, analyser: refs.analyserRef.current! },
        attachAt,
      );
      rack.collapse(collapseAt);
    }
    wireMasterOutput(ctx as unknown as AudioContext, refs, volume, pan);
    const src = ctx.createBufferSource();
    src.buffer = toBuffer(ctx, input);
    src.connect(refs.masterInputRef.current!);
    src.start(0);
    return { out: channelsOf(await ctx.startRendering()), attachAt, collapseAt };
  };

  const direct = await production(false);
  const attached = await production(true);
  const f = (t: number) => Math.round(t * SR);
  const settled = (t: number) => f(t + FX_CROSSFADE_S) + 1;
  return [
    check('null: master chain vs pre-rack graph', maxAbsDiff(direct.out, legacy), 0, 'zero'),
    check(
      'null: bypassed rack attached (steady)',
      maxAbsDiff(attached.out, legacy, settled(attached.attachAt), f(attached.collapseAt)),
      0,
      'zero',
    ),
    check('null: after collapse', maxAbsDiff(attached.out, legacy, settled(attached.collapseAt)), 0, 'zero'),
    check('null: during attach/collapse fades', maxAbsDiff(attached.out, legacy), 1e-6, 'below'),
  ];
}

// ── Crossfades (acceptance 2) ────────────────────────────────────────────────

const WARMUP: Record<FxModuleId, number> = { eq: 0.01, comp: 0.02, character: 0.005, room: 0 };

async function crossfadeScore(
  env: Omit<FxRackEnv, 'mode'>,
  module: FxModuleId,
  params: Record<string, unknown>,
  fadeSeconds?: number,
) {
  const input = lowSine({ sampleRate: SR, seconds: 1, freq: 55, amp: 0.25, dc: 0.1 });
  const T1 = quantumTime(0.3, SR);
  const T2 = quantumTime(0.6, SR);
  const off = defaultFxRackState();
  Object.assign(off.modules[module].params, params);
  const on = cloneFxRackState(off);
  on.modules[module].enabled = true;

  const toggled = await renderRack(env, input, SR, off, {
    toggles: [
      { at: T1, state: on },
      { at: T2, state: off },
    ],
    prepare: [module],
    ...(fadeSeconds !== undefined ? { fadeSeconds } : {}),
  });
  const dry = await renderRack(env, input, SR, off);
  const wet = await renderRack(env, input, SR, on, { mode: 'static' });
  const onFade = T1 + WARMUP[module];
  const g = await renderFadeCurve(input[0]!.length, onFade, T2);
  const window = (start: number): [number, number] => [
    Math.round((start - 0.005) * SR),
    Math.round((start + FX_CROSSFADE_S + 0.05) * SR),
  ];
  return {
    m1: conformanceResidual(toggled, dry, wet, g),
    m2: discontinuity(toggled, [dry, wet], SR, [window(onFade), window(T2)]).excess,
  };
}

async function crossfadeChecks(env: Omit<FxRackEnv, 'mode'>): Promise<HarnessCheck[]> {
  const out: HarnessCheck[] = [];
  const modules: [FxModuleId, Record<string, unknown>][] = [
    ['eq', { lowGain: 6, lowFreq: 200, highGain: -3 }],
    ['comp', { threshold: -24, ratio: 4, knee: 6, attack: 0.005, release: 0.2, makeup: 6 }],
    ['character', { tapeOn: true, drive: 0.6, ledOn: true, ledModel: 'a500' }],
  ];
  for (const [id, params] of modules) {
    const { m1, m2 } = await crossfadeScore(env, id, params);
    out.push(check(`crossfade ${id}: M1 conformance`, m1, CLICK_LIMIT, 'below'));
    out.push(check(`crossfade ${id}: M2 discontinuity`, m2, CLICK_LIMIT, 'below'));
  }
  const loud = { lowGain: 12, lowFreq: 200 };
  for (const fade of [0, 0.001]) {
    const { m1, m2 } = await crossfadeScore(env, 'eq', loud, fade);
    out.push(check(`self-check ${fade * 1000} ms fade: M1 must fail`, m1, CLICK_LIMIT, 'above'));
    out.push(check(`self-check ${fade * 1000} ms fade: M2 must fail`, m2, CLICK_LIMIT, 'above'));
  }
  return out;
}

// ── Room IRs: real Opus decode + send conformance ────────────────────────────

async function roomChecks(env: Omit<FxRackEnv, 'mode'>): Promise<HarnessCheck[]> {
  const out: HarnessCheck[] = [];
  const loader = env.irLoader!;
  for (const sampleRate of [48_000, 44_100]) {
    for (const id of Object.keys(IR_MANIFEST) as RoomIrId[]) {
      const ctx = new OfflineAudioContext(2, 128, sampleRate);
      let energyError = Number.POSITIVE_INFINITY;
      try {
        const ir = await loader.load(ctx, id); // validates channels + duration
        const energies = Array.from({ length: ir.numberOfChannels }, (_, c) =>
          ir.getChannelData(c).reduce((sum, v) => sum + v * v, 0),
        );
        // Unit energy at 48 kHz; resampling to 44.1 kHz scales it by ~44.1/48.
        const expected = sampleRate / 48_000;
        energyError = Math.max(...energies.map((e) => Math.abs(e / expected - 1)));
        if (ir.sampleRate !== sampleRate) energyError = Number.POSITIVE_INFINITY;
      } catch {
        energyError = Number.POSITIVE_INFINITY;
      }
      out.push(check(`ir ${id} @ ${sampleRate}: Opus decode, rate, length, energy error`, energyError, 0.25, 'below'));
    }
  }

  // Toggled room vs a hand-built reference (dry + the same IR fed through the
  // spec'd send ramp) — see tests/fxRoom.test.ts for why M1/M2 don't apply.
  const input = lowSine({ sampleRate: SR, seconds: 2, freq: 55, amp: 0.25, dc: 0.1 });
  const T1 = quantumTime(0.3, SR);
  const T2 = quantumTime(0.8, SR);
  const params = { ir: 'small' as const, mix: 0.6, predelay: 10, lowCut: 150 };
  const state = (enabled: boolean) => {
    const st = defaultFxRackState();
    st.modules.room.enabled = enabled;
    Object.assign(st.modules.room.params, params);
    return parseFxRackState(st);
  };
  const toggled = await renderRack(env, input, SR, state(false), {
    toggles: [
      { at: T1, state: state(true) },
      { at: T2, state: state(false) },
    ],
    prepare: ['room'],
  });
  const ctx = new OfflineAudioContext(2, input[0]!.length, SR);
  const src = ctx.createBufferSource();
  src.buffer = toBuffer(ctx, input);
  const send = ctx.createGain();
  const sendOn = T1 + FX_CROSSFADE_S;
  send.gain.value = 0;
  send.gain.setValueAtTime(0, sendOn);
  send.gain.linearRampToValueAtTime(1, sendOn + FX_CROSSFADE_S);
  send.gain.setValueAtTime(1, T2);
  send.gain.linearRampToValueAtTime(0, T2 + FX_CROSSFADE_S);
  const mix = ctx.createGain();
  mix.gain.value = params.mix;
  const predelay = ctx.createDelay(0.2);
  predelay.delayTime.value = params.predelay / 1000;
  const lowCut = ctx.createBiquadFilter();
  lowCut.type = 'highpass';
  lowCut.frequency.value = params.lowCut;
  lowCut.Q.value = Math.SQRT1_2;
  const conv = ctx.createConvolver();
  conv.normalize = false;
  conv.buffer = await loader.load(ctx, 'small');
  src.connect(ctx.destination);
  src.connect(send).connect(mix).connect(predelay).connect(lowCut).connect(conv).connect(ctx.destination);
  src.start(0);
  const reference = channelsOf(await ctx.startRendering());
  out.push(check('room: toggled vs spec\'d send-ramp reference', maxAbsDiff(toggled, reference), CLICK_LIMIT, 'below'));
  const back = Math.round((T2 + FX_CROSSFADE_S + 0.35 + 0.01 + 0.05 + FX_CROSSFADE_S) * SR) + 1;
  out.push(check('room: exact wire again after the tail', maxAbsDiff(toggled, input, back), 0, 'zero'));
  return out;
}

// ── Static vs live parity ────────────────────────────────────────────────────

async function parityChecks(env: Omit<FxRackEnv, 'mode'>): Promise<HarnessCheck[]> {
  const out: HarnessCheck[] = [];
  const presets = FX_FACTORY_PRESETS.filter((p) => p.id !== 'flat');
  for (const sampleRate of [44_100, 48_000]) {
    const input = program({ sampleRate, seconds: 0.5 });
    for (const preset of presets) {
      const live = await renderRack(env, input, sampleRate, preset.state, { mode: 'live' });
      const roundTripped = parseFxRackState(JSON.parse(JSON.stringify(preset.state)));
      const ctx = new OfflineAudioContext(2, input[0]!.length, sampleRate);
      const rack = await buildFxGraph(ctx, roundTripped, env);
      const src = ctx.createBufferSource();
      src.buffer = toBuffer(ctx, input);
      src.connect(rack.input);
      rack.output.connect(ctx.destination);
      src.start(0);
      const stat = channelsOf(await ctx.startRendering());
      out.push(check(`parity ${preset.id} @ ${sampleRate}: live create vs static build`, maxAbsDiff(live, stat), 1e-4, 'below'));
    }
  }
  return out;
}

// ── Export parity (acceptance 4) ─────────────────────────────────────────────

async function exportChecks(env: Omit<FxRackEnv, 'mode'>): Promise<HarnessCheck[]> {
  const out: HarnessCheck[] = [];
  const sampleRate = 44_100; // the export rate
  const input = program({ sampleRate, seconds: 0.6 });
  for (const preset of FX_FACTORY_PRESETS.filter((p) => p.id !== 'flat')) {
    const tailFrames = Math.ceil(fxTailSeconds(preset.state, sampleRate) * sampleRate);
    const padded = input.map((ch) => {
      const longer = new Float32Array(ch.length + tailFrames);
      longer.set(ch);
      return longer;
    });
    const live = await renderRack(env, padded, sampleRate, preset.state, { mode: 'live' });
    const exported = await renderFxOffline({ left: input[0]!, right: input[1]!, sampleRate }, preset.state, {
      ...(env.characterWorkletUrl ? { characterWorkletUrl: env.characterWorkletUrl } : {}),
      ...(env.irLoader ? { irLoader: env.irLoader } : {}),
    });
    out.push(check(`export ${preset.id}: renderFxOffline vs live rack`, maxAbsDiff([exported.left, exported.right], live), 1e-4, 'below'));
  }
  return out;
}

// ── CPU (acceptance 3) ───────────────────────────────────────────────────────

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

async function timeRender(seconds: number, workletUrl: string, withCharacter: boolean): Promise<number> {
  const ctx = new OfflineAudioContext(2, seconds * SR, SR);
  const src = ctx.createBufferSource();
  src.buffer = toBuffer(ctx, noise({ sampleRate: SR, seconds: 1, amp: 0.5 }));
  src.loop = true;
  let tail: AudioNode;
  if (withCharacter) {
    await ensureCharacterWorklet(ctx, workletUrl);
    const parameterData: Record<string, number> = {};
    for (const d of CHARACTER_PARAM_DESCRIPTORS) parameterData[d.name] = d.defaultValue;
    // Worst case: every sub-stage on, drive mid-range.
    Object.assign(parameterData, { tapeOn: 1, drive: 0.6, ledOn: 1, ledModel: 0, crushOn: 1, crushRate: 11025, crushBits: 8 });
    tail = new AudioWorkletNode(ctx, CHARACTER_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      parameterData,
    });
  } else {
    tail = ctx.createGain();
  }
  src.connect(tail).connect(ctx.destination);
  src.start(0);
  const t0 = performance.now();
  await ctx.startRendering();
  return performance.now() - t0;
}

async function cpuCheck(opts: Required<HarnessOptions>): Promise<{ check: HarnessCheck; cpu: HarnessReport['cpu'] }> {
  const baselineMs: number[] = [];
  const characterMs: number[] = [];
  await timeRender(opts.cpuSeconds, opts.workletUrl, false); // warm-up
  await timeRender(opts.cpuSeconds, opts.workletUrl, true);
  for (let i = 0; i < opts.cpuRuns; i++) {
    baselineMs.push(await timeRender(opts.cpuSeconds, opts.workletUrl, false));
    characterMs.push(await timeRender(opts.cpuSeconds, opts.workletUrl, true));
  }
  const characterShare = (median(characterMs) - median(baselineMs)) / (opts.cpuSeconds * 1000);
  return {
    check: check('cpu: character stage share of one core @ 48 kHz stereo', characterShare, opts.cpuLimit, 'below'),
    cpu: { seconds: opts.cpuSeconds, runs: opts.cpuRuns, baselineMs, characterMs, characterShare },
  };
}

// ── Entry ────────────────────────────────────────────────────────────────────

export async function runAll(options: HarnessOptions): Promise<HarnessReport> {
  const opts: Required<HarnessOptions> = {
    cpuSeconds: 30,
    cpuRuns: 5,
    cpuLimit: 0.05,
    ...options,
  };
  const env: Omit<FxRackEnv, 'mode'> = { characterWorkletUrl: opts.workletUrl, irLoader: sharedIrLoader() };
  const checks: HarnessCheck[] = [];
  checks.push(...(await nullChecks(env)));
  checks.push(...(await crossfadeChecks(env)));
  checks.push(...(await roomChecks(env)));
  checks.push(...(await parityChecks(env)));
  checks.push(...(await exportChecks(env)));
  const { check: cpu, cpu: cpuReport } = await cpuCheck(opts);
  checks.push(cpu);
  return {
    ok: checks.every((c) => c.pass),
    userAgent: navigator.userAgent,
    checks,
    cpu: cpuReport,
  };
}

declare global {
  interface Window {
    __FX_HARNESS__?: { runAll: typeof runAll };
  }
}

if (typeof window !== 'undefined') window.__FX_HARNESS__ = { runAll };
