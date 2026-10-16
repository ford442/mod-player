/**
 * #490 §3: WAV export == what you heard, sample for sample.
 *
 * "Live" is the COMPILED JS worklet (public/worklets/openmpt-worklet.js) rendering through the
 * REAL libopenmpt wasm in a fake AudioWorkletGlobalScope at the locked player rate. "Export" is
 * renderModuleOffline() at its DEFAULT rate, on a separate libopenmpt instance, exactly as the
 * export worker calls it. With the FX rack on, the live dry stream goes through the live rack
 * (node-web-audio-api) and the export's dry render goes through renderFxOffline(), and the two
 * must still null.
 *
 * Before #490 the export defaulted to 44.1 kHz, so none of this could even be compared: a
 * different frame count, libopenmpt's resampler at another ratio, and the room IRs / character
 * halfband running at a rate nobody listened to.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAIN_TO_WORKLET as MT, WORKLET_TO_MAIN as WT } from '../audio-worklet/workletProtocolConstants';
import { fxTailSeconds, renderFxOffline } from '../audio/fx/offline/renderFxOffline';
import { FX_FACTORY_PRESETS } from '../audio/fx/spec/presets';
import type { FxRackState } from '../audio/fx/types';
import type { LibOpenMPT } from '../types';
import { renderModuleOffline } from '../utils/offlineRender';
import { CD_SAMPLE_RATE, PLAYER_SAMPLE_RATE } from '../utils/sampleRates';
import { EXPORT_SAMPLE_RATE, EXPORT_SAMPLE_RATE_OPTIONS } from '../utils/wavEncoder';
import { CHARACTER_WORKLET, renderRack, synthIrLoader } from './helpers/fxRender';
import { loadLibOpenMPTNode } from './helpers/libopenmptNode';
import { WEB_AUDIO_TIMEOUT_MS, installWebAudioGlobals, maxAbsDiff } from './helpers/webAudioNode';
import { FakeScope, QUANTUM, SAMPLE_RATE as WORKLET_RATE, initLib, read } from './helpers/workletScope';

const SECONDS = 1.5;
const MOD = new Uint8Array(read('public/4-mat_madness.mod'));
const FX_TOLERANCE = 1e-4;

/** What the live worklet hands the audio graph for the first `frames` frames after load. */
async function renderLive(frames: number): Promise<Float32Array<ArrayBuffer>[]> {
  const scope = new FakeScope();
  const { node, send } = scope.newNode();
  await initLib(scope, send);
  await send({ type: MT.load, moduleData: scope.toRealm(MOD) });
  expect(scope.count(WT.error)).toBe(0);
  expect(scope.count(WT.loaded)).toBe(1);

  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  const l = new Float32Array(QUANTUM);
  const r = new Float32Array(QUANTUM);
  for (let at = 0; at < frames; at += QUANTUM) {
    scope.advance(QUANTUM / WORKLET_RATE);
    node.process([[]], [[l, r]], {});
    const n = Math.min(QUANTUM, frames - at);
    left.set(l.subarray(0, n), at);
    right.set(r.subarray(0, n), at);
  }
  return [left, right];
}

describe('export == live (#490)', () => {
  let lib: LibOpenMPT;
  let restore = () => {};
  let live: Float32Array<ArrayBuffer>[];

  beforeAll(async () => {
    ({ lib, restore } = await loadLibOpenMPTNode());
    live = await renderLive(Math.round(SECONDS * PLAYER_SAMPLE_RATE));
  }, 60_000);

  afterAll(() => restore());

  it('exports at the rate playback renders at by default; 44.1 kHz is an explicit option', () => {
    expect(EXPORT_SAMPLE_RATE).toBe(PLAYER_SAMPLE_RATE);
    expect(WORKLET_RATE).toBe(PLAYER_SAMPLE_RATE);
    expect(EXPORT_SAMPLE_RATE_OPTIONS.map((o) => o.rate)).toEqual([PLAYER_SAMPLE_RATE, CD_SAMPLE_RATE]);
  });

  it('dry: the default export nulls against the live worklet output', () => {
    const exported = renderModuleOffline(lib, { fileData: MOD, loop: false, endSeconds: SECONDS });
    expect(exported.sampleRate).toBe(PLAYER_SAMPLE_RATE);
    const frames = live[0]!.length;
    expect(exported.frameCount).toBeGreaterThanOrEqual(frames);
    // Audible, so a null of two silent buffers can't pass by accident.
    expect(Math.max(...live[0]!.subarray(0, PLAYER_SAMPLE_RATE).map(Math.abs))).toBeGreaterThan(0.01);
    expect(maxAbsDiff([exported.left, exported.right], live, 0, frames)).toBe(0);
  });

  it('dry: the CD-rate option really renders at 44.1 kHz', () => {
    const exported = renderModuleOffline(lib, { fileData: MOD, loop: false, endSeconds: SECONDS, sampleRate: CD_SAMPLE_RATE });
    expect(exported.sampleRate).toBe(CD_SAMPLE_RATE);
    expect(Math.abs(exported.frameCount - SECONDS * CD_SAMPLE_RATE)).toBeLessThan(4096);
  });

  it('FX rack on: export through renderFxOffline nulls against the live rack on the live stream', { timeout: WEB_AUDIO_TIMEOUT_MS * 4 }, async () => {
    installWebAudioGlobals();
    const dry = renderModuleOffline(lib, { fileData: MOD, loop: false, endSeconds: SECONDS });
    const frames = live[0]!.length;
    const exportDry = { left: dry.left.slice(0, frames), right: dry.right.slice(0, frames), sampleRate: dry.sampleRate };

    for (const id of ['amiga-a500', 'tape-glue', 'club'] as const) {
      const state: FxRackState = FX_FACTORY_PRESETS.find((p) => p.id === id)!.state;
      // Live: the engine keeps streaming (silence after the song), it never "ends" mid-render.
      const tailFrames = Math.ceil(fxTailSeconds(state, PLAYER_SAMPLE_RATE) * PLAYER_SAMPLE_RATE);
      const padded = live.map((ch) => {
        const longer = new Float32Array(ch.length + tailFrames);
        longer.set(ch);
        return longer;
      });
      const liveOut = (await renderRack({ input: padded, sampleRate: PLAYER_SAMPLE_RATE, initial: state, mode: 'live' })).out;
      const exported = await renderFxOffline(exportDry, state, {
        characterWorkletUrl: CHARACTER_WORKLET,
        irLoader: synthIrLoader(),
      });
      expect(exported.sampleRate, id).toBe(PLAYER_SAMPLE_RATE);
      expect(exported.left.length, id).toBe(liveOut[0]!.length);
      expect(maxAbsDiff([exported.left, exported.right], liveOut), id).toBeLessThanOrEqual(FX_TOLERANCE);
    }
  });
});
