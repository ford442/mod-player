/**
 * #492 — the WebGPU canvas is configured once per device and once per output
 * format change, never on resize, frame, bloom toggle or same-format shader
 * switch. Drives the real WebGPURenderer (+ frameDraw) against a recording
 * fake device whose GPUCanvasContext counts configure() calls.
 */
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDevice, installGpuGlobals } from './helpers/fakeGpuDevice';

// Module-scope GPU*Usage constants in the renderer's imports need these before import.
vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.GPUBufferUsage ??= { COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64, STORAGE: 128, MAP_READ: 1, QUERY_RESOLVE: 512 };
  g.GPUTextureUsage ??= { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 };
  g.GPUShaderStage ??= { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
});

const env = vi.hoisted(() => ({
  devices: [] as Array<ReturnType<typeof import('./helpers/fakeGpuDevice').createFakeDevice>>,
  toneMappingSupported: true,
}));

vi.mock('../src/renderers/webgpu/shaderSource', () => ({
  fetchShaderSource: vi.fn(async () => '// wgsl'),
}));

vi.mock('../src/renderers/webgpu/textures', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/renderers/webgpu/textures')>()),
  loadBezelTexture: vi.fn(async () => ({ sampler: { kind: 'sampler' }, view: { kind: 'view' } })),
  ensureButtonTexture: vi.fn(async () => ({ sampler: { kind: 'sampler' }, view: { kind: 'view' } })),
}));

vi.mock('../utils/webgpuDevice', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/webgpuDevice')>();
  return {
    ...actual,
    requestWebGPUDevice: vi.fn(async () => {
      const fake = env.devices.at(-1)!;
      return {
        adapter: {} as GPUAdapter,
        device: fake.device,
        featureLevel: 'core',
        enabledFeatures: [],
        appliedLimits: {},
        preferredCanvasFormat: 'bgra8unorm',
      };
    }),
    probeWebGPUCanvasPresentation: vi.fn(async () => ({
      presents: true,
      extendedToneMapping: env.toneMappingSupported,
    })),
  };
});

import { WebGPURenderer } from '../src/renderers/webgpu/WebGPURenderer';
import { resolveCanvasBufferSize } from '../src/renderers/hooks/resolvePatternCanvasMetrics';
import { HIGH_DYNAMIC_RANGE_QUERY, type CanvasOutput } from '../utils/webgpuDevice';
import type { BloomPostProcessor } from '../utils/bloomPostProcessor';
import type { WebGPURenderParams } from '../src/renderers/params';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** A controllable `(dynamic-range: high)` media query. */
function installDisplay(hdr: boolean) {
  const listeners = new Set<(e: { matches: boolean }) => void>();
  const query = {
    matches: hdr,
    media: HIGH_DYNAMIC_RANGE_QUERY,
    addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: (e: { matches: boolean }) => void) => listeners.delete(fn),
  };
  const win = window as unknown as Record<string, unknown>;
  win.matchMedia = (q: string) => {
    expect(q).toBe(HIGH_DYNAMIC_RANGE_QUERY);
    return query;
  };
  return {
    setHdr(next: boolean) {
      query.matches = next;
      for (const fn of [...listeners]) fn({ matches: next });
    },
    get listenerCount() { return listeners.size; },
  };
}

function params(): WebGPURenderParams {
  return {
    matrix: null, channels: [], padTopChannel: true, isPlaying: true, bpm: 125, timeSec: 1,
    tickOffset: 0, beatPhase: 0, grooveAmount: 0, kickTrigger: 0, activeChannels: [],
    isModuleLoaded: true, bloomIntensity: 1, bloomThreshold: 0.8, dimFactor: 1, volume: 0.5,
    pan: 0, isLooping: false, invertChannels: false, clickedButton: 0, cellWidth: 120,
    cellHeight: 24, playheadRow: 3, localTime: 0, isHorizontal: false, externalVideoSource: null,
    canvasMetrics: { width: 1024, height: 1024 }, stepsLength: 32, reactiveMode: false,
  } as unknown as WebGPURenderParams;
}

/** Bloom stand-in: records render/resize, composite built for `outputFormat`. */
function stubBloom(outputFormat: GPUTextureFormat) {
  return {
    isReady: true,
    outputFormat,
    render: vi.fn(),
    resize: vi.fn(),
    updateCRT: vi.fn(),
  };
}

function newDevice() {
  const fake = createFakeDevice();
  env.devices.push(fake);
  return fake;
}

