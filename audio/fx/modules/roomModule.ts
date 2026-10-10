/**
 * Convolution room (#453) — a parallel send, so the module output always
 * carries the dry signal:
 *
 *   input ─┬──────────────────────────────────────────────────────────────▶ output
 *          └─ send(0⇄1) ─ mix ─ predelay ─ low-cut ─┬─ convA ─ xfA ─┘
 *                                                   └─ convB ─ xfB ─┘
 *
 * With the send at 0 the output equals the input exactly, so the slot swaps
 * to this module silently and only then fades the send in (`fadeIn`); on
 * disable the send fades out first and the tail rings out before the slot
 * swaps back (`fadeOut`). Changing the IR loads the new one, then crossfades
 * the two convolvers over 50 ms (a fresh ConvolverNode per IR: replacing a
 * live node's buffer clicks).
 */
import { FX_CROSSFADE_S, FX_LOOKAHEAD_S, FadeScheduler, setParam } from '../automation';
import type { RoomIrId, RoomParams } from '../types';
import type { FxModuleEnv, FxModuleInstance } from './types';

const IR_CROSSFADE_S = 0.05;
const MAX_PREDELAY_S = 0.2;
/** Extra margin on the reported tail (predelay and IR length are exact). */
const TAIL_MARGIN_S = 0.05;

interface ConvolverPath {
  conv: ConvolverNode;
  fade: GainNode;
  irId: RoomIrId;
  duration: number;
}

export async function createRoomModule(
  ctx: BaseAudioContext,
  params: RoomParams,
  env: FxModuleEnv,
): Promise<FxModuleInstance<'room'> | null> {
  const loader = env.irLoader;
  if (!loader) {
    env.onStatus?.('room', 'unavailable', 'no IR loader');
    return null;
  }
  env.onStatus?.('room', 'loading');
  let firstIr: AudioBuffer;
  try {
    firstIr = await loader.load(ctx, params.ir);
  } catch (err) {
    env.onStatus?.('room', 'unavailable', err instanceof Error ? err.message : String(err));
    return null;
  }

  const input = ctx.createGain();
  const output = ctx.createGain();
  input.connect(output); // the dry signal, always

  const send = ctx.createGain();
  const sendFade = new FadeScheduler(send.gain, 0, FX_CROSSFADE_S);
  const mix = ctx.createGain();
  const predelay = ctx.createDelay(MAX_PREDELAY_S);
  const lowCut = ctx.createBiquadFilter();
  lowCut.type = 'highpass';
  lowCut.Q.value = Math.SQRT1_2;
  input.connect(send);
  send.connect(mix);
  mix.connect(predelay);
  predelay.connect(lowCut);

  const makePath = (buffer: AudioBuffer, irId: RoomIrId, gain: number): ConvolverPath => {
    const conv = ctx.createConvolver();
    conv.normalize = false; // IRs are unit-energy; `mix` sets the level
    conv.buffer = buffer;
    const fade = ctx.createGain();
    fade.gain.value = gain;
    lowCut.connect(conv);
    conv.connect(fade);
    fade.connect(output);
    return { conv, fade, irId, duration: buffer.duration };
  };
  const dropPath = (path: ConvolverPath) => {
    try { lowCut.disconnect(path.conv); } catch { /* gone */ }
    path.conv.disconnect();
    path.fade.disconnect();
  };

  let current = makePath(firstIr, params.ir, 1);
  /** The IR the params ask for (a load may still be pending). */
  let wantedIr = params.ir;
  let predelaySeconds = params.predelay / 1000;
  env.onStatus?.('room', 'ready');

  const switchIr = (irId: RoomIrId, at: number, immediate: boolean) => {
    wantedIr = irId;
    env.onStatus?.('room', 'loading');
    loader.load(ctx, irId).then(
      (buffer) => {
        if (wantedIr !== irId || current.irId === irId) return;
        const old = current;
        if (immediate) {
          dropPath(old);
          current = makePath(buffer, irId, 1);
        } else {
          const start = Math.max(at, ctx.currentTime + FX_LOOKAHEAD_S);
          const next = makePath(buffer, irId, 0);
          old.fade.gain.setValueAtTime(1, start);
          old.fade.gain.linearRampToValueAtTime(0, start + IR_CROSSFADE_S);
          next.fade.gain.setValueAtTime(0, start);
          next.fade.gain.linearRampToValueAtTime(1, start + IR_CROSSFADE_S);
          current = next;
          const release = () => dropPath(old);
          if (env.scheduler) env.scheduler.at(start + IR_CROSSFADE_S + old.duration + TAIL_MARGIN_S, release);
        }
        env.onStatus?.('room', 'ready');
      },
      (err: unknown) => {
        // Keep the IR that's playing; report the failed one.
        if (wantedIr === irId) {
          env.onStatus?.('room', 'unavailable', err instanceof Error ? err.message : String(err));
        }
      },
    );
  };

  const module: FxModuleInstance<'room'> = {
    id: 'room',
    input,
    output,
    latencySeconds: 0,
    warmupSeconds: 0,
    tailSeconds: (p) => current.duration + p.predelay / 1000 + TAIL_MARGIN_S,
    setParams(p, at, immediate) {
      setParam(mix.gain, p.mix, at, immediate);
      setParam(predelay.delayTime, Math.min(MAX_PREDELAY_S, p.predelay / 1000), at, immediate);
      setParam(lowCut.frequency, p.lowCut, at, immediate);
      predelaySeconds = p.predelay / 1000;
      if (p.ir !== wantedIr) switchIr(p.ir, at, immediate);
    },
    fadeIn(at, immediate) {
      if (immediate) {
        sendFade.setStatic(1);
        return at;
      }
      return sendFade.fadeTo(1, at).end;
    },
    fadeOut(at, immediate) {
      if (immediate) {
        sendFade.setStatic(0);
        return at;
      }
      const window = sendFade.fadeTo(0, at);
      // The slot may swap back once the tail has rung out.
      return window.end + predelaySeconds + current.duration + TAIL_MARGIN_S;
    },
    dispose() {
      dropPath(current);
      for (const node of [input, send, mix, predelay, lowCut, output]) node.disconnect();
    },
  };
  module.setParams(params, 0, true);
  return module;
}
