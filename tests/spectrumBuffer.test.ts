/**
 * ComputeAnalysis → spectrum buffer contract (the buffer `spectrumBuffer`
 * shaders bind read-only-storage). Vitest has no GPU, so a recording fake
 * device stands in: these tests pin usage flags, lifetime and the idle clear —
 * the parts a shader author cannot see fail on real hardware.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ComputeAnalysis,
  SPECTRUM_BIN_COUNT,
  SPECTRUM_BUFFER_BYTES,
} from '../src/renderers/webgpu/computeAnalysis';

// Values from the WebGPU spec — Node has no GPU* globals.
const BUFFER_USAGE = {
  MAP_READ: 0x0001,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
};

interface FakeBuffer {
  size: number;
  usage: number;
  destroyed: boolean;
  destroy(): void;
}

function makeFakeDevice() {
  const buffers: FakeBuffer[] = [];
  const device = {
    queue: { writeBuffer: vi.fn() },
    createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createComputePipeline: () => ({}),
    createBindGroup: () => ({}),
    createTexture: () => ({ destroy: vi.fn() }),
    createBuffer: ({ size, usage }: { size: number; usage: number }) => {
      const buffer: FakeBuffer = {
        size,
        usage,
        destroyed: false,
        destroy() {
          this.destroyed = true;
        },
      };
      buffers.push(buffer);
      return buffer;
    },
  };
  return { device: device as unknown as GPUDevice, buffers };
}

function makeFakeEncoder() {
  const pass = {
    setBindGroup: vi.fn(),
    setPipeline: vi.fn(),
    dispatchWorkgroups: vi.fn(),
    end: vi.fn(),
  };
  const encoder = {
    beginComputePass: vi.fn(() => pass),
    copyBufferToTexture: vi.fn(),
    clearBuffer: vi.fn(),
  };
  return { encoder: encoder as unknown as GPUCommandEncoder, spies: encoder, pass };
}

/** One 256-frame stereo block of a sine — enough for `pcm.frames > 0`. */
const block = () => new Float32Array(256 * 2).fill(0.25);

describe('ComputeAnalysis spectrum buffer', () => {
  let nowMs = 1000;

  beforeEach(() => {
    vi.stubGlobal('GPUBufferUsage', BUFFER_USAGE);
    vi.stubGlobal('GPUShaderStage', { COMPUTE: 4 });
    vi.stubGlobal('GPUTextureUsage', { COPY_DST: 2, TEXTURE_BINDING: 4 });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => '// stub' })));
    nowMs = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function create() {
    const { device, buffers } = makeFakeDevice();
    const analysis = await ComputeAnalysis.create(device);
    expect(analysis).not.toBeNull();
    return { analysis: analysis as ComputeAnalysis, buffers };
  }

  it('sizes the buffer for exactly SPECTRUM_BIN_COUNT f32s', () => {
    expect(SPECTRUM_BUFFER_BYTES).toBe(SPECTRUM_BIN_COUNT * 4);
  });

  it('exposes a storage buffer the render pass can read and the idle path can clear', async () => {
    const { analysis, buffers } = await create();
    const spectrum = analysis.spectrumBuffer as unknown as FakeBuffer;

    expect(spectrum).toBeTruthy();
    expect(buffers).toContain(spectrum);
    expect(spectrum.size).toBe(SPECTRUM_BUFFER_BYTES);
    expect(spectrum.usage & BUFFER_USAGE.STORAGE).toBeTruthy();
    // COPY_DST is what encoder.clearBuffer needs; COPY_SRC feeds the readback.
    expect(spectrum.usage & BUFFER_USAGE.COPY_DST).toBeTruthy();
    expect(spectrum.usage & BUFFER_USAGE.COPY_SRC).toBeTruthy();
  });

  it('returns the same buffer every call (bind groups key on identity)', async () => {
    const { analysis } = await create();
    expect(analysis.spectrumBuffer).toBe(analysis.spectrumBuffer);
  });

  it('returns null once disposed, so callers swap in their placeholder', async () => {
    const { analysis, buffers } = await create();
    const spectrum = analysis.spectrumBuffer as unknown as FakeBuffer;
    analysis.dispose();

    expect(analysis.spectrumBuffer).toBeNull();
    expect(spectrum.destroyed).toBe(true);
    expect(buffers.every((b) => b.destroyed)).toBe(true);
  });

  it('does not clear before any spectrum has been written', async () => {
    const { analysis } = await create();
    const { encoder, spies } = makeFakeEncoder();

    expect(analysis.encode(encoder)).toBe(false);
    expect(spies.clearBuffer).not.toHaveBeenCalled();
  });

  it('runs the compute pass, and leaves the buffer alone, while PCM is live', async () => {
    const { analysis } = await create();
    analysis.writePcm(block(), 2, 48000);
    const { encoder, spies, pass } = makeFakeEncoder();

    expect(analysis.encode(encoder)).toBe(true);
    expect(pass.dispatchWorkgroups).toHaveBeenCalledTimes(2);
    expect(spies.clearBuffer).not.toHaveBeenCalled();
  });

  it('zeroes the bins exactly once when PCM goes stale', async () => {
    const { analysis } = await create();
    analysis.writePcm(block(), 2, 48000);
    expect(analysis.encode(makeFakeEncoder().encoder)).toBe(true);

    // Playback stops: the worklet emits nothing, time moves on.
    nowMs += 1000;
    const idle = makeFakeEncoder();
    expect(analysis.encode(idle.encoder)).toBe(false);
    expect(idle.spies.clearBuffer).toHaveBeenCalledTimes(1);
    expect(idle.spies.clearBuffer).toHaveBeenCalledWith(analysis.spectrumBuffer);

    // Every later idle frame is free — no per-frame clear.
    const later = makeFakeEncoder();
    expect(analysis.encode(later.encoder)).toBe(false);
    expect(later.spies.clearBuffer).not.toHaveBeenCalled();
  });

  it('zeroes again on re-enable after a silent gap, and only once per live run', async () => {
    const { analysis } = await create();

    for (let run = 0; run < 2; run++) {
      analysis.writePcm(block(), 2, 48000);
      expect(analysis.encode(makeFakeEncoder().encoder)).toBe(true);
      nowMs += 1000;
      const idle = makeFakeEncoder();
      analysis.encode(idle.encoder);
      expect(idle.spies.clearBuffer).toHaveBeenCalledTimes(1);
      nowMs += 1000;
    }
  });

  it('never touches the encoder after dispose', async () => {
    const { analysis } = await create();
    analysis.writePcm(block(), 2, 48000);
    analysis.encode(makeFakeEncoder().encoder);
    analysis.dispose();

    const { encoder, spies } = makeFakeEncoder();
    expect(analysis.encode(encoder)).toBe(false);
    expect(spies.clearBuffer).not.toHaveBeenCalled();
    expect(spies.beginComputePass).not.toHaveBeenCalled();
  });
});
