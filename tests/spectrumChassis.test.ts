/**
 * v0.60 spectrum-chassis contract (issue #438).
 *
 * Vitest has no GPU, so this pins everything a mismatch would turn into a
 * silent runtime bug or a driver validation error:
 *  - the `spectrumBuffer` capability is declared consistently in the registry;
 *  - binding slots / bin counts / uniform slot 23 agree between WGSL and TS;
 *  - bind-group layout + entries appear for flagged shaders and for nothing else.
 * The real-GPU counterpart lives in the offscreen harness described in the PR.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import { SHADER_GROUPS } from '../appConfig';
import {
  SPECTRUM_BACKGROUND_BINDING,
  SPECTRUM_PATTERN_BINDING,
  createMainBindGroupLayout,
  refreshMainBindGroup,
  type BindGroupState,
} from '../src/renderers/webgpu/bindGroup';
import {
  SPECTRUM_BIN_COUNT,
  SPECTRUM_BUFFER_BYTES,
} from '../src/renderers/webgpu/computeAnalysis';
import { SHADER_REGISTRY } from '../utils/shaderRegistry';
import { usesGpuSpectrum, usesSpectrumBuffer } from '../utils/shaderVersion';
import type { GpuResourcePool } from '../utils/gpuResourcePool';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const shader = (rel: string) => readFileSync(join(ROOT, 'shaders', rel), 'utf8');
const publicShader = (rel: string) => readFileSync(join(ROOT, 'public/shaders', rel), 'utf8');

const SPECTRUM_SHADERS = Object.entries(SHADER_REGISTRY)
  .filter(([, meta]) => meta.spectrumBuffer)
  .map(([id]) => id);

/** Every picker entry, flattened (the groups are a mix of mutable and `as const` arrays). */
const pickerEntries = (): { id: string; label: string }[] =>
  Object.values(SHADER_GROUPS).flatMap((group) => [...group] as { id: string; label: string }[]);

// GPUShaderStage is a browser global.
vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 });

describe('spectrumBuffer registry invariants', () => {
  it('has at least the v0.60 shader', () => {
    expect(SPECTRUM_SHADERS).toContain('patternv0.60.wgsl');
  });

  it.each(SPECTRUM_SHADERS)('%s: extended layout + compute pass + own chassis', (id) => {
    const meta = SHADER_REGISTRY[id]!;
    // Bindings past 5 only exist in the extended layout.
    expect(meta.extendedLayout).toBe(true);
    // The compute pass is what fills the buffer — explicit, not just implied.
    expect(meta.usesGpuSpectrum).toBe(true);
    expect(usesGpuSpectrum(id)).toBe(true);
    expect(usesSpectrumBuffer(id)).toBe(true);
    // A chassis that reads the bins needs a background that declares them.
    expect(meta.background).not.toBe('bezel.wgsl');
    expect(meta.singlePassComposite).toBe(false);
  });

  it.each(SPECTRUM_SHADERS)('%s: is offered in the picker', (id) => {
    expect(pickerEntries().map((s) => s.id)).toContain(id);
  });

  it('labels v0.60 as the spectrum chassis', () => {
    const entry = pickerEntries().find((s) => s.id === 'patternv0.60.wgsl');
    expect(entry?.label).toBe('v0.60 (Spectrum Chassis)');
  });

  it('does not leak into any pre-existing shader', () => {
    const flagged = Object.entries(SHADER_REGISTRY)
      .filter(([, meta]) => meta.spectrumBuffer)
      .map(([id]) => id);
    for (const id of flagged) expect(id).toMatch(/^patternv0\.6\d\.wgsl$/);
    // Untouched neighbours keep their previous capability set.
    expect(usesSpectrumBuffer('patternv0.59.wgsl')).toBe(false);
    expect(usesSpectrumBuffer('patternv0.58.wgsl')).toBe(false);
    expect(usesGpuSpectrum('patternv0.58.wgsl')).toBe(true);
    expect(usesGpuSpectrum('patternv0.59.wgsl')).toBe(false);
  });

  it('treats an unregistered shader as not using the buffer', () => {
    expect(usesSpectrumBuffer('patternv9.99.wgsl')).toBe(false);
  });
});

