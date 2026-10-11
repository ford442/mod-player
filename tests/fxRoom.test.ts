/**
 * Convolution room (#453) on real Web Audio (node-web-audio-api) with IRs
 * synthesized by the asset generator's own synth: parallel-send wiring,
 * click-free enable / disable (M2 — the send ramp makes M1's linear model
 * inapplicable), IR switching, unavailability + retry, and lazy IR loading.
 */
import { describe, expect, it, vi } from 'vitest';
import { FxRack } from '../audio/fx/FxRack';
import { createFetchIrLoader, IrUnavailableError, type IrLoader } from '../audio/fx/room/irLoader';
import { defaultFxRackState, parseFxRackState } from '../audio/fx/spec/schema';
import { CLICK_LIMIT, discontinuity } from '../audio/fx/testing/clickMetric';
import { lowSine, program } from '../audio/fx/testing/testSignals';
import type { FxRackState, RoomParams } from '../audio/fx/types';
import { FX_CROSSFADE_S, quantumTime, renderRack, synthIrLoader } from './helpers/fxRender';
import {
  WEB_AUDIO_TIMEOUT_MS,
  bufferFrom,
  channelsOf,
  createOfflineContext,
  maxAbsDiff,
  nwa,
  startRenderingWithTimeout,
} from './helpers/webAudioNode';

const SR = 48_000;

function roomState(enabled: boolean, params: Partial<RoomParams> = {}): FxRackState {
  const s = defaultFxRackState();
  s.modules.room.enabled = enabled;
  Object.assign(s.modules.room.params, params);
  return parseFxRackState(s);
}

const energy = (x: Float32Array, from = 0, to = x.length) => {
  let e = 0;
  for (let i = from; i < to; i++) e += x[i]! * x[i]!;
  return e;
};

describe('room module (#453)', { timeout: WEB_AUDIO_TIMEOUT_MS }, () => {
  it('adds a reverb tail on top of the unchanged dry signal', async () => {
    const input = program({ sampleRate: SR, seconds: 0.3 });
    const tailFrames = Math.round(0.8 * SR);
    const { out } = await renderRack({
      input,
      sampleRate: SR,
      initial: roomState(true, { ir: 'medium', mix: 0.5, predelay: 0 }),
      mode: 'static',
      tailFrames,
    });
    const n = input[0]!.length;
    expect(maxAbsDiff(out, input, 0, n)).toBeGreaterThan(0.01);
    expect(energy(out[0]!, n, n + Math.round(0.3 * SR))).toBeGreaterThan(1e-3); // rings on
  });

  it('with mix 0 the room is an exact wire (the dry path is unity)', async () => {
    const input = program({ sampleRate: SR, seconds: 0.3 });
    const { out } = await renderRack({ input, sampleRate: SR, initial: roomState(true, { mix: 0 }), mode: 'static' });
    expect(maxAbsDiff(out, input)).toBe(0);
  });

  /**
   * The send ramp is not a slot crossfade, so M1's linear model doesn't apply,
   * and M2 can't judge a reverb: a send fading out under a pure low sine leaves
   * the IR's own broadband tail ringing — high-frequency content the static
   * renders never have, though nothing stepped. Instead the toggled output must
   * equal a hand-built reference: dry + the same IR fed through the spec'd send
   * ramp. That catches a mistimed fade, and a slot swap before the tail is done.
   */
  it('enable / disable follows the spec\'d send ramp and lets the tail ring out; then an exact wire again', async () => {
    const input = lowSine({ sampleRate: SR, seconds: 2, freq: 55, amp: 0.25, dc: 0.1 });
    const T1 = quantumTime(0.3, SR);
    const T2 = quantumTime(0.8, SR);
    const params = { ir: 'small' as const, mix: 0.6, predelay: 10, lowCut: 150 };
    const toggled = await renderRack({
      input,
      sampleRate: SR,
      initial: roomState(false, params),
      prepare: ['room'],
      toggles: [
        { at: T1, state: roomState(true, params) },
        { at: T2, state: roomState(false, params) },
      ],
    });

    // Reference: the slot swaps first (silent: send is 0), then the send fades in.
    const sendOn = T1 + FX_CROSSFADE_S;
    const ctx = createOfflineContext({ length: input[0]!.length, sampleRate: SR });
    const src = new nwa.AudioBufferSourceNode(ctx, { buffer: bufferFrom(ctx, input) });
    const send = new nwa.GainNode(ctx, { gain: 0 });
    send.gain.setValueAtTime(0, sendOn);
    send.gain.linearRampToValueAtTime(1, sendOn + FX_CROSSFADE_S);
    send.gain.setValueAtTime(1, T2);
    send.gain.linearRampToValueAtTime(0, T2 + FX_CROSSFADE_S);
    const mix = new nwa.GainNode(ctx, { gain: params.mix });
    const predelay = new nwa.DelayNode(ctx, { maxDelayTime: 0.2, delayTime: params.predelay / 1000 });
    const lowCut = new nwa.BiquadFilterNode(ctx, { type: 'highpass', frequency: params.lowCut, Q: Math.SQRT1_2 });
    const conv = new nwa.ConvolverNode(ctx, { disableNormalization: true });
    conv.buffer = await synthIrLoader().load(ctx, 'small');
    src.connect(ctx.destination);
    src.connect(send).connect(mix).connect(predelay).connect(lowCut).connect(conv).connect(ctx.destination);
    src.start(0);
    const reference = channelsOf(await startRenderingWithTimeout(ctx));

    expect(maxAbsDiff(toggled.out, reference)).toBeLessThan(CLICK_LIMIT);
    // After send fade + tail + slot swap, the output is the input again, exactly.
    const tail = 0.35 + params.predelay / 1000 + 0.05;
    const back = Math.round((T2 + FX_CROSSFADE_S + tail + FX_CROSSFADE_S) * SR) + 1;
    expect(maxAbsDiff(toggled.out, input, back)).toBe(0);
    expect(maxAbsDiff(toggled.out, input, Math.round((T1 + 0.1) * SR), Math.round(T2 * SR))).toBeGreaterThan(0.01);
  });

  it('switching IR crossfades the convolvers without a click', async () => {
    const input = lowSine({ sampleRate: SR, seconds: 1.5, freq: 55, amp: 0.25 });
    const T = quantumTime(0.6, SR);
    const status: string[] = [];
    const from = roomState(true, { ir: 'small', mix: 0.5 });
    const to = roomState(true, { ir: 'large', mix: 0.5 });
    const { out } = await renderRack({
      input,
      sampleRate: SR,
      initial: from,
      toggles: [{ at: T, state: to }],
      onStatus: (_m, s) => status.push(s),
    });
    const a = await renderRack({ input, sampleRate: SR, initial: from, mode: 'static' });
    const b = await renderRack({ input, sampleRate: SR, initial: to, mode: 'static' });
    const { excess } = discontinuity(out, [a.out, b.out], SR, [[Math.round((T - 0.005) * SR), Math.round((T + 0.15) * SR)]]);
    expect(excess).toBeLessThan(CLICK_LIMIT);
    expect(maxAbsDiff(out, b.out, Math.round((T + 0.06 + 1.0) * SR))).toBeLessThan(1e-5); // settled on the new IR
    expect(status).toEqual(['loading', 'ready', 'loading', 'ready']);
  });

  it('a room whose IR fails to load is unavailable: the rack stays an exact wire; retry recovers', async () => {
    const input = program({ sampleRate: SR, seconds: 0.2 });
    let fail = true;
    const synth = synthIrLoader();
    const flaky: IrLoader = {
      load: (ctx, id) => (fail ? Promise.reject(new IrUnavailableError(id, 'decode failed')) : synth.load(ctx, id)),
    };
    const status: string[] = [];
    const { out, rack } = await renderRack({
      input,
      sampleRate: SR,
      initial: roomState(true, { mix: 0.5 }),
      mode: 'static',
      irLoader: flaky,
      onStatus: (_m, s, detail) => status.push(detail ? `${s}: ${detail}` : s),
    });
    expect(rack.unavailable.has('room')).toBe(true);
    expect(maxAbsDiff(out, input)).toBe(0);
    expect(status).toEqual(['loading', 'unavailable: Room IR "small" unavailable: decode failed']);
    fail = false;
    await rack.retry('room');
    expect(rack.unavailable.has('room')).toBe(false);
    expect(rack.tailSeconds()).toBeGreaterThan(0.35);
  });

  it('IRs load only when the room is enabled', async () => {
    const loader = synthIrLoader();
    const input = program({ sampleRate: SR, seconds: 0.05 });
    const off = await renderRack({ input, sampleRate: SR, initial: roomState(false), mode: 'static', irLoader: loader });
    expect(loader.loads).toEqual([]);
    await off.rack.apply(roomState(true, { ir: 'medium' }), { immediate: true });
    expect(loader.loads).toEqual(['medium']);
  });
});