/** The pipelines a shader init built, as [label, colour-target format]. */
function pipelineTargets(fake: ReturnType<typeof createFakeDevice>, from = 0) {
  return fake.pipelines.slice(from).map((p) => [
    p.label ?? '',
    Array.from(p.descriptor.fragment?.targets ?? [])[0]?.format,
  ]);
}

describe('canvas configure() — once per device / format (#492)', () => {
  const canvas = { width: 1024, height: 1024, getContext: () => env.devices.at(-1)!.context } as unknown as HTMLCanvasElement;
  const bloomRef = { current: null as BloomPostProcessor | null };
  let outputs: CanvasOutput[];
  let stale: number;
  let epochBumps: number;

  function makeRenderer() {
    return new WebGPURenderer({ bloomProcessorRef: bloomRef }, {
      onCanvasOutput: (o) => outputs.push(o),
      onCanvasOutputStale: () => { stale += 1; },
      onDeviceEpochBump: () => { epochBumps += 1; },
    });
  }

  async function initDevice(renderer: WebGPURenderer, shaderFile: string, liteMode = false) {
    await renderer.initDevice(canvas, null, () => {}, {
      liteMode, isCancelled: () => false, deviceEpoch: 0, shaderFile,
    });
  }

  /** Resize the way usePatternCanvasMetrics does, then draw a frame. */
  function resizeAndDraw(renderer: WebGPURenderer, box: Parameters<typeof resolveCanvasBufferSize>[0]['box'], dpr: number) {
    const size = resolveCanvasBufferSize({ box, aspect: 1, devicePixelRatio: dpr, liteMode: false })!;
    (canvas as { width: number }).width = size.width;
    (canvas as { height: number }).height = size.height;
    renderer.renderFrame(canvas, params());
    return size;
  }

  beforeEach(() => {
    installGpuGlobals();
    // GpuResourcePool tells buffers from textures with `instanceof GPUBuffer`.
    vi.stubGlobal('GPUBuffer', { [Symbol.hasInstance]: (v: unknown) => (v as { kind?: string } | null)?.kind === 'buffer' });
    env.devices.length = 0;
    env.toneMappingSupported = true;
    outputs = [];
    stale = 0;
    epochBumps = 0;
    bloomRef.current = null;
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, text: async () => '' })));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete (window as unknown as Record<string, unknown>).matchMedia;
  });

  it('init → resizes (incl. DPR changes) → frames → bloom toggle → same-format shader switch: one configure', async () => {
    installDisplay(false);
    const fake = newDevice();
    const renderer = makeRenderer();

    await initDevice(renderer, 'patternv0.50.wgsl');
    expect(fake.configureCalls).toHaveLength(1);
    expect(fake.configureCalls[0]).toMatchObject({ format: 'bgra8unorm', alphaMode: 'premultiplied' });
    expect(fake.configureCalls[0]).not.toHaveProperty('toneMapping');

    await renderer.initShader('patternv0.50.wgsl', params(), () => false);
    expect(renderer.isShaderReady()).toBe(true);
    for (let i = 0; i < 5; i++) renderer.renderFrame(canvas, params());

    // Container resizes, a DPR change (1 → 1.5 → 2 → 3), and a huge panel clamped.
    const sizes = [
      resizeAndDraw(renderer, { cssWidth: 800, cssHeight: 600 }, 1),
      resizeAndDraw(renderer, { cssWidth: 800, cssHeight: 600, deviceWidth: 1200, deviceHeight: 900 }, 1.5),
      resizeAndDraw(renderer, { cssWidth: 1000, cssHeight: 700, deviceWidth: 2000, deviceHeight: 1400 }, 2),
      resizeAndDraw(renderer, { cssWidth: 1000, cssHeight: 700 }, 3),
      resizeAndDraw(renderer, { cssWidth: 3840, cssHeight: 2160, deviceWidth: 7680, deviceHeight: 4320 }, 2),
    ];
    expect(sizes.map((s) => s.width)).toEqual([600, 900, 1400, 2100, 2880]);

    // Bloom on (built for the configured format) → resized with the canvas, used.
    const bloom = stubBloom('bgra8unorm');
    bloomRef.current = bloom as unknown as BloomPostProcessor;
    resizeAndDraw(renderer, { cssWidth: 640, cssHeight: 640, deviceWidth: 1280, deviceHeight: 1280 }, 2);
    renderer.renderFrame(canvas, params());
    expect(bloom.resize).toHaveBeenLastCalledWith(1280, 1280);
    expect(bloom.render).toHaveBeenCalled();
    // Bloom off again.
    bloomRef.current = null;
    renderer.renderFrame(canvas, params());

    // Same-format shader switch (v0.50 → v0.51, both SDR here).
    const built = fake.pipelines.length;
    await renderer.initShader('patternv0.51.wgsl', params(), () => false);
    renderer.renderFrame(canvas, params());
    expect(pipelineTargets(fake, built)).toContainEqual(['patternv0.51.wgsl', 'bgra8unorm']);

    expect(fake.configureCalls).toHaveLength(1);
    expect(outputs).toEqual([{ format: 'bgra8unorm', hdr: false }]);
    expect(stale).toBe(0);
    expect(fake.syncPipelineCalls).toEqual([]);
  });

  it('an HDR display toggle on an hdrOutput shader is exactly one more configure (and one back)', async () => {
    const display = installDisplay(false);
    const fake = newDevice();
    const renderer = makeRenderer();

    await initDevice(renderer, 'patternv0.60.wgsl');
    await renderer.initShader('patternv0.60.wgsl', params(), () => false);
    resizeAndDraw(renderer, { cssWidth: 900, cssHeight: 900, deviceWidth: 1800, deviceHeight: 1800 }, 2);
    expect(fake.configureCalls).toHaveLength(1);
    expect(fake.configureCalls[0]?.format).toBe('bgra8unorm');

    // Window dragged onto an HDR monitor: the renderer asks for a rebuild…
    display.setHdr(true);
    expect(stale).toBe(1);
    expect(fake.configureCalls).toHaveLength(1);

    // …which (as useWebGPURender does) re-runs initShader for the same shader.
    const built = fake.pipelines.length;
    await renderer.initShader('patternv0.60.wgsl', params(), () => false);
    expect(fake.configureCalls).toHaveLength(2);
    expect(fake.configureCalls[1]).toMatchObject({
      format: 'rgba16float',
      colorSpace: 'srgb',
      toneMapping: { mode: 'extended' },
      alphaMode: 'premultiplied',
    });
    expect(outputs.at(-1)).toEqual({ format: 'rgba16float', hdr: true });
    // Canvas-format pipelines now target rgba16float, and the bloom-scene variant
    // is that same pipeline — no separate "(hdr)" compile.
    const targets = pipelineTargets(fake, built);
    expect(targets).toContainEqual(['patternv0.60.wgsl', 'rgba16float']);
    expect(targets).toContainEqual(['bezel_spectrum.wgsl', 'rgba16float']);
    expect(targets.some(([label]) => String(label).endsWith('(hdr)'))).toBe(false);

    // A bloom processor still built for the old format is skipped; the rebuilt one is used.
    const staleBloom = stubBloom('bgra8unorm');
    bloomRef.current = staleBloom as unknown as BloomPostProcessor;
    renderer.renderFrame(canvas, params());
    expect(staleBloom.render).not.toHaveBeenCalled();
    const hdrBloom = stubBloom('rgba16float');
    bloomRef.current = hdrBloom as unknown as BloomPostProcessor;
    resizeAndDraw(renderer, { cssWidth: 700, cssHeight: 700, deviceWidth: 1050, deviceHeight: 1050 }, 1.5);
    expect(hdrBloom.render).toHaveBeenCalled();

    // HDR → HDR shader switch: same format, no configure.
    await renderer.initShader('patternv0.61.wgsl', params(), () => false);
    renderer.renderFrame(canvas, params());
    expect(fake.configureCalls).toHaveLength(2);

    // Back onto the SDR monitor: one more configure, back to the 8-bit format.
    display.setHdr(false);
    expect(stale).toBe(2);
    await renderer.initShader('patternv0.61.wgsl', params(), () => false);
    expect(fake.configureCalls).toHaveLength(3);
    expect(fake.configureCalls[2]).toEqual(expect.objectContaining({ format: 'bgra8unorm' }));
    expect(fake.configureCalls[2]).not.toHaveProperty('toneMapping');
    expect(outputs).toEqual([
      { format: 'bgra8unorm', hdr: false },
      { format: 'rgba16float', hdr: true },
      { format: 'bgra8unorm', hdr: false },
    ]);
  });

  it('switching between an hdrOutput shader and a plain one on an HDR display is a format change', async () => {
    installDisplay(true);
    const fake = newDevice();
    const renderer = makeRenderer();

    // First configure already uses the HDR output: initDevice knows the shader.
    await initDevice(renderer, 'patternv0.58.wgsl');
    await renderer.initShader('patternv0.58.wgsl', params(), () => false);
    expect(fake.configureCalls.map((c) => c.format)).toEqual(['rgba16float']);

    await renderer.initShader('patternv0.50.wgsl', params(), () => false); // no hdrOutput
    await renderer.initShader('patternv0.51.wgsl', params(), () => false); // same SDR format
    expect(fake.configureCalls.map((c) => c.format)).toEqual(['rgba16float', 'bgra8unorm']);
  });

  it('never configures HDR without tone-mapping support, in lite mode, or for shaders that did not opt in', async () => {
    const display = installDisplay(true);

    env.toneMappingSupported = false;
    let fake = newDevice();
    let renderer = makeRenderer();
    await initDevice(renderer, 'patternv0.60.wgsl');
    await renderer.initShader('patternv0.60.wgsl', params(), () => false);
    expect(fake.configureCalls.map((c) => c.format)).toEqual(['bgra8unorm']);
    renderer.disposeDevice();

    env.toneMappingSupported = true;
    fake = newDevice();
    renderer = makeRenderer();
    await initDevice(renderer, 'patternv0.60.wgsl', true);
    await renderer.initShader('patternv0.60.wgsl', params(), () => false);
    expect(fake.configureCalls.map((c) => c.format)).toEqual(['bgra8unorm']);
    renderer.disposeDevice();

    fake = newDevice();
    renderer = makeRenderer();
    await initDevice(renderer, 'patternv0.50.wgsl');
    await renderer.initShader('patternv0.50.wgsl', params(), () => false);
    // A dynamic-range flip is irrelevant to a shader without hdrOutput.
    display.setHdr(false);
    display.setHdr(true);
    expect(stale).toBe(0);
    expect(fake.configureCalls.map((c) => c.format)).toEqual(['bgra8unorm']);
    renderer.disposeDevice();
    expect(display.listenerCount).toBe(0);
  });

  it('a replacement device after device loss is configured once', async () => {
    installDisplay(false);
    const first = newDevice();
    const renderer = makeRenderer();
    await initDevice(renderer, 'patternv0.50.wgsl');
    await renderer.initShader('patternv0.50.wgsl', params(), () => false);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    first.loseDevice('unknown');
    await vi.waitFor(() => expect(epochBumps).toBe(1));
    const second = newDevice();
    await initDevice(renderer, 'patternv0.50.wgsl');
    await renderer.initShader('patternv0.50.wgsl', params(), () => false);
    resizeAndDraw(renderer, { cssWidth: 500, cssHeight: 500, deviceWidth: 1000, deviceHeight: 1000 }, 2);

    expect(first.configureCalls).toHaveLength(1);
    expect(second.configureCalls).toHaveLength(1);
  });
});

