import { beforeAll, describe, expect, it } from 'vitest';
import {
  BloomPostProcessor,
  BLOOM_SCENE_FORMAT,
  DEFAULT_LAYERS,
} from '../utils/bloomPostProcessor';
import {
  createFakeDevice,
  installGpuGlobals,
  type FakeBindGroup,
  type FakeBuffer,
  type RecordedOp,
} from './helpers/fakeGpuDevice';

const SHADERS = {
  shaderThreshold: '// threshold',
  shaderBlur: '// blur',
  shaderComposite: '// composite',
};

const CANVAS = { width: 800, height: 600 } as HTMLCanvasElement;

beforeAll(() => {
  installGpuGlobals();
});

async function setup(layered: boolean) {
  const fake = createFakeDevice();
  const bloom = new BloomPostProcessor(fake.device, CANVAS, fake.context, {
    ...SHADERS,
    ...(layered ? { layers: DEFAULT_LAYERS } : {}),
  });
  await bloom.init();
  const blurPipeline = fake.pipelines.find((p) => p.label === 'bloom_blur');
  expect(blurPipeline).toBeDefined();
  return { fake, bloom };
}

function renderOnce(fake: ReturnType<typeof createFakeDevice>, bloom: BloomPostProcessor): RecordedOp[] {
  const start = fake.ops.length;
  const encoder = fake.device.createCommandEncoder();
  bloom.render(encoder, (pass) => pass.draw(6));
  return fake.ops.slice(start);
}

/** Blur passes in recorded order: the uniform buffer bound at binding 2. */
function blurUniformBuffers(ops: RecordedOp[]): FakeBuffer[] {
  const out: FakeBuffer[] = [];
  let currentPipelineLabel: string | undefined;
  for (const op of ops) {
    if (op.op === 'setPipeline') {
      currentPipelineLabel = (op.pipeline as { label?: string }).label;
    } else if (op.op === 'setBindGroup' && currentPipelineLabel === 'bloom_blur') {
      const entry = (op.group as FakeBindGroup).entries.find((e) => e.binding === 2);
      out.push((entry!.resource as unknown as { buffer: FakeBuffer }).buffer);
    }
  }
  return out;
}

/** Last value written to `buffer` before `ops` (i.e. what the GPU reads at submit). */
function lastWrite(allOps: RecordedOp[], buffer: FakeBuffer): number[] | undefined {
  let data: number[] | undefined;
  for (const op of allOps) {
    if (op.op === 'writeBuffer' && op.buffer === buffer) data = op.data;
  }
  return data;
}

describe('BloomPostProcessor blur uniforms (#439 bug 1)', () => {
  it('legacy: H and V blur passes bind different buffers with (1,0) and (0,1)', async () => {
    const { fake, bloom } = await setup(false);
    const frame = renderOnce(fake, bloom);

    expect(frame.some((op) => op.op === 'writeBuffer')).toBe(false);

    const buffers = blurUniformBuffers(frame);
    expect(buffers).toHaveLength(2);
    const [h, v] = buffers as [FakeBuffer, FakeBuffer];
    expect(h).not.toBe(v);
    expect(lastWrite(fake.ops, h)).toEqual([1, 0, 400, 300]);
    expect(lastWrite(fake.ops, v)).toEqual([0, 1, 400, 300]);
  });

  it('layered: every layer has its own H and V buffer with that layer\'s radius', async () => {
    const { fake, bloom } = await setup(true);
    const frame = renderOnce(fake, bloom);

    expect(frame.some((op) => op.op === 'writeBuffer')).toBe(false);

    const buffers = blurUniformBuffers(frame);
    expect(buffers).toHaveLength(DEFAULT_LAYERS.length * 2);
    expect(new Set(buffers).size).toBe(buffers.length);

    DEFAULT_LAYERS.forEach((layer, i) => {
      const h = buffers[i * 2]!;
      const v = buffers[i * 2 + 1]!;
      const r = Math.fround(layer.blurRadius);
      expect(lastWrite(fake.ops, h)).toEqual([r, 0, 400, 300]);
      expect(lastWrite(fake.ops, v)).toEqual([0, r, 400, 300]);
    });
  });

  it('resize rewrites the blur resolution, and is a no-op at the same size', async () => {
    const { fake, bloom } = await setup(true);
    const before = fake.ops.length;
    bloom.resize(800, 600);
    expect(fake.ops.length).toBe(before);

    bloom.resize(1000, 500);
    const buffers = blurUniformBuffers(renderOnce(fake, bloom));
    const r = Math.fround(DEFAULT_LAYERS[0]!.blurRadius);
    expect(lastWrite(fake.ops, buffers[0]!)).toEqual([r, 0, 500, 250]);
    expect(lastWrite(fake.ops, buffers[1]!)).toEqual([0, r, 500, 250]);
  });

  it('renders the scene into an rgba16float texture', async () => {
    const { fake, bloom } = await setup(false);
    const frame = renderOnce(fake, bloom);
    const scenePass = frame.find((op) => op.op === 'beginRenderPass');
    expect(scenePass && scenePass.op === 'beginRenderPass' && scenePass.target?.format).toBe(BLOOM_SCENE_FORMAT);
    expect(bloom.sceneFormat).toBe('rgba16float');
  });

  it('builds every bloom pipeline asynchronously', async () => {
    const { fake } = await setup(true);
    expect(fake.syncPipelineCalls).toEqual([]);
    expect(fake.pipelines.map((p) => p.label).sort()).toEqual(['bloom_blur', 'bloom_composite', 'bloom_threshold']);
  });
});

describe('BloomPostProcessor per-frame allocation (#439)', () => {
  it.each([false, true])('render()/updateCRT() allocate no Float32Array after warm-up (layered=%s)', async (layered) => {
    const { fake, bloom } = await setup(layered);
    renderOnce(fake, bloom);
    bloom.updateCRT(0);

    const RealFloat32Array = globalThis.Float32Array;
    let constructed = 0;
    globalThis.Float32Array = new Proxy(RealFloat32Array, {
      construct(target, args, newTarget) {
        constructed += 1;
        return Reflect.construct(target, args, newTarget);
      },
    });
    try {
      for (let frame = 0; frame < 30; frame++) {
        bloom.updateCRT(frame % 2);
        renderOnce(fake, bloom);
      }
      bloom.setDebugLayer(1);
      bloom.updateUniforms(1.1, 0.7, 0.2, 1.0);
    } finally {
      globalThis.Float32Array = RealFloat32Array;
    }
    expect(constructed).toBe(0);
  });

  it('updateCRT skips the upload when the value is unchanged', async () => {
    const { fake, bloom } = await setup(false);
    bloom.updateCRT(1);
    const before = fake.ops.length;
    bloom.updateCRT(1);
    expect(fake.ops.length).toBe(before);
  });
});