describe('createFetchIrLoader (#453)', () => {
  function fakeCtx(duration = 0.35) {
    return {
      decodeAudioData: vi.fn(async (data: ArrayBuffer) => {
        expect(data.byteLength).toBe(4);
        return { numberOfChannels: 2, duration } as AudioBuffer;
      }),
    } as unknown as BaseAudioContext & { decodeAudioData: ReturnType<typeof vi.fn> };
  }

  it('fetches each IR once per page and decodes once per context', async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4])));
    const loader = createFetchIrLoader({ fetchImpl, urlFor: (id) => `/ir/${id}.opus` });
    expect(fetchImpl).not.toHaveBeenCalled();
    const a = fakeCtx();
    const b = fakeCtx();
    await loader.load(a, 'small');
    await loader.load(a, 'small');
    await loader.load(b, 'small');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith('/ir/small.opus');
    expect(a.decodeAudioData).toHaveBeenCalledTimes(1);
    expect(b.decodeAudioData).toHaveBeenCalledTimes(1);
  });

  it('never caches a failure, and rejects an IR whose length is wrong', async () => {
    let status = 500;
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4]), { status }));
    const loader = createFetchIrLoader({ fetchImpl, urlFor: (id) => `/ir/${id}.opus` });
    const ctx = fakeCtx();
    await expect(loader.load(ctx, 'small')).rejects.toBeInstanceOf(IrUnavailableError);
    status = 200;
    await expect(loader.load(ctx, 'small')).resolves.toBeTruthy();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await expect(loader.load(fakeCtx(2), 'medium')).rejects.toThrow(/decoded 2.000 s, expected 0.7 s/);
  });

  it('decodes at the context rate (a real 44.1 kHz context gets a 44.1 kHz buffer)', async () => {
    const ctx = createOfflineContext({ length: 128, sampleRate: 44_100 });
    const buffer = await synthIrLoader().load(ctx, 'small');
    expect(buffer.sampleRate).toBe(44_100);
  });
});

it('FxRack exposes retry for unavailable modules', () => {
  expect(typeof FxRack.prototype.retry).toBe('function');
});
