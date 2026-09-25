/**
 * WebGPURenderer spectrum-binding orchestration (issue #438, brief item 5).
 *
 * `bindGroup.ts` is covered elsewhere; this pins what the *renderer* does around
 * it: which buffer a `spectrumBuffer` shader reads (live ComputeAnalysis buffer
 * vs the zeroed placeholder), when both bind groups are rebuilt, and that
 * nothing happens for any other shader. The real-GPU counterpart proves the
 * resulting bind groups validate; this proves they are rebuilt at the right time.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WebGPURenderer } from '../src/renderers/webgpu/WebGPURenderer';
import { SPECTRUM_BACKGROUND_BINDING, SPECTRUM_PATTERN_BINDING } from '../src/renderers/webgpu/bindGroup';

// WebGPURenderer's import graph reads these at module load (matrixBuffers.ts), so they must
// exist before the imports above evaluate — hence vi.hoisted, not a plain stubGlobal.
vi.hoisted(() => {
  Object.assign(globalThis, {
    GPUShaderStage: { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 },
    GPUBufferUsage: { MAP_READ: 1, COPY_SRC: 4, COPY_DST: 8, UNIFORM: 0x40, STORAGE: 0x80 },
    GPUTextureUsage: { COPY_DST: 2, TEXTURE_BINDING: 4, RENDER_ATTACHMENT: 0x10 },
  });
});

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

type Buf = { tag: string };
const buf = (tag: string): GPUBuffer => ({ tag, size: 128 }) as unknown as GPUBuffer;
const tagOf = (entry: GPUBindGroupEntry | undefined): string | undefined =>
  (entry?.resource as { buffer?: Buf } | undefined)?.buffer?.tag;

interface Harness {
  renderer: WebGPURenderer;
  createBindGroup: ReturnType<typeof vi.fn<(descriptor: GPUBindGroupDescriptor) => GPUBindGroup>>;
  /** Buffers bound at `binding`, one per createBindGroup call, in order. */
  boundAt(binding: number): (string | undefined)[];
  sync(): void;
  setAnalysis(analysis: { spectrumBuffer: GPUBuffer | null } | null): void;
}

function makeHarness(shaderFile: string): Harness {
  const createBindGroup = vi.fn((_descriptor: GPUBindGroupDescriptor) => ({}) as GPUBindGroup);
  const device = { createBindGroup } as unknown as GPUDevice;
  const pool = { isAlive: () => true, isDisposed: false };
  const renderer = new WebGPURenderer({});

  const state = {
    device,
    pool,
    shaderFile,
    layoutType: 'extended',
    pipeline: { getBindGroupLayout: () => ({}) },
    cellsBuffer: buf('cells'),
    uniformBuffer: buf('uniforms'),
    rowFlagsBuffer: buf('rowFlags'),
    channelsBuffer: buf('channels'),
    textureResources: { sampler: {}, view: {} },
    instrumentPaletteTexture: { createView: () => ({}) },
    audioReactiveUniformBuffer: buf('audio'),
    bezelBindLayout: {},
    bezelUniformBuffer: buf('bezelUniform'),
    bezelTextureResources: { sampler: {}, view: {} },
    spectrumPlaceholder: buf('placeholder'),
    computeAnalysis: null as { spectrumBuffer: GPUBuffer | null } | null,
  };
  Object.assign(renderer, state);
  const priv = renderer as unknown as {
    refreshBindGroup(): unknown;
    refreshBezelBindGroup(): void;
    syncSpectrumBinding(): void;
  };

  return {
    renderer,
    createBindGroup,
    boundAt: (binding) =>
      createBindGroup.mock.calls.map(([d]) =>
        tagOf([...d.entries].find((e) => e.binding === binding)),
      ),
    sync: () => priv.syncSpectrumBinding(),
    setAnalysis: (analysis) => {
      (renderer as unknown as { computeAnalysis: unknown }).computeAnalysis = analysis;
    },
  };
}

/** What initShader leaves behind: both bind groups built over the placeholder. */
function initialBind(h: Harness) {
  const priv = h.renderer as unknown as { refreshBindGroup(): unknown; refreshBezelBindGroup(): void };
  priv.refreshBezelBindGroup();
  priv.refreshBindGroup();
  h.createBindGroup.mockClear();
}

