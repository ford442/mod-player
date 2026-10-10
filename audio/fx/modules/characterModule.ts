/** Character stage (#453): the typed AudioWorklet (tape, Amiga LED, crush). */
import {
  CHARACTER_LATENCY_FRAMES,
  CHARACTER_MSG_DISPOSE,
  CHARACTER_PARAM_NAMES,
  CHARACTER_PROCESSOR_NAME,
  LED_MODEL_A1200,
  LED_MODEL_A500,
  type CharacterParamValues,
} from '../../../audio-worklet/fxCharacterParams';
import { stepParam } from '../automation';
import { ensureCharacterWorklet } from '../character/characterWorkletLoader';
import { characterWorkletUrl } from '../character/fxWorkletUrl';
import type { CharacterParams } from '../types';
import type { FxModuleEnv, FxModuleInstance } from './types';

/** Rack params → the processor's AudioParam values. */
export function characterParamValues(p: CharacterParams): CharacterParamValues {
  return {
    tapeOn: p.tapeOn ? 1 : 0,
    drive: p.drive,
    bias: p.bias,
    ledOn: p.ledOn ? 1 : 0,
    ledModel: p.ledModel === 'a1200' ? LED_MODEL_A1200 : LED_MODEL_A500,
    crushOn: p.crushOn ? 1 : 0,
    crushRate: p.crushRate,
    crushBits: p.crushBits,
    outputGain: p.outputGain,
  };
}

export async function createCharacterModule(
  ctx: BaseAudioContext,
  params: CharacterParams,
  env: FxModuleEnv,
): Promise<FxModuleInstance<'character'>> {
  await ensureCharacterWorklet(ctx, env.characterWorkletUrl ?? characterWorkletUrl());
  const node = new AudioWorkletNode(ctx, CHARACTER_PROCESSOR_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
    parameterData: characterParamValues(params),
  });
  const latency = CHARACTER_LATENCY_FRAMES / ctx.sampleRate;

  return {
    id: 'character',
    input: node,
    output: node,
    latencySeconds: latency,
    warmupSeconds: 0.005,
    tailSeconds: () => latency,
    setParams(p, at, immediate) {
      // The processor smooths every param itself, so live changes just step.
      const values = characterParamValues(p);
      for (const name of CHARACTER_PARAM_NAMES) {
        const param = node.parameters.get(name);
        if (param) stepParam(param, values[name], at, immediate);
      }
    },
    dispose() {
      node.port.postMessage({ type: CHARACTER_MSG_DISPOSE });
      node.disconnect();
    },
  };
}
