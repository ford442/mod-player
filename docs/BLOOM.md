# Bloom Post-Processing (HDR Bloom)

This document explains how to use the new bloom shaders and `BloomPostProcessor` helper.

Files added:
- `shaders/patternv0.31.wgsl` — Official v0.31 HDR-capable sequencer fragment shader (adds bloom uniforms).
- `shaders/patternv0.30_bloom.wgsl` — Legacy bloom proof-of-concept (kept for reference).
- `shaders/bloom_threshold.wgsl` — brightness extraction (soft threshold).
- `shaders/bloom_blur.wgsl` — separable Gaussian blur (horizontal & vertical passes).
- `shaders/bloom_composite.wgsl` — composite HDR bloom back onto the scene.
- `utils/bloomPostProcessor.ts` — TypeScript helper class to do the multi-pass pipeline.

## Usage (recommended)

If you use Vite you can import the WGSL files as raw text and pass them to the processor:

```ts
import thresholdShader from '../shaders/bloom_threshold.wgsl?raw';
import blurShader from '../shaders/bloom_blur.wgsl?raw';
import compositeShader from '../shaders/bloom_composite.wgsl?raw';
import { BloomPostProcessor } from '../utils/bloomPostProcessor';

const canvas = document.querySelector('canvas')! as HTMLCanvasElement;
const context = canvas.getContext('webgpu') as unknown as GPUCanvasContext;
const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();

const bloom = new BloomPostProcessor(device, canvas, context, {
  shaderThreshold: thresholdShader,
  shaderBlur: blurShader,
  shaderComposite: compositeShader,
  finalFormat: 'bgra8unorm',
});
await bloom.init();

function renderFrame() {
  const enc = device.createCommandEncoder();

  bloom.render(enc, (pass) => {
    // Use your sequencer pipeline here (render into the HDR scene texture)
    // Example:
    // pass.setPipeline(sequencerPipeline);
    // pass.setBindGroup(0, sequencerBindGroup);
    // pass.draw(6, numCells);
  });

  device.queue.submit([enc.finish()]);

  // Update bloom settings if you want (pulse it, sync to music, etc.)
  bloom.updateUniforms(
    Math.sin(performance.now() * 0.001) * 0.5 + 1.5, // bloomIntensity
    0.7, // threshold
    0.2  // knee
  );

  requestAnimationFrame(renderFrame);
}

renderFrame();
```

Notes & tips:
- The `patternv0.30_bloom.wgsl` shader writes HDR values for lights (values can exceed 1.0) which the bloom pipeline extracts and blurs.
- The blur chain runs at half resolution for performance.
- Uniform buffers are padded to 16 bytes to satisfy WebGPU alignment requirements.
- If your app uses a different swapchain format, pass `finalFormat` to the processor constructor.

Performance tuning:
- Use a smaller blur chain (quarter-res) for mobile.
- Reduce blur taps from 13 to 9 in `bloom_blur.wgsl` for faster performance.
- Cache the blur passes in a render bundle if the resolution doesn't change.

Enjoy the neon bloom! 🎛️✨
