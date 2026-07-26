import { describe, expect, it, vi } from 'vitest';
import { refreshMainBindGroup, type BindGroupState } from '../src/renderers/webgpu/bindGroup';
import { uploadOscilloscopeTexture } from '../src/renderers/webgpu/frameDraw';
import type { GpuResourcePool } from '../utils/gpuResourcePool';

function makeExtendedBindGroupState(overrides: Partial<BindGroupState> = {}): BindGroupState {
  const cellsBuffer = { size: 1024 } as GPUBuffer;
  const uniformBuffer = {} as GPUBuffer;
  const rowFlagsBuffer = {} as GPUBuffer;
  const channelsBuffer = {} as GPUBuffer;
  const pipeline = {
    getBindGroupLayout: () => ({} as GPUBindGroupLayout),
  } as GPURenderPipeline;
  return {
    pipeline,
    cellsBuffer,
    uniformBuffer,
    rowFlagsBuffer,
    channelsBuffer,
    textureResources: {
      sampler: {} as GPUSampler,
      view: {} as GPUTextureView,
    },
    instrumentPaletteTexture: null,
    audioReactiveUniformBuffer: null,
    layoutType: 'extended',
    ...overrides,
  };
}

function makePool(alive: Set<unknown>): GpuResourcePool {
  return {
    isAlive: (resource: unknown) => alive.has(resource),
    isDisposed: false,
  } as unknown as GpuResourcePool;
}

describe('refreshMainBindGroup oscilloscope', () => {
  it('returns null for v0.55 when osc texture is missing', () => {
    const device = { createBindGroup: vi.fn() } as unknown as GPUDevice;
    const state = makeExtendedBindGroupState();
    const alive = new Set<unknown>([state.cellsBuffer, state.uniformBuffer]);
    const pool = makePool(alive);

    const result = refreshMainBindGroup(device, pool, state, 'patternv0.55.wgsl', null);
    expect(result).toBeNull();
    expect(device.createBindGroup).not.toHaveBeenCalled();
  });

  it('includes binding 6 when osc texture is alive', () => {
    const oscView = {} as GPUTextureView;
    const oscTexture = { createView: () => oscView } as GPUTexture;
    const bindGroup = {} as GPUBindGroup;
    const device = {
      createBindGroup: vi.fn(() => bindGroup),
    } as unknown as GPUDevice;
    const state = makeExtendedBindGroupState();
    const alive = new Set<unknown>([state.cellsBuffer, state.uniformBuffer, oscTexture]);
    const pool = makePool(alive);

    const result = refreshMainBindGroup(device, pool, state, 'patternv0.55.wgsl', oscTexture);
    expect(result).toBe(bindGroup);
    expect(device.createBindGroup).toHaveBeenCalledOnce();
    const callArg = (device.createBindGroup as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      entries: GPUBindGroupEntry[];
    };
    expect(callArg.entries.some((e) => e.binding === 6)).toBe(true);
    expect(callArg.entries.find((e) => e.binding === 6)?.resource).toBe(oscView);
  });

  it('returns null when osc texture is not alive in pool', () => {
    const oscTexture = { createView: vi.fn() } as unknown as GPUTexture;
    const device = { createBindGroup: vi.fn() } as unknown as GPUDevice;
    const state = makeExtendedBindGroupState();
    const alive = new Set<unknown>([state.cellsBuffer, state.uniformBuffer]);
    const pool = makePool(alive);

    const result = refreshMainBindGroup(device, pool, state, 'patternv0.55.wgsl', oscTexture);
    expect(result).toBeNull();
    expect(oscTexture.createView).not.toHaveBeenCalled();
  });
});

describe('uploadOscilloscopeTexture', () => {
  it('writes worklet buffer bytes to the GPU texture', () => {
    const writeTexture = vi.fn();
    const device = { queue: { writeTexture } } as unknown as GPUDevice;
    const oscTexture = {} as GPUTexture;
    const alive = new Set<unknown>([oscTexture]);
    const pool = makePool(alive);
    const oscData = new Float32Array(2048);
    oscData[0] = 0.5;
    const oscBufferRef = { current: oscData };

    uploadOscilloscopeTexture(device, pool, 'patternv0.55.wgsl', oscTexture, oscBufferRef);
    expect(writeTexture).toHaveBeenCalledOnce();
  });

  it('skips upload when osc buffer ref is empty', () => {
    const writeTexture = vi.fn();
    const device = { queue: { writeTexture } } as unknown as GPUDevice;
    const oscTexture = {} as GPUTexture;
    const alive = new Set<unknown>([oscTexture]);
    const pool = makePool(alive);

    uploadOscilloscopeTexture(device, pool, 'patternv0.55.wgsl', oscTexture, { current: null });
    expect(writeTexture).not.toHaveBeenCalled();
  });
});
