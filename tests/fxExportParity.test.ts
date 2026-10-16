/**
 * #453 acceptance: WAV export through the FX rack matches the live rack's
 * rendered PCM (offline vs offline, tolerance 1e-4), on real Web Audio
 * (node-web-audio-api) with the character worklet and synthesized room IRs.
 *
 * - strict: the live rack as the controller builds it vs renderFxOffline on
 *   the JSON round-tripped state, every preset, 44.1 and 48 kHz;
 * - incremental: a bypassed live rack that then glides to the preset matches
 *   the export once it has settled;
 * - completeness: every number / bool / enum param audibly changes the export
 *   and survives serialization (export still equals live);
 * - tail length, the memory guard, and a room that can't load.
 */
import { describe, expect, it } from 'vitest';
import {
  FxExportTooLongError,
  assertExportFits,
  fxTailSeconds,
  renderFxOffline,
} from '../audio/fx/offline/renderFxOffline';
import { IrUnavailableError, type IrLoader } from '../audio/fx/room/irLoader';
import { FX_PARAM_SPECS, denormalize, normalize } from '../audio/fx/spec/paramSpecs';
import { FX_FACTORY_PRESETS } from '../audio/fx/spec/presets';
import { cloneFxRackState, defaultFxRackState, parseFxRackState } from '../audio/fx/spec/schema';
import { program } from '../audio/fx/testing/testSignals';
import { FX_MODULE_IDS, type FxModuleId, type FxRackState } from '../audio/fx/types';
import { CHARACTER_WORKLET, renderRack, synthIrLoader } from './helpers/fxRender';
import { WEB_AUDIO_TIMEOUT_MS, installWebAudioGlobals, maxAbsDiff } from './helpers/webAudioNode';

const TOLERANCE = 1e-4;
const presets = FX_FACTORY_PRESETS.filter((p) => p.id !== 'flat');

async function exportRender(input: Float32Array<ArrayBuffer>[], sampleRate: number, state: FxRackState, irLoader?: IrLoader) {
  installWebAudioGlobals();
  return renderFxOffline({ left: input[0]!, right: input[1]!, sampleRate }, state, {
    characterWorkletUrl: CHARACTER_WORKLET,
    irLoader: irLoader ?? synthIrLoader(),
  });
}

/**
 * The live rack fed a continuous stream: the song, then silence for the tail —
 * what the engine produces during playback. (A source that *ends* mid-render
 * puts downstream nodes into tail handling, which neither playback nor the
 * zero-padded export ever does.)
 */
async function liveRender(input: Float32Array<ArrayBuffer>[], sampleRate: number, state: FxRackState) {
  const tailFrames = Math.ceil(fxTailSeconds(state, sampleRate) * sampleRate);
  const padded = input.map((ch) => {
    const longer = new Float32Array(ch.length + tailFrames);
    longer.set(ch);
    return longer;
  });
  return (await renderRack({ input: padded, sampleRate, initial: state, mode: 'live' })).out;
}

