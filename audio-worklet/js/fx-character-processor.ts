/**
 * FX rack character stage (#453) — AudioWorklet processor source.
 *
 * Compiled by scripts/build-js-worklet.mjs into
 * public/worklets/fx-character-worklet.js (classic IIFE; edit this file, then
 * `npm run build:js-worklet`). Registered as CHARACTER_PROCESSOR_NAME.
 *
 * Stereo in → stereo out (mono input feeds both channels). Every parameter is
 * a k-rate AudioParam; the kernels smooth them per sample. No allocation in
 * process(): all state lives in the two CharacterChannel instances.
 *
 * State resets itself after a processing gap. The rack disconnects a disabled
 * module from both sides, so Chrome stops calling process(); when it is
 * re-enabled the clock has jumped, and stale filter / DC-blocker / resampler
 * state would otherwise ring out under the fade-in. Detecting the gap from
 * `currentTime` keeps this deterministic (no port-message timing).
 */
import {
  CHARACTER_MSG_DISPOSE,
  CHARACTER_MSG_RESET,
  CHARACTER_PARAM_DESCRIPTORS,
  CHARACTER_PROCESSOR_NAME,
  characterParamArray,
} from '../fxCharacterParams';
import { CharacterChannel } from './fx/characterChannel';

class FxCharacterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return CHARACTER_PARAM_DESCRIPTORS;
  }

  /** Live param values, fxCharacterParams index layout. */
  private readonly params: Float64Array = characterParamArray();
  private readonly left: CharacterChannel;
  private readonly right: CharacterChannel;
  private primed = false;
  private disposed = false;
  private resetRequested = false;
  private expectedTime = 0;

  constructor(options?: AudioWorkletCtorOptions) {
    super(options);
    this.left = new CharacterChannel(sampleRate, this.params);
    this.right = new CharacterChannel(sampleRate, this.params);
    this.port.onmessage = (event: WorkletMessageEvent) => {
      const data = event.data as { type?: unknown } | null;
      if (!data) return;
      if (data.type === CHARACTER_MSG_RESET) this.resetRequested = true;
      else if (data.type === CHARACTER_MSG_DISPOSE) this.disposed = true;
    };
  }

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean {
    // @noalloc:begin
    if (this.disposed) return false;
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const outL = output[0]!;
    const frames = outL.length;

    const params = this.params;
    for (let i = 0; i < CHARACTER_PARAM_DESCRIPTORS.length; i++) {
      const d = CHARACTER_PARAM_DESCRIPTORS[i]!;
      const values = parameters[d.name];
      params[i] = values !== undefined && values.length > 0 ? values[0]! : d.defaultValue;
    }
    this.left.setTargets(params);
    this.right.setTargets(params);

    // First block, explicit reset, or a gap in the render clock: start clean
    // at the current params instead of gliding from stale state.
    const gap = this.primed && currentTime > this.expectedTime + (0.5 * frames) / sampleRate;
    if (!this.primed || gap || this.resetRequested) {
      this.left.reset();
      this.right.reset();
      this.left.snap();
      this.right.snap();
      this.primed = true;
      this.resetRequested = false;
    }
    this.expectedTime = currentTime + frames / sampleRate;

    const input = inputs[0];
    const inL = input !== undefined && input.length > 0 ? input[0]! : null;
    const inR = input !== undefined && input.length > 1 ? input[1]! : inL;

    this.left.process(inL, outL, frames);
    if (output.length > 1) this.right.process(inR, output[1]!, frames);
    for (let c = 2; c < output.length; c++) output[c]!.fill(0);

    this.left.flushDenormals();
    this.right.flushDenormals();
    return true;
    // @noalloc:end
  }
}

registerProcessor(CHARACTER_PROCESSOR_NAME, FxCharacterProcessor);