describe('WGSL ↔ TypeScript agreement', () => {
  const binding = (src: string, slot: number) =>
    src.match(new RegExp(`@group\\(0\\)\\s+@binding\\(${slot}\\)\\s+var<storage,\\s*read>\\s+spectrum\\s*:\\s*array<f32>`));

  it('lib bin count matches SPECTRUM_BIN_COUNT (computeAnalysis.ts + spectrum_bands.wgsl)', () => {
    const lib = shader('lib/spectrum_chassis.wgsl').match(/const\s+SPECTRUM_CHASSIS_BINS\s*:\s*u32\s*=\s*(\d+)u/);
    const compute = shader('lib/spectrum_bands.wgsl').match(/const\s+SPECTRUM_BIN_COUNT\s*:\s*u32\s*=\s*(\d+)u/);
    expect(Number(lib?.[1])).toBe(SPECTRUM_BIN_COUNT);
    expect(Number(compute?.[1])).toBe(SPECTRUM_BIN_COUNT);
    expect(SPECTRUM_BUFFER_BYTES).toBe(SPECTRUM_BIN_COUNT * 4);
  });

  it.each(SPECTRUM_SHADERS)('%s: pattern WGSL declares the spectrum at the pattern binding', (id) => {
    expect(SPECTRUM_PATTERN_BINDING).toBe(9);
    expect(binding(shader(id), SPECTRUM_PATTERN_BINDING)).not.toBeNull();
    expect(binding(publicShader(id), SPECTRUM_PATTERN_BINDING)).not.toBeNull();
  });

  it.each(SPECTRUM_SHADERS)('%s: background WGSL declares the spectrum at the background binding', (id) => {
    const background = SHADER_REGISTRY[id]!.background;
    expect(SPECTRUM_BACKGROUND_BINDING).toBe(4);
    expect(binding(shader(background), SPECTRUM_BACKGROUND_BINDING)).not.toBeNull();
    expect(binding(publicShader(background), SPECTRUM_BACKGROUND_BINDING)).not.toBeNull();
  });

  it('bezel_spectrum publishes flat (no residual include) and pulls in the chassis lib', () => {
    const published = publicShader('bezel_spectrum.wgsl');
    expect(published).not.toMatch(/#include/);
    expect(published).toContain('fn spectrumLevelAt');
    expect(published).toContain('fn spectrumColor');
  });

  it('spectrumEnabled is uniform slot 23, the slot frameDraw.ts writes', () => {
    const src = shader('bezel_spectrum.wgsl');
    const body = src.match(/struct BezelUniforms\s*\{([^}]*)\}/)?.[1] ?? '';
    const fields = body
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean)
      .map((f) => f.split(':')[0]!.trim());
    expect(fields).toHaveLength(24); // 96 bytes — what frameDraw uploads
    expect(fields[23]).toBe('spectrumEnabled');
    // Slots 14/15 are dimFactor / isPlaying in frameDraw, not padding.
    expect(fields[14]).toBe('dimFactor');
    expect(fields[15]).toBe('isPlaying');

    const frameDraw = readFileSync(join(ROOT, 'src/renderers/webgpu/frameDraw.ts'), 'utf8');
    expect(frameDraw).toMatch(/bezelData\[23\]\s*=\s*usesSpectrumBuffer\(shaderFile\)\s*&&\s*p\.reactiveMode/);
  });

  it.each(SPECTRUM_SHADERS)('%s: palette is texture_2d, matching the host layout (texture_1d fails pipeline creation)', (id) => {
    // bindGroup.ts declares binding 7 without a viewDimension (=> '2d') and the palette is
    // a 2D N x 1 texture. A texture_1d declaration is rejected by Chrome at
    // createRenderPipeline ("binding dimension doesn't match the layout"), which no
    // GPU-less test can otherwise see — v0.52-v0.56/v0.59 still declare it.
    for (const src of [shader(id), publicShader(id)]) {
      expect(src).not.toMatch(/var\s+\w+\s*:\s*texture_1d/); // declarations only — comments may explain why
      expect(src).toMatch(/@binding\(7\)\s+var\s+instrumentPalette\s*:\s*texture_2d<f32>/);
      expect(src).toMatch(/textureLoad\(instrumentPalette,\s*vec2<i32>\(/);
    }
  });

  it('every bezel_spectrum bin read goes through the level helpers (no raw indexing)', () => {
    const chassis = shader('bezel_spectrum.wgsl');
    expect(chassis).not.toMatch(/spectrum\[/);
  });
});

// ── bind group layout / entries ─────────────────────────────────────────────

function fakeDevice() {
  const layoutEntries: GPUBindGroupLayoutEntry[][] = [];
  const bindGroupCalls: { entries: GPUBindGroupEntry[] }[] = [];
  const device = {
    createBindGroupLayout: vi.fn((d: { entries: GPUBindGroupLayoutEntry[] }) => {
      layoutEntries.push(d.entries);
      return {} as GPUBindGroupLayout;
    }),
    createBindGroup: vi.fn((d: { entries: GPUBindGroupEntry[] }) => {
      bindGroupCalls.push(d);
      return {} as GPUBindGroup;
    }),
  } as unknown as GPUDevice;
  return { device, layoutEntries, bindGroupCalls };
}

function bindState(overrides: Partial<BindGroupState> = {}): BindGroupState {
  const paletteView = {} as GPUTextureView; // stable: createView() results are compared by identity
  return {
    pipeline: { getBindGroupLayout: () => ({}) } as unknown as GPURenderPipeline,
    cellsBuffer: { size: 1024 } as GPUBuffer,
    uniformBuffer: {} as GPUBuffer,
    rowFlagsBuffer: {} as GPUBuffer,
    channelsBuffer: {} as GPUBuffer,
    textureResources: { sampler: {} as GPUSampler, view: {} as GPUTextureView },
    instrumentPaletteTexture: { createView: () => paletteView } as unknown as GPUTexture,
    audioReactiveUniformBuffer: {} as GPUBuffer,
    layoutType: 'extended',
    ...overrides,
  };
}

const alivePool = (state: BindGroupState): GpuResourcePool =>
  ({
    isAlive: (r: unknown) => r === state.cellsBuffer || r === state.uniformBuffer,
    isDisposed: false,
  }) as unknown as GpuResourcePool;

const bindingsOf = (entries: { binding: number }[]) => entries.map((e) => e.binding);

describe('createMainBindGroupLayout', () => {
  it('adds a fragment read-only-storage entry at the pattern binding for v0.60', () => {
    const { device, layoutEntries } = fakeDevice();
    createMainBindGroupLayout(device, 'patternv0.60.wgsl', 'extended');
    const entry = layoutEntries[0]!.find((e) => e.binding === SPECTRUM_PATTERN_BINDING);
    expect(entry).toBeDefined();
    expect(entry!.buffer).toEqual({ type: 'read-only-storage' });
    expect(entry!.visibility).toBe(GPUShaderStage.FRAGMENT);
  });

  it('keeps v0.60 layout = v0.59 layout + the one spectrum entry', () => {
    const a = fakeDevice();
    const b = fakeDevice();
    createMainBindGroupLayout(a.device, 'patternv0.59.wgsl', 'extended');
    createMainBindGroupLayout(b.device, 'patternv0.60.wgsl', 'extended');
    expect(bindingsOf(b.layoutEntries[0]!)).toEqual([...bindingsOf(a.layoutEntries[0]!), SPECTRUM_PATTERN_BINDING]);
  });

  it.each([
    'patternv0.45.wgsl',
    'patternv0.55.wgsl',
    'patternv0.58.wgsl',
    'patternv0.59.wgsl',
    'patternv0.21.wgsl',
  ])('%s: layout has no spectrum entry', (id) => {
    const { device, layoutEntries } = fakeDevice();
    const meta = SHADER_REGISTRY[id];
    createMainBindGroupLayout(device, id, meta?.extendedLayout ? 'extended' : 'standard');
    expect(bindingsOf(layoutEntries[0]!)).not.toContain(SPECTRUM_PATTERN_BINDING);
  });
});

describe('refreshMainBindGroup spectrum binding', () => {
  it('binds the supplied buffer at the pattern binding with the exact byte size', () => {
    const spectrum = { size: SPECTRUM_BUFFER_BYTES } as GPUBuffer;
    const state = bindState({ spectrumBuffer: spectrum });
    const { device, bindGroupCalls } = fakeDevice();

    expect(refreshMainBindGroup(device, alivePool(state), state, 'patternv0.60.wgsl', null)).not.toBeNull();

    const entry = bindGroupCalls[0]!.entries.find((e) => e.binding === SPECTRUM_PATTERN_BINDING)!;
    expect(entry.resource).toEqual({ buffer: spectrum, size: SPECTRUM_BUFFER_BYTES });
  });

  it('returns null (skips the frame) rather than binding nothing when no buffer was supplied', () => {
    const state = bindState({ spectrumBuffer: null });
    const { device } = fakeDevice();

    expect(refreshMainBindGroup(device, alivePool(state), state, 'patternv0.60.wgsl', null)).toBeNull();
    expect(device.createBindGroup).not.toHaveBeenCalled();
  });

  it('swapping placeholder → live buffer changes only the spectrum entry', () => {
    const placeholder = { size: SPECTRUM_BUFFER_BYTES } as GPUBuffer;
    const live = { size: SPECTRUM_BUFFER_BYTES } as GPUBuffer;
    const first = bindState({ spectrumBuffer: placeholder });
    const second = { ...first, spectrumBuffer: live };
    const { device, bindGroupCalls } = fakeDevice();

    refreshMainBindGroup(device, alivePool(first), first, 'patternv0.60.wgsl', null);
    refreshMainBindGroup(device, alivePool(second), second, 'patternv0.60.wgsl', null);

    // Resource wrappers are fresh objects per call — compare the underlying buffer.
    const target = (e: GPUBindGroupEntry) => (e.resource as { buffer?: GPUBuffer }).buffer ?? e.resource;
    const [a, b] = bindGroupCalls.map((c) => c.entries);
    expect(bindingsOf(a!)).toEqual(bindingsOf(b!));
    const differing = a!.filter((e, i) => target(e) !== target(b![i]!));
    expect(differing.map((e) => e.binding)).toEqual([SPECTRUM_PATTERN_BINDING]);
    expect(target(a!.find((e) => e.binding === SPECTRUM_PATTERN_BINDING)!)).toBe(placeholder);
    expect(target(b!.find((e) => e.binding === SPECTRUM_PATTERN_BINDING)!)).toBe(live);
  });

  it.each(['patternv0.58.wgsl', 'patternv0.59.wgsl'])(
    '%s: ignores a supplied spectrum buffer — nothing changes for existing shaders',
    (id) => {
      const state = bindState({ spectrumBuffer: { size: SPECTRUM_BUFFER_BYTES } as GPUBuffer });
      const { device, bindGroupCalls } = fakeDevice();

      expect(refreshMainBindGroup(device, alivePool(state), state, id, null)).not.toBeNull();
      expect(bindingsOf(bindGroupCalls[0]!.entries)).not.toContain(SPECTRUM_PATTERN_BINDING);
    },
  );

  it('unflagged shaders never need a spectrum buffer', () => {
    const state = bindState(); // spectrumBuffer omitted
    const { device } = fakeDevice();
    expect(refreshMainBindGroup(device, alivePool(state), state, 'patternv0.59.wgsl', null)).not.toBeNull();
  });
});
