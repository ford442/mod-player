/** Glue compressor (#453): DynamicsCompressorNode → makeup gain. */
import { setParam } from '../automation';
import { dbToGain } from '../dsp';
import type { CompParams } from '../types';
import type { FxModuleInstance } from './types';

/**
 * Chrome's DynamicsCompressorNode delays its signal by a fixed look-ahead of
 * about 6 ms. Reported (export tail, UI), never compensated on the dry path.
 */
export const COMP_LOOKAHEAD_S = 0.006;

export function createCompModule(ctx: BaseAudioContext, params: CompParams): FxModuleInstance<'comp'> {
  const comp = ctx.createDynamicsCompressor();
  const makeup = ctx.createGain();
  comp.connect(makeup);

  const module: FxModuleInstance<'comp'> = {
    id: 'comp',
    input: comp,
    output: makeup,
    latencySeconds: COMP_LOOKAHEAD_S,
    warmupSeconds: 0.02,
    tailSeconds: () => COMP_LOOKAHEAD_S,
    setParams(p, at, immediate) {
      setParam(comp.threshold, p.threshold, at, immediate);
      setParam(comp.ratio, p.ratio, at, immediate);
      setParam(comp.knee, p.knee, at, immediate);
      setParam(comp.attack, p.attack, at, immediate);
      setParam(comp.release, p.release, at, immediate);
      setParam(makeup.gain, dbToGain(p.makeup), at, immediate);
    },
    dispose() {
      comp.disconnect();
      makeup.disconnect();
    },
  };
  module.setParams(params, 0, true);
  return module;
}
