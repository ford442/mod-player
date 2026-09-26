/**
 * Minimal recording fake of the WebGPU API surface used by the bloom
 * post-processor and the renderer's pipeline builder. Records writeBuffer
 * calls and render-pass commands in submission order.
 */

/** Captured at load so allocation spies on globalThis.Float32Array don't count the fake's own bookkeeping. */
const RealFloat32Array = Float32Array;

export function installGpuGlobals(): void {
  const g = globalThis as Record<string, unknown>;
  g.GPUBufferUsage ??= {
    MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16,
    VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512,
  };
  g.GPUTextureUsage ??= {
    COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16,
  };
  g.GPUShaderStage ??= { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
}

export interface FakeBuffer { kind: 'buffer'; id: number; size: number; destroyed: boolean; destroy(): void }
export interface FakeTexture {
  kind: 'texture'; id: number; width: number; height: number; format: string;
  destroyed: boolean; destroy(): void; createView(): { kind: 'view'; texture: FakeTexture };
}
export interface FakeBindGroup { kind: 'bindGroup'; id: number; entries: GPUBindGroupEntry[] }

export type RecordedOp =
  | { op: 'writeBuffer'; buffer: FakeBuffer; data: number[] }
  | { op: 'beginRenderPass'; target: FakeTexture | null }
  | { op: 'setPipeline'; pipeline: unknown }
  | { op: 'setBindGroup'; group: FakeBindGroup }
  | { op: 'draw' }
  | { op: 'end' };

export interface FakeDeviceOptions {
  /** Return WGSL compile errors for a module; empty = compiles. */
  compileErrors?: (code: string, label: string | undefined) => Array<{ lineNum: number; linePos: number; message: string }>;
}

export function createFakeDevice(options: FakeDeviceOptions = {}) {
  let nextId = 1;
  const ops: RecordedOp[] = [];
  const pipelines: Array<{ label?: string; descriptor: GPURenderPipelineDescriptor }> = [];
  const syncPipelineCalls: string[] = [];

  const makeTexture = (desc: GPUTextureDescriptor): FakeTexture => {
    const size = desc.size as { width: number; height?: number } | number[];
    const width = Array.isArray(size) ? size[0]! : size.width;
    const height = Array.isArray(size) ? (size[1] ?? 1) : (size.height ?? 1);
    const tex: FakeTexture = {
      kind: 'texture', id: nextId++, width, height, format: desc.format, destroyed: false,
      destroy() { tex.destroyed = true; },
      createView() { return { kind: 'view', texture: tex }; },
    };
    return tex;
  };

  const makePipeline = (descriptor: GPURenderPipelineDescriptor | GPUComputePipelineDescriptor) => {
    const pipeline = {
      kind: 'pipeline', id: nextId++, label: descriptor.label, descriptor,
      getBindGroupLayout: (index: number) => ({ kind: 'layout', pipeline: nextId, index }),
    };
    return pipeline;
  };

  const passEncoder = {
    setPipeline: (pipeline: unknown) => ops.push({ op: 'setPipeline', pipeline }),
    setBindGroup: (_i: number, group: FakeBindGroup) => ops.push({ op: 'setBindGroup', group }),
    draw: () => ops.push({ op: 'draw' }),
    end: () => ops.push({ op: 'end' }),
  };

  const device = {
    queue: {
      writeBuffer: (buffer: FakeBuffer, _offset: number, data: ArrayBufferView | ArrayBuffer) => {
        const view = data instanceof ArrayBuffer ? new RealFloat32Array(data) : new RealFloat32Array(
          (data as ArrayBufferView).buffer, (data as ArrayBufferView).byteOffset, (data as ArrayBufferView).byteLength / 4,
        );
        ops.push({ op: 'writeBuffer', buffer, data: Array.from(view) });
      },
      writeTexture: () => {},
      submit: () => {},
    },
    createBuffer: (desc: GPUBufferDescriptor): FakeBuffer => {
      const buf: FakeBuffer = { kind: 'buffer', id: nextId++, size: desc.size, destroyed: false, destroy() { buf.destroyed = true; } };
      return buf;
    },
    createTexture: makeTexture,
    createSampler: () => ({ kind: 'sampler', id: nextId++ }),
    createBindGroup: (desc: GPUBindGroupDescriptor): FakeBindGroup => ({
      kind: 'bindGroup', id: nextId++, entries: Array.from(desc.entries),
    }),
    createBindGroupLayout: () => ({ kind: 'layout', id: nextId++ }),
    createPipelineLayout: () => ({ kind: 'pipelineLayout', id: nextId++ }),
    createShaderModule: (desc: GPUShaderModuleDescriptor) => {
      const errors = options.compileErrors?.(desc.code, desc.label) ?? [];
      return {
        kind: 'module', id: nextId++, label: desc.label,
        getCompilationInfo: async () => ({
          messages: errors.map((e) => ({ ...e, type: 'error' as const })),
        }),
      };
    },
    createRenderPipeline: (desc: GPURenderPipelineDescriptor) => {
      syncPipelineCalls.push(String(desc.label));
      return makePipeline(desc);
    },
    createRenderPipelineAsync: async (desc: GPURenderPipelineDescriptor) => {
      pipelines.push({ ...(desc.label ? { label: desc.label } : {}), descriptor: desc });
      return makePipeline(desc);
    },
    createComputePipelineAsync: async (desc: GPUComputePipelineDescriptor) => makePipeline(desc),
    createCommandEncoder: () => ({
      beginRenderPass: (desc: GPURenderPassDescriptor) => {
        const attachment = Array.from(desc.colorAttachments)[0];
        const view = attachment?.view as unknown as { texture?: FakeTexture } | undefined;
        ops.push({ op: 'beginRenderPass', target: view?.texture ?? null });
        return passEncoder;
      },
      finish: () => ({}),
    }),
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  const swapchain = makeTexture({ size: { width: 1, height: 1 }, format: 'bgra8unorm', usage: 0 });
  const context = { getCurrentTexture: () => swapchain };

  return {
    device: device as unknown as GPUDevice,
    context: context as unknown as GPUCanvasContext,
    swapchain,
    ops,
    pipelines,
    syncPipelineCalls,
  };
}
