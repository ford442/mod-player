/**
 * FX rack renders on real Web Audio (node-web-audio-api) for the #453 tests:
 * static builds, live toggles at quantum-aligned suspend points, and the DC
 * probe that renders the spec'd crossfade curve with the same engine.
 */
import { FX_CROSSFADE_S, FX_LOOKAHEAD_S } from '../../audio/fx/automation';
import { FxRack, type FxRackEnv } from '../../audio/fx/FxRack';
import type { IrLoader } from '../../audio/fx/room/irLoader';
import type { FxScheduler } from '../../audio/fx/scheduler';
import { synthIr } from '../../scripts/lib/ir-synth.mjs';
import type { FxRackState } from '../../audio/fx/types';
import {
  bufferFrom,
  channelsOf,
  createOfflineContext,
  installWebAudioGlobals,
  nwa,
  repoPath,
  startRenderingWithTimeout,
} from './webAudioNode';

export const CHARACTER_WORKLET = repoPath('public/worklets/fx-character-worklet.js');
export const QUANTUM = 128;

/** Round a time down to a render-quantum boundary (where offline suspends land). */
export function quantumTime(seconds: number, sampleRate: number): number {
  return (Math.floor((seconds * sampleRate) / QUANTUM) * QUANTUM) / sampleRate;
}

export interface Toggle {
  at: number;
  state: FxRackState;
}

export interface RackRenderOptions {
  input: Float32Array<ArrayBuffer>[];
  sampleRate: number;
  initial: FxRackState;
  mode?: FxRackEnv['mode'];
  toggles?: Toggle[];
  fadeSeconds?: number;
  /** Create these modules before rendering (node-web-audio-api: no worklet nodes mid-render). */
  prepare?: FxRackState['order'];
  /** Extra frames after the input (tails). */
  tailFrames?: number;
  /** Room IRs (default: the synthesized loader below). */
  irLoader?: IrLoader;
  onStatus?: FxRackEnv['onStatus'];
}

/**
 * Room IRs synthesized at the context's rate with the generator's own synth
 * (node-web-audio-api can't decode the committed Opus files). Records loads.
 */
export function synthIrLoader(): IrLoader & { loads: string[] } {
  const loads: string[] = [];
  return {
    loads,
    load(ctx, id) {
      loads.push(id);
      const channels = synthIr(id, ctx.sampleRate);
      const buffer = ctx.createBuffer(channels.length, channels[0]!.length, ctx.sampleRate);
      channels.forEach((data, c) => buffer.copyToChannel(data as Float32Array<ArrayBuffer>, c));
      return Promise.resolve(buffer);
    },
  };
}

/**
 * node-web-audio-api registers offline suspends asynchronously (on its own
 * runtime), so a fast render can race past a suspend point and reject it. The
 * renders here therefore never suspend: every toggle is applied before
 * rendering with its (future) time, which the rack turns into scheduled
 * automation — the same AudioParam events a live toggle schedules ahead of
 * the clock. Scheduler callbacks (deferred unwire / detach / rewire) are only
 * recorded; their effects are covered with fake nodes in tests/fxRackScheduling.test.ts.
 * In the Chromium harness, real suspends are used.
 */
export class RecordingScheduler implements FxScheduler {
  readonly calls: number[] = [];

  at(time: number): void {
    this.calls.push(time);
  }
}

export async function renderRack(
  opts: RackRenderOptions,
): Promise<{ out: Float32Array<ArrayBuffer>[]; rack: FxRack; scheduler: RecordingScheduler }> {
  installWebAudioGlobals();
  const { input, sampleRate } = opts;
  const length = (input[0]?.length ?? 0) + (opts.tailFrames ?? 0);
  const ctx = createOfflineContext({ length, sampleRate });
  const scheduler = new RecordingScheduler();
  const env: FxRackEnv = {
    mode: opts.mode ?? 'live',
    characterWorkletUrl: CHARACTER_WORKLET,
    scheduler,
    irLoader: opts.irLoader ?? synthIrLoader(),
    ...(opts.onStatus ? { onStatus: opts.onStatus } : {}),
    ...(opts.fadeSeconds !== undefined ? { fadeSeconds: opts.fadeSeconds } : {}),
  };
  const rack = await FxRack.create(ctx, opts.initial, env);
  if (opts.prepare) await rack.prepare(opts.prepare);
  const src = new nwa.AudioBufferSourceNode(ctx, { buffer: bufferFrom(ctx, input) });
  src.connect(rack.input);
  rack.output.connect(ctx.destination);
  src.start(0);
  for (const toggle of [...(opts.toggles ?? [])].sort((a, b) => a.at - b.at)) {
    await rack.apply(toggle.state, { at: toggle.at });
  }
  const out = channelsOf(await startRenderingWithTimeout(ctx));
  return { out, rack, scheduler };
}

/**
 * The spec'd crossfade curve g(t) for a module toggled on at `onAt` (fade
 * starts after lookahead + warmup) and off at `offAt` — rendered by the same
 * engine from a DC probe so it matches the slot's gain automation sample for
 * sample.
 */
export async function renderFadeCurve(opts: {
  sampleRate: number;
  length: number;
  onFadeStart: number;
  offFadeStart?: number;
  fadeSeconds?: number;
}): Promise<Float32Array<ArrayBuffer>> {
  const fade = opts.fadeSeconds ?? FX_CROSSFADE_S;
  const ctx = createOfflineContext({ length: opts.length, sampleRate: opts.sampleRate, channels: 1 });
  const dc = new nwa.ConstantSourceNode(ctx, { offset: 1 });
  const probe = new nwa.GainNode(ctx, { gain: 0 });
  probe.gain.setValueAtTime(0, opts.onFadeStart);
  probe.gain.linearRampToValueAtTime(1, opts.onFadeStart + fade);
  if (opts.offFadeStart !== undefined) {
    probe.gain.setValueAtTime(1, opts.offFadeStart);
    probe.gain.linearRampToValueAtTime(0, opts.offFadeStart + fade);
  }
  dc.connect(probe).connect(ctx.destination);
  dc.start(0);
  return channelsOf(await startRenderingWithTimeout(ctx))[0]!;
}

export { FX_CROSSFADE_S, FX_LOOKAHEAD_S };
