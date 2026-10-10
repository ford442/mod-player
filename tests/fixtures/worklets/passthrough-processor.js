// Test fixture for tests/webAudioNodeHarness.test.ts — a k-rate gain worklet
// used to prove node-web-audio-api runs AudioWorklets inside an
// OfflineAudioContext deterministically. Not shipped.
class SpikePassthroughProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'gain', defaultValue: 1, minValue: 0, maxValue: 2, automationRate: 'k-rate' }];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    const gain = parameters.gain[0];
    for (let c = 0; c < output.length; c++) {
      const src = input && input[c] ? input[c] : null;
      const dst = output[c];
      for (let i = 0; i < dst.length; i++) dst[i] = src ? src[i] * gain : 0;
    }
    return true;
  }
}

registerProcessor('test-passthrough', SpikePassthroughProcessor);