describe('FX export parity (#453 acceptance 4)', { timeout: WEB_AUDIO_TIMEOUT_MS * 4 }, () => {
  for (const sampleRate of [44_100, 48_000]) {
    it(`every preset: export == live rack (strict, ${sampleRate} Hz)`, async () => {
      const input = program({ sampleRate, seconds: 0.6 });
      for (const preset of presets) {
        const live = await liveRender(input, sampleRate, preset.state);
        const exported = await exportRender(input, sampleRate, preset.state);
        expect(exported.left.length, preset.id).toBe(live[0]!.length);
        expect(maxAbsDiff([exported.left, exported.right], live), preset.id).toBeLessThanOrEqual(TOLERANCE);
      }
    });
  }

  it('a live rack gliding from bypass to a preset converges on the export', async () => {
    const sampleRate = 48_000;
    const input = program({ sampleRate, seconds: 4 });
    for (const id of ['tape-glue', 'club'] as const) {
      const preset = presets.find((p) => p.id === id)!;
      const live = await renderRack({
        input,
        sampleRate,
        initial: defaultFxRackState(),
        prepare: FX_MODULE_IDS.filter((m) => preset.state.modules[m].enabled),
        toggles: [{ at: 0.05, state: preset.state }],
      });
      const exported = await exportRender(input, sampleRate, preset.state);
      // After the fades, glides, compressor envelope and IR have settled.
      const settled = 3 * sampleRate;
      expect(maxAbsDiff([exported.left, exported.right], live.out, settled, input[0]!.length), id).toBeLessThanOrEqual(TOLERANCE);
    }
  });

  /** A state where every param of `module` is audible. */
  function audibleBase(module: FxModuleId): FxRackState {
    const s = defaultFxRackState();
    s.modules[module].enabled = true;
    const p = s.modules[module].params as unknown as Record<string, unknown>;
    if (module === 'eq') Object.assign(p, { lowGain: 6, midGain: 6, highGain: 6 });
    if (module === 'comp') Object.assign(p, { threshold: -40, ratio: 4 });
    if (module === 'character') Object.assign(p, { tapeOn: true, ledOn: true, crushOn: true });
    if (module === 'room') Object.assign(p, { mix: 0.5 });
    return parseFxRackState(s);
  }

  it('every param changes the export and survives serialization (export == live)', async () => {
    const sampleRate = 44_100;
    const input = program({ sampleRate, seconds: 0.4 });
    for (const module of FX_MODULE_IDS) {
      const base = audibleBase(module);
      const baseOut = await exportRender(input, sampleRate, base);
      for (const spec of FX_PARAM_SPECS[module]) {
        const varied = cloneFxRackState(base);
        const params = varied.modules[module].params as unknown as Record<string, unknown>;
        if (spec.kind === 'number') {
          const n = normalize(spec, params[spec.key] as number);
          params[spec.key] = denormalize(spec, n > 0.5 ? n - 0.4 : n + 0.4);
        } else if (spec.kind === 'bool') {
          params[spec.key] = !(params[spec.key] as boolean);
        } else {
          params[spec.key] = spec.options.find((o) => o.value !== params[spec.key])!.value;
        }
        const label = `${module}.${spec.key}`;
        const exported = await exportRender(input, sampleRate, varied);
        const n = Math.min(exported.left.length, baseOut.left.length);
        expect(maxAbsDiff([exported.left, exported.right], [baseOut.left, baseOut.right], 0, n), `${label} is audible`).toBeGreaterThan(1e-5);
        const live = await liveRender(input, sampleRate, varied);
        expect(maxAbsDiff([exported.left, exported.right], live), `${label}: export == live`).toBeLessThanOrEqual(TOLERANCE);
      }
    }
  });

  it('extends the render by the latency + tail, and the room rings into it', async () => {
    const sampleRate = 48_000;
    const input = program({ sampleRate, seconds: 0.3 });
    const room = presets.find((p) => p.id === 'small-room')!.state;
    const out = await exportRender(input, sampleRate, room);
    const tail = fxTailSeconds(room, sampleRate);
    expect(tail).toBeCloseTo(0.35 + 0.008 + 0.05, 9);
    expect(out.tailSeconds).toBe(tail);
    expect(out.left.length).toBe(input[0]!.length + Math.ceil(tail * sampleRate));
    let energy = 0;
    for (let i = input[0]!.length; i < out.left.length; i++) energy += out.left[i]! ** 2;
    expect(energy).toBeGreaterThan(1e-4);
    expect(fxTailSeconds(defaultFxRackState(), sampleRate)).toBe(0);
  });

  it('exports without the room (and says so) when its IR cannot load here', async () => {
    const sampleRate = 44_100;
    const input = program({ sampleRate, seconds: 0.3 });
    const club = presets.find((p) => p.id === 'club')!.state;
    const failing: IrLoader = { load: (_ctx, id) => Promise.reject(new IrUnavailableError(id, 'no Opus')) };
    const out = await exportRender(input, sampleRate, club, failing);
    expect(out.warnings).toHaveLength(1);
    const noRoom = cloneFxRackState(club);
    noRoom.modules.room.enabled = false;
    const reference = await exportRender(input, sampleRate, noRoom);
    expect(maxAbsDiff([out.left, out.right], [reference.left, reference.right], 0, reference.left.length)).toBe(0);
  });

  it('refuses exports too long to fit in memory', () => {
    expect(() => assertExportFits(44_100 * 600, 44_100)).not.toThrow(); // 10 min
    expect(() => assertExportFits(44_100 * 60 * 25, 44_100)).toThrow(FxExportTooLongError); // 25 min
  });
});
