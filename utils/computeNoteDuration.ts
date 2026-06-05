// DURA-001 GPU compute pipeline for note-duration calculation.
// Replaces the CPU O(rows×channels) scan with a WebGPU compute pass.

import type { PatternMatrix } from '../types';
import { withBase } from '../src/lib/paths';

const MAX_SHADER_ROWS = 1024; // Must match MAX_ROWS in compute_note_duration.wgsl

export interface NoteDurationComputeState {
  pipeline: GPUComputePipeline;
  bindGroupLayout: GPUBindGroupLayout;
  paramsBuffer: GPUBuffer;
}

let cachedState: NoteDurationComputeState | null = null;
let cachedDevice: GPUDevice | null = null;

/**
 * Fetch and compile the compute shader. Safe to call multiple times —
 * result is cached per device.
 */
export async function initNoteDurationCompute(device: GPUDevice): Promise<NoteDurationComputeState> {
  if (cachedState && cachedDevice === device) {
    return cachedState;
  }

  const shaderUrl = withBase('shaders/compute_note_duration.wgsl');
  const shaderResponse = await fetch(shaderUrl);
  if (!shaderResponse.ok) {
    throw new Error(`Could not load shader at ${shaderUrl} (${shaderResponse.status})`);
  }
  const shaderCode = await shaderResponse.text();

  const module = device.createShaderModule({ code: shaderCode });
  if ('getCompilationInfo' in module) {
    module.getCompilationInfo().catch(() => {});
  }

  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ],
  });

  const pipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    compute: { module, entryPoint: 'main' },
  });

  const paramsBuffer = device.createBuffer({
    size: 16, // 3 × u32 padded to 16 bytes
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  cachedDevice = device;
  cachedState = { pipeline, bindGroupLayout, paramsBuffer };
  return cachedState;
}

/**
 * Returns true if the compute path can be used for this pattern.
 */
export function canUseComputePath(matrix: PatternMatrix | null): boolean {
  if (!matrix) return false;
  const numRows = matrix.numRows;
  return numRows > 0 && numRows <= MAX_SHADER_ROWS;
}

/**
 * Run the compute pass that transforms raw-packed cells into high-precision
 * duration-augmented cells.  The returned buffer is ready to bind as the
 * render shader's cells buffer.
 *
 * @param device        WebGPU device
 * @param state         Cached compute pipeline state
 * @param inputBuffer   Raw-packed cell buffer (STORAGE | COPY_DST)
 * @param numRows       Pattern row count
 * @param numChannels   Total channels including padding
 * @param padTopChannel Whether column 0 is padding
 * @returns             New GPU buffer containing high-precision packed data
 */
export function runNoteDurationCompute(
  device: GPUDevice,
  state: NoteDurationComputeState,
  inputBuffer: GPUBuffer,
  numRows: number,
  numChannels: number,
  padTopChannel: boolean
): GPUBuffer {
  const totalCells = numRows * numChannels;
  const outputByteLength = Math.max(16, totalCells * 2 * 4);

  // Create output buffer (zero-initialized so padding columns stay zero)
  const outputBuffer = device.createBuffer({
    size: outputByteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });

  // Update uniform params
  const params = new Uint32Array([numRows, numChannels, padTopChannel ? 1 : 0, 0]);
  device.queue.writeBuffer(state.paramsBuffer, 0, params.buffer, params.byteOffset, params.byteLength);

  const bindGroup = device.createBindGroup({
    layout: state.bindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: inputBuffer } },
      { binding: 1, resource: { buffer: outputBuffer } },
      { binding: 2, resource: { buffer: state.paramsBuffer } },
    ],
  });

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(state.pipeline);
  pass.setBindGroup(0, bindGroup);

  const rawChannels = padTopChannel ? numChannels - 1 : numChannels;
  pass.dispatchWorkgroups(Math.max(1, rawChannels), 1, 1);
  pass.end();
  device.queue.submit([encoder.finish()]);

  return outputBuffer;
}

/**
 * Read back a GPU buffer into a Uint32Array for parity checking.
 * Returns null if readback fails.
 */
export async function readbackBuffer(
  device: GPUDevice,
  sourceBuffer: GPUBuffer,
  byteLength: number
): Promise<Uint32Array | null> {
  try {
    const staging = device.createBuffer({
      size: byteLength,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(sourceBuffer, 0, staging, 0, byteLength);
    device.queue.submit([encoder.finish()]);

    await staging.mapAsync(GPUMapMode.READ);
    const mapped = new Uint32Array(staging.getMappedRange().slice(0));
    staging.unmap();
    staging.destroy();
    return mapped;
  } catch (e) {
    console.error('[DURA-PARITY] Readback failed:', e);
    return null;
  }
}