describe('spectrum placeholder → live buffer orchestration', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness('patternv0.60.wgsl');
  });

  it('builds both bind groups over the zeroed placeholder when ComputeAnalysis has not resolved', () => {
    const priv = h.renderer as unknown as { refreshBindGroup(): unknown; refreshBezelBindGroup(): void };
    priv.refreshBezelBindGroup();
    priv.refreshBindGroup();

    expect(h.boundAt(SPECTRUM_BACKGROUND_BINDING)).toContain('placeholder');
    expect(h.boundAt(SPECTRUM_PATTERN_BINDING)).toContain('placeholder');
    // never a bind group with the spectrum entry missing
    for (const call of h.createBindGroup.mock.calls) {
      const bindings = [...call[0].entries].map((e) => e.binding);
      expect(bindings.some((b) => b === SPECTRUM_PATTERN_BINDING || b === SPECTRUM_BACKGROUND_BINDING)).toBe(true);
    }
  });

  it('does not rebuild anything while the placeholder is still the right buffer', () => {
    initialBind(h);
    h.sync();
    h.sync();
    expect(h.createBindGroup).not.toHaveBeenCalled();
  });

  it('rebuilds BOTH bind groups over the live buffer the moment ComputeAnalysis resolves', () => {
    initialBind(h);
    h.setAnalysis({ spectrumBuffer: buf('live') });
    h.sync();

    expect(h.createBindGroup).toHaveBeenCalledTimes(2);
    expect(h.boundAt(SPECTRUM_BACKGROUND_BINDING)).toEqual(['live', undefined]);
    expect(h.boundAt(SPECTRUM_PATTERN_BINDING)).toEqual([undefined, 'live']);
  });

  it('rebuilds once, not every frame', () => {
    initialBind(h);
    h.setAnalysis({ spectrumBuffer: buf('live') });
    h.sync();
    h.createBindGroup.mockClear();

    h.sync();
    h.sync();
    h.sync();
    expect(h.createBindGroup).not.toHaveBeenCalled();
  });

  it('falls back to the placeholder when the analysis goes away (never a destroyed buffer)', () => {
    initialBind(h);
    h.setAnalysis({ spectrumBuffer: buf('live') });
    h.sync();
    h.createBindGroup.mockClear();

    h.setAnalysis(null);
    h.sync();
    expect(h.boundAt(SPECTRUM_BACKGROUND_BINDING)).toContain('placeholder');
    expect(h.boundAt(SPECTRUM_PATTERN_BINDING)).toContain('placeholder');
  });

  it('treats a disposed-but-still-referenced analysis (spectrumBuffer === null) as absent', () => {
    initialBind(h);
    h.setAnalysis({ spectrumBuffer: buf('live') });
    h.sync();
    h.createBindGroup.mockClear();

    h.setAnalysis({ spectrumBuffer: null });
    h.sync();
    expect(h.boundAt(SPECTRUM_BACKGROUND_BINDING)).toContain('placeholder');
    expect(h.boundAt(SPECTRUM_PATTERN_BINDING)).toContain('placeholder');
  });

  it('does nothing before the pipeline exists (initShader still in flight)', () => {
    initialBind(h);
    (h.renderer as unknown as { pipeline: unknown }).pipeline = null;
    h.setAnalysis({ spectrumBuffer: buf('live') });
    h.sync();
    expect(h.createBindGroup).not.toHaveBeenCalled();
  });
});

describe('shaders without spectrumBuffer', () => {
  it.each(['patternv0.59.wgsl', 'patternv0.58.wgsl', 'patternv0.45.wgsl'])(
    '%s: sync never rebuilds or binds a spectrum buffer, even with a live analysis',
    (id) => {
      const h = makeHarness(id);
      initialBind(h);
      h.setAnalysis({ spectrumBuffer: buf('live') });
      h.sync();

      expect(h.createBindGroup).not.toHaveBeenCalled();
      // and a normal build carries no spectrum entry
      (h.renderer as unknown as { refreshBindGroup(): unknown }).refreshBindGroup();
      expect(h.boundAt(SPECTRUM_PATTERN_BINDING).every((t) => t === undefined)).toBe(true);
    },
  );
});

describe('renderFrame ordering', () => {
  it('syncs the spectrum binding before it snapshots bind groups into the frame state', () => {
    const src = readFileSync(join(ROOT, 'src/renderers/webgpu/WebGPURenderer.ts'), 'utf8');
    const body = src.slice(src.indexOf('renderFrame(canvas'));
    const sync = body.indexOf('this.syncSpectrumBinding()');
    const snapshot = body.indexOf('const frameState: FrameDrawState');
    expect(sync).toBeGreaterThan(-1);
    expect(snapshot).toBeGreaterThan(-1);
    expect(sync).toBeLessThan(snapshot);
  });

  it('creates the placeholder before any bind group is built in initShader', () => {
    const src = readFileSync(join(ROOT, 'src/renderers/webgpu/WebGPURenderer.ts'), 'utf8');
    const init = src.slice(src.indexOf('async initShader('));
    const placeholder = init.indexOf("label: 'spectrum-placeholder'");
    const firstBezelBind = init.indexOf('this.refreshBezelBindGroup()');
    const firstMainBind = init.indexOf('this.refreshBindGroup()');
    expect(placeholder).toBeGreaterThan(-1);
    expect(placeholder).toBeLessThan(firstBezelBind);
    expect(placeholder).toBeLessThan(firstMainBind);
  });
});
