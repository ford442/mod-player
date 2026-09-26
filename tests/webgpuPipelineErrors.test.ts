import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createFakeDevice, installGpuGlobals } from './helpers/fakeGpuDevice';

const BROKEN_WGSL = 'fn fs( -> { this is not wgsl';

// Module-scope GPU*Usage constants in the renderer's imports need these before import.
vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.GPUBufferUsage ??= { COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64, STORAGE: 128, MAP_READ: 1, QUERY_RESOLVE: 512 };
  g.GPUTextureUsage ??= { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 };
  g.GPUShaderStage ??= { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
});

vi.mock('../src/renderers/webgpu/shaderSource', () => ({
  fetchShaderSource: vi.fn(async (name: string) => (name.startsWith('pattern') ? BROKEN_WGSL : '// bezel')),
}));

import { WebGPURenderer, DEVICE_STABLE_RESET_MS } from '../src/renderers/webgpu/WebGPURenderer';
import { GpuResourcePool } from '../utils/gpuResourcePool';
import {
  appendGpuError,
  attachUncapturedErrorHandler,
  createCheckedShaderModule,
  GPU_ERROR_PREFIX,
  MAX_GPU_ERRORS,
} from '../utils/gpuShaderCompile';
import type { WebGPURenderParams } from '../src/renderers/params';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

beforeAll(() => {
  installGpuGlobals();
});

function brokenDevice() {
  return createFakeDevice({
    compileErrors: (code) => (code === BROKEN_WGSL ? [{ lineNum: 1, linePos: 7, message: "expected ')'" }] : []),
  });
}

/** A renderer that is already drawing `patternv0.21.wgsl` with a live pipeline. */
function rendererWithLiveShader(device: GPUDevice) {
  const renderer = new WebGPURenderer({});
  const internals = renderer as unknown as Record<string, unknown>;
  const livePipeline = { label: 'previous pipeline' };
  const liveBindGroup = { label: 'previous bind group' };
  internals.device = device;
  internals.pool = new GpuResourcePool(device);
  internals.pipeline = livePipeline;
  internals.bindGroup = liveBindGroup;
  internals.shaderFile = 'patternv0.21.wgsl';
  return { renderer, internals, livePipeline, liveBindGroup };
}

describe('shader compile errors (#449 bug 3)', () => {
  it('createCheckedShaderModule rejects with a readable label:line:col message', async () => {
    const { device } = brokenDevice();
    await expect(createCheckedShaderModule(device, BROKEN_WGSL, 'broken.wgsl'))
      .rejects.toThrow("broken.wgsl: 1:7 expected ')'");
  });

  it('a broken pattern shader rejects initShader and keeps the previous pipeline', async () => {
    const { device } = brokenDevice();
    const { renderer, internals, livePipeline, liveBindGroup } = rendererWithLiveShader(device);

    await expect(
      renderer.initShader('patternv0.50.wgsl', {} as WebGPURenderParams, () => false),
    ).rejects.toThrow(/patternv0\.50\.wgsl: 1:7 expected '\)'/);

    expect(internals.pipeline).toBe(livePipeline);
    expect(internals.bindGroup).toBe(liveBindGroup);
    expect(renderer.activeShaderFile).toBe('patternv0.21.wgsl');
  });

  it('a pipeline validation failure (async rejection) also keeps the previous pipeline', async () => {
    const fake = createFakeDevice();
    (fake.device as unknown as Record<string, unknown>).createRenderPipelineAsync = async () => {
      throw new Error('entry point "fs" not found');
    };
    const { renderer, internals, livePipeline } = rendererWithLiveShader(fake.device);

    await expect(
      renderer.initShader('patternv0.50.wgsl', {} as WebGPURenderParams, () => false),
    ).rejects.toThrow(/patternv0\.50\.wgsl: pipeline creation failed — entry point "fs" not found/);
    expect(internals.pipeline).toBe(livePipeline);
    expect(fake.syncPipelineCalls).toEqual([]);
  });
});

