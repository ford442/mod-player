/**
 * FxRack on real Web Audio (node-web-audio-api) (#453): bypass identity,
 * module wiring, the character worklet inside an offline graph, serialization,
 * latency/tail bookkeeping and live enable → disable returning to a bit-exact
 * wire.
 */
import { describe, expect, it } from 'vitest';
import { CHARACTER_LATENCY_FRAMES } from '../audio-worklet/fxCharacterParams';
import { CharacterChannel } from '../audio-worklet/js/fx/characterChannel';
import { characterParamArray } from '../audio-worklet/fxCharacterParams';
import { COMP_LOOKAHEAD_S } from '../audio/fx/modules/compModule';
import { characterParamValues } from '../audio/fx/modules/characterModule';
import { defaultFxRackState, parseFxRackState } from '../audio/fx/spec/schema';
import { lowSine, program } from '../audio/fx/testing/testSignals';
import type { FxRackState } from '../audio/fx/types';
import { FX_CROSSFADE_S, quantumTime, renderRack } from './helpers/fxRender';
import { WEB_AUDIO_TIMEOUT_MS, maxAbsDiff } from './helpers/webAudioNode';

const SR = 48_000;

function withModules(patch: (s: FxRackState) => void): FxRackState {
  const state = defaultFxRackState();
  patch(state);
  return parseFxRackState(state);
}

const rms = (x: Float32Array, from = 0) => {
  let sum = 0;
  for (let i = from; i < x.length; i++) sum += x[i]! * x[i]!;
  return Math.sqrt(sum / (x.length - from));
};