describe('configure() call sites (#492)', () => {
  const SCAN = ['components', 'hooks', 'src', 'utils', 'app'];

  // lstat + skip symlinks: see the CodeQL symlink note in CLAUDE.md (pitfall 6).
  function* sources(dir: string): Generator<string> {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) yield* sources(full);
      else if (/\.(ts|tsx)$/.test(entry)) yield full;
    }
  }

  it('only WebGPURenderer.applyCanvasOutput (and the boot probe) configure a canvas — no resize/frame/bloom path', () => {
    const calls: string[] = [];
    for (const dir of SCAN) {
      for (const file of sources(join(ROOT, dir))) {
        const rel = relative(ROOT, file);
        const src = readFileSync(file, 'utf8');
        if (!src.includes('onfigure')) continue;
        src.split('\n').forEach((line, i) => {
          const code = line.replace(/\/\/.*$/, '');
          if (/configureCanvasContext\(|\.configure\(\s*config\b/.test(code) && !/export function configureCanvasContext/.test(code)) {
            calls.push(`${rel}:${i + 1}`);
          }
        });
      }
    }
    expect(calls.map((c) => c.replace(/:\d+$/, ''))).toEqual([
      'src/renderers/webgpu/WebGPURenderer.ts',
      'utils/webgpuDevice.ts', // probeWebGPUCanvasPresentation's 8×8 canvas
      'utils/webgpuDevice.ts', // configureCanvasContext's own context.configure(config)
    ]);
  }, 30_000);
});