describe('uncapturederror routing (#449 bug 3)', () => {
  it('formats uncaptured GPU errors for DebugInfo.errors', () => {
    const listeners: Array<(e: Event) => void> = [];
    const device = {
      addEventListener: (_type: string, fn: (e: Event) => void) => listeners.push(fn),
      removeEventListener: () => {},
    } as unknown as GPUDevice;
    const messages: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    attachUncapturedErrorHandler(device, (m) => messages.push(m));
    class GPUValidationError { constructor(readonly message: string) {} }
    listeners[0]!({ error: new GPUValidationError('Invalid BindGroup') } as unknown as Event);
    spy.mockRestore();
    expect(messages).toEqual([`${GPU_ERROR_PREFIX}: GPUValidationError: Invalid BindGroup`]);
  });

  it('appendGpuError dedupes and caps GPU errors without touching others', () => {
    let errors = ['DEVICE-INIT: x'];
    for (let i = 0; i < 10; i++) errors = appendGpuError(errors, `${GPU_ERROR_PREFIX}: e${i}`);
    errors = appendGpuError(errors, `${GPU_ERROR_PREFIX}: e9`);
    expect(errors[0]).toBe('DEVICE-INIT: x');
    expect(errors.filter((e) => e.startsWith(GPU_ERROR_PREFIX))).toHaveLength(MAX_GPU_ERRORS);
    expect(errors.at(-1)).toBe(`${GPU_ERROR_PREFIX}: e9`);
  });
});

describe('device-lost recovery budget (#449 bug 4)', () => {
  function rendererForFrame() {
    const fake = createFakeDevice();
    const renderer = new WebGPURenderer({});
    const internals = renderer as unknown as Record<string, unknown>;
    internals.device = fake.device;
    internals.pool = new GpuResourcePool(fake.device);
    internals.context = fake.context;
    internals.recoveryAttempts = 2;
    const canvas = { width: 10, height: 10 } as HTMLCanvasElement;
    return { renderer, internals, canvas };
  }

  it('is not refilled by frames right after a re-init', () => {
    const { renderer, internals, canvas } = rendererForFrame();
    internals.deviceStableSince = performance.now() - 1000;
    renderer.renderFrame(canvas, {} as WebGPURenderParams);
    expect(internals.recoveryAttempts).toBe(2);
  });

  it('is refilled only after DEVICE_STABLE_RESET_MS of rendering', () => {
    const { renderer, internals, canvas } = rendererForFrame();
    internals.deviceStableSince = performance.now() - DEVICE_STABLE_RESET_MS - 1;
    renderer.renderFrame(canvas, {} as WebGPURenderParams);
    expect(internals.recoveryAttempts).toBe(0);
  });

  it('initDevice no longer resets the counter itself', () => {
    const src = readFileSync(join(ROOT, 'src/renderers/webgpu/WebGPURenderer.ts'), 'utf8');
    const initDevice = src.slice(src.indexOf('async initDevice('), src.indexOf('private disposeAnalysis('));
    expect(initDevice).not.toMatch(/this\.recoveryAttempts\s*=\s*0/);
  });
});

describe('no synchronous pipeline creation (#449 acceptance)', () => {
  const SYNC_CALL = /\.create(?:Render|Compute)Pipeline\s*\(/;
  const files = [
    ...readdirSync(join(ROOT, 'src/renderers/webgpu'))
      .filter((f) => f.endsWith('.ts'))
      .map((f) => `src/renderers/webgpu/${f}`),
    'utils/bloomPostProcessor.ts',
    'utils/computeNoteDuration.ts',
  ];

  it.each(files)('%s uses createRenderPipelineAsync / createComputePipelineAsync only', (file) => {
    const src = readFileSync(join(ROOT, file), 'utf8');
    expect(src).not.toMatch(SYNC_CALL);
  });
});