describe('FxRack (#453)', { timeout: WEB_AUDIO_TIMEOUT_MS }, () => {
  it('a bypassed rack is a bit-exact wire — also with modules created but bypassed', async () => {
    const input = program({ sampleRate: SR, seconds: 0.5 });
    const empty = await renderRack({ input, sampleRate: SR, initial: defaultFxRackState(), mode: 'static' });
    expect(maxAbsDiff(empty.out, input)).toBe(0);
    const prepared = await renderRack({
      input,
      sampleRate: SR,
      initial: defaultFxRackState(),
      mode: 'static',
      prepare: ['character', 'eq', 'comp'],
    });
    expect(maxAbsDiff(prepared.out, input)).toBe(0);
  });

  it('the master switch bypasses enabled modules', async () => {
    const input = program({ sampleRate: SR, seconds: 0.25 });
    const state = withModules((s) => {
      s.enabled = false;
      s.modules.eq.enabled = true;
      s.modules.eq.params.lowGain = 12;
    });
    const { out } = await renderRack({ input, sampleRate: SR, initial: state, mode: 'static' });
    expect(maxAbsDiff(out, input)).toBe(0);
  });

  it('EQ: a +12 dB low shelf lifts a 55 Hz tone by ~12 dB', async () => {
    const input = lowSine({ sampleRate: SR, seconds: 0.5, freq: 55, amp: 0.1 });
    const state = withModules((s) => {
      s.modules.eq.enabled = true;
      s.modules.eq.params.lowGain = 12;
      s.modules.eq.params.lowFreq = 200;
    });
    const { out } = await renderRack({ input, sampleRate: SR, initial: state, mode: 'static' });
    const gainDb = 20 * Math.log10(rms(out[0]!, 4800) / rms(input[0]!, 4800));
    expect(gainDb).toBeGreaterThan(11);
    expect(gainDb).toBeLessThan(12.5);
  });

  it('the character worklet inside an offline graph matches the TS kernels bit-for-bit', async () => {
    const input = program({ sampleRate: SR, seconds: 0.25 });
    const state = withModules((s) => {
      s.modules.character.enabled = true;
      Object.assign(s.modules.character.params, {
        tapeOn: true, drive: 0.6, bias: 0.15, ledOn: true, ledModel: 'a500', crushOn: true, crushRate: 11025, crushBits: 7,
      });
    });
    const { out } = await renderRack({ input, sampleRate: SR, initial: state, mode: 'static' });
    const values = characterParamValues(state.modules.character.params);
    for (let c = 0; c < 2; c++) {
      // AudioParams are float32: feed the kernel exactly what the processor sees.
      const ch = new CharacterChannel(SR, characterParamArray(values).map(Math.fround));
      const expected = new Float32Array(input[c]!.length);
      ch.process(input[c]!, expected, expected.length);
      expect(maxAbsDiff([out[c]!], [expected])).toBe(0);
    }
  });

  it('serializes the applied state and sums latency / tail of the active modules', async () => {
    const state = withModules((s) => {
      s.modules.character.enabled = true;
      s.modules.comp.enabled = true;
      s.modules.eq.params.midGain = -3;
    });
    const { rack } = await renderRack({
      input: lowSine({ sampleRate: SR, seconds: 0.05 }),
      sampleRate: SR,
      initial: state,
      mode: 'static',
    });
    expect(rack.serialize()).toEqual(state);
    expect(rack.latencySeconds()).toBeCloseTo(CHARACTER_LATENCY_FRAMES / SR + COMP_LOOKAHEAD_S, 12);
    expect(rack.tailSeconds()).toBeCloseTo(CHARACTER_LATENCY_FRAMES / SR + COMP_LOOKAHEAD_S, 12);
  });

  it('a static reorder rewires: the result equals a rack built in that order', async () => {
    const input = program({ sampleRate: SR, seconds: 0.25 });
    const base = withModules((s) => {
      s.modules.character.enabled = true;
      s.modules.character.params.tapeOn = true;
      s.modules.character.params.drive = 0.8;
      s.modules.eq.enabled = true;
      s.modules.eq.params.lowGain = 10;
    });
    const swapped = parseFxRackState({ ...base, order: ['eq', 'character', 'comp', 'room'] });
    const direct = await renderRack({ input, sampleRate: SR, initial: swapped, mode: 'static' });
    const reordered = await renderRack({
      input,
      sampleRate: SR,
      initial: base,
      mode: 'static',
      toggles: [{ at: 0, state: swapped }],
    });
    const original = await renderRack({ input, sampleRate: SR, initial: base, mode: 'static' });
    expect(maxAbsDiff(reordered.out, direct.out)).toBe(0);
    expect(maxAbsDiff(original.out, direct.out)).toBeGreaterThan(1e-3);
  });

  it('live: enable then disable fades in and out, then the slot is a bit-exact wire again', async () => {
    const input = program({ sampleRate: SR, seconds: 1 });
    const off = defaultFxRackState();
    const on = withModules((s) => {
      s.modules.eq.enabled = true;
      s.modules.eq.params.highGain = 9;
    });
    const tOn = quantumTime(0.2, SR);
    const tOff = quantumTime(0.5, SR);
    const { out, scheduler } = await renderRack({
      input,
      sampleRate: SR,
      initial: off,
      prepare: ['eq'],
      toggles: [
        { at: tOn, state: on },
        { at: tOff, state: off },
      ],
    });
    // The deferred unwire was requested once the fade-out and tail are over.
    expect(scheduler.calls).toHaveLength(1);
    expect(scheduler.calls[0]).toBeGreaterThan(tOff + FX_CROSSFADE_S);
    // Toggles are scheduled ahead (no lookahead added): fade on starts after the 10 ms EQ warmup.
    const fadeOnStart = Math.round((tOn + 0.01) * SR);
    const fadeOffEnd = Math.round((tOff + FX_CROSSFADE_S) * SR);
    expect(maxAbsDiff(out, input, 0, fadeOnStart)).toBe(0); // untouched before the fade
    expect(maxAbsDiff(out, input, fadeOnStart + 480, Math.round(tOff * SR))).toBeGreaterThan(0.01); // EQ audible
    expect(maxAbsDiff(out, input, fadeOffEnd + 1)).toBe(0); // and gone again, exactly (wet gain is exactly 0)
  });
});
