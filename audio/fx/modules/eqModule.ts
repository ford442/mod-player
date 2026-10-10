/** 3-band EQ (#453): low shelf → peaking mid → high shelf → output trim. */
import { setParam } from '../automation';
import { dbToGain } from '../dsp';
import type { EqParams } from '../types';
import type { FxModuleInstance } from './types';

export function createEqModule(ctx: BaseAudioContext, params: EqParams): FxModuleInstance<'eq'> {
  const low = ctx.createBiquadFilter();
  low.type = 'lowshelf';
  const mid = ctx.createBiquadFilter();
  mid.type = 'peaking';
  const high = ctx.createBiquadFilter();
  high.type = 'highshelf';
  const trim = ctx.createGain();
  low.connect(mid);
  mid.connect(high);
  high.connect(trim);

  const module: FxModuleInstance<'eq'> = {
    id: 'eq',
    input: low,
    output: trim,
    latencySeconds: 0,
    warmupSeconds: 0.01,
    tailSeconds: () => 0,
    setParams(p, at, immediate) {
      setParam(low.frequency, p.lowFreq, at, immediate);
      setParam(low.gain, p.lowGain, at, immediate);
      setParam(mid.frequency, p.midFreq, at, immediate);
      setParam(mid.gain, p.midGain, at, immediate);
      setParam(mid.Q, p.midQ, at, immediate);
      setParam(high.frequency, p.highFreq, at, immediate);
      setParam(high.gain, p.highGain, at, immediate);
      setParam(trim.gain, dbToGain(p.outputGain), at, immediate);
    },
    dispose() {
      for (const node of [low, mid, high, trim]) node.disconnect();
    },
  };
  module.setParams(params, 0, true);
  return module;
}
