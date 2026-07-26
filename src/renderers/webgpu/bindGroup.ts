import {
  usesOscilloscope,
  usesInstrumentPalette,
  usesAudioReactive,
  type LayoutType,
} from '../../../utils/shaderVersion';
import type { GpuResourcePool } from '../../../utils/gpuResourcePool';

export type { LayoutType };

export interface BindGroupTextureResources {
  sampler: GPUSampler;
  view: GPUTextureView;
}

export interface BindGroupState {
  pipeline: GPURenderPipeline | null;
  cellsBuffer: GPUBuffer | null;
  uniformBuffer: GPUBuffer | null;
  rowFlagsBuffer: GPUBuffer | null;
  channelsBuffer: GPUBuffer | null;
  textureResources: BindGroupTextureResources | null;
  instrumentPaletteTexture: GPUTexture | null;
  audioReactiveUniformBuffer: GPUBuffer | null;
  layoutType: LayoutType;
}

export function createMainBindGroupLayout(
  device: GPUDevice,
  shaderFile: string,
  layoutType: LayoutType,
): GPUBindGroupLayout {
  if (layoutType === 'texture') {
    return device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      ],
    });
  }
  if (layoutType === 'extended') {
    const extendedEntries: GPUBindGroupLayoutEntry[] = [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
    ];
    if (usesOscilloscope(shaderFile)) {
      extendedEntries.push({ binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } });
    }
    if (usesInstrumentPalette(shaderFile)) {
      extendedEntries.push({ binding: 7, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } });
    }
    if (usesAudioReactive(shaderFile)) {
      extendedEntries.push({ binding: 8, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } });
    }
    return device.createBindGroupLayout({ entries: extendedEntries });
  }
  return device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
    ],
  });
}

export function refreshMainBindGroup(
  device: GPUDevice,
  pool: GpuResourcePool,
  state: BindGroupState,
  shaderFile: string,
  oscTexture: GPUTexture | null | undefined,
): GPUBindGroup | null {
  if (!state.pipeline || !state.cellsBuffer || !state.uniformBuffer) return null;
  if (!pool.isAlive(state.cellsBuffer) || !pool.isAlive(state.uniformBuffer)) return null;

  const layout = state.pipeline.getBindGroupLayout(0);
  const entries: GPUBindGroupEntry[] = [
    { binding: 0, resource: { buffer: state.cellsBuffer, size: state.cellsBuffer.size } },
    { binding: 1, resource: { buffer: state.uniformBuffer } },
  ];

  if (state.layoutType === 'extended') {
    if (!state.rowFlagsBuffer || !state.channelsBuffer || !state.textureResources) {
      return null;
    }
    entries.push(
      { binding: 2, resource: { buffer: state.rowFlagsBuffer } },
      { binding: 3, resource: { buffer: state.channelsBuffer } },
      { binding: 4, resource: state.textureResources.sampler },
      { binding: 5, resource: state.textureResources.view },
    );
    if (usesOscilloscope(shaderFile)) {
      if (!oscTexture || !pool.isAlive(oscTexture)) return null;
      entries.push({ binding: 6, resource: oscTexture.createView() });
    }
    if (usesInstrumentPalette(shaderFile)) {
      if (!state.instrumentPaletteTexture) return null;
      entries.push({ binding: 7, resource: state.instrumentPaletteTexture.createView() });
    }
    if (usesAudioReactive(shaderFile) && state.audioReactiveUniformBuffer) {
      entries.push({ binding: 8, resource: { buffer: state.audioReactiveUniformBuffer } });
    }
  } else if (state.layoutType === 'texture') {
    if (!state.textureResources) return null;
    entries.push(
      { binding: 2, resource: state.textureResources.sampler },
      { binding: 3, resource: state.textureResources.view },
    );
  }

  return device.createBindGroup({ layout, entries });
}
