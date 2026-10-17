import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWebGLOverlay, type WebGLOverlayParams } from '../hooks/useWebGLOverlay';
import { createFakeCanvas, FakeImage, type FakeCanvas } from './helpers/fakeWebGL2';
import { makeMatrix } from './helpers/patternMatrix';

/**
 * #492: the hybrid overlay (`hooks/useWebGLOverlay.ts`) survives WebGL context loss.
 *
 * vitest has no DOM and no React renderer here, so `react` is replaced by a tiny hook runtime
 * (refs / state / callbacks / effects with dependency diffing, cleanups before effects like
 * React's commit). `rerender()` stands in for the re-render a `setState` schedules. The live
 * browser proof is scripts/webgl2-context-loss-smoke.mjs (overlay scenario).
 */
const runtime = vi.hoisted(() => {
  type Slot = { current?: unknown; value?: unknown; set?: (v: unknown) => void; fn?: unknown; deps?: unknown[] };
  type Effect = { deps: unknown[] | undefined; cleanup: (() => void) | void };
  type Pending = { index: number; fn: () => (() => void) | void; deps: unknown[] | undefined };
  const state = {
    slots: [] as Slot[],
    effects: [] as Array<Effect | undefined>,
    pending: [] as Pending[],
    cursor: 0,
    effectCursor: 0,
  };
  const sameDeps = (a: unknown[] | undefined, b: unknown[] | undefined) =>
    !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useRef: (initial: unknown) => {
      const i = state.cursor++;
      state.slots[i] ??= { current: initial };
      return state.slots[i];
    },
    useState: (initial: unknown) => {
      const i = state.cursor++;
      if (!state.slots[i]) {
        const slot: Slot = { value: typeof initial === 'function' ? (initial as () => unknown)() : initial };
        slot.set = (v: unknown) => {
          slot.value = typeof v === 'function' ? (v as (p: unknown) => unknown)(slot.value) : v;
        };
        state.slots[i] = slot;
      }
      const slot = state.slots[i]!;
      return [slot.value, slot.set];
    },
    useCallback: (fn: unknown, deps: unknown[]) => {
      const i = state.cursor++;
      const prev = state.slots[i];
      if (prev && sameDeps(prev.deps, deps)) return prev.fn;
      state.slots[i] = { fn, deps };
      return fn;
    },
    useEffect: (fn: () => (() => void) | void, deps?: unknown[]) => {
      const i = state.effectCursor++;
      const prev = state.effects[i];
      if (!prev || !sameDeps(prev.deps, deps)) state.pending.push({ index: i, fn, deps });
    },
  };
  return { state, react };
});

vi.mock('react', () => runtime.react);

function renderHook<T>(hook: () => T) {
  const s = runtime.state;
  let result!: T;
  const commit = () => {
    s.cursor = 0;
    s.effectCursor = 0;
    s.pending = [];
    result = hook();
    for (const p of s.pending) s.effects[p.index]?.cleanup?.();
    for (const p of s.pending) s.effects[p.index] = { deps: p.deps, cleanup: p.fn() };
  };
  commit();
  return {
    get result() {
      return result;
    },
    rerender: commit,
    unmount: () => {
      for (const e of s.effects) e?.cleanup?.();
      s.effects = [];
      s.slots = [];
    },
  };
}

type DebugInfo = { layoutMode: string; errors: string[]; uniforms: Record<string, number | string> };

function mountOverlay(fc: FakeCanvas) {
  let debug: DebugInfo = { layoutMode: 'NONE', errors: [], uniforms: {} };
  const setDebugInfo = vi.fn((action: DebugInfo | ((prev: DebugInfo) => DebugInfo)) => {
    debug = typeof action === 'function' ? action(debug) : action;
  });
  const glCanvasRef = { current: fc.canvas };
  const params: WebGLOverlayParams = {
    shaderFile: 'patternv0.40.wgsl', // a webglHybrid shader
    matrix: makeMatrix(64, [[{ note: 49 }], [{ note: 52 }], [], []]),
    padTopChannel: false,
    isOverlayActive: true,
    invertChannels: false,
    playheadRow: 3,
    cellWidth: 120,
    cellHeight: 24,
    channels: [],
    bloomIntensity: 1,
    stepsLength: 32,
  };
  const hook = renderHook(() => useWebGLOverlay(glCanvasRef, params, setDebugInfo as never));
  return { hook, params, debug: () => debug };
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  runtime.state.slots = [];
  runtime.state.effects = [];
  FakeImage.instances = [];
  vi.stubGlobal('Image', FakeImage);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'group').mockImplementation(() => {});
  vi.spyOn(console, 'groupEnd').mockImplementation(() => {});
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useWebGLOverlay context loss → restore (#492)', () => {
  it('lost: preventDefault, the overlay stops issuing GL calls, one warn, debug entry', () => {
    const fc = createFakeCanvas();
    const { hook, debug } = mountOverlay(fc);
    expect(fc.fake.count('createProgram')).toBe(1);
    hook.result.drawWebGL();
    expect(fc.fake.count('drawArraysInstanced')).toBe(1);

    expect(fc.loseContext().defaultPrevented).toBe(true);
    const lostWarns = warn.mock.calls.filter((c: unknown[]) => String(c[1] ?? c[0]).includes('context lost'));
    expect(lostWarns).toHaveLength(1);
    expect(debug().errors.some((e) => e.startsWith('WEBGL-OVERLAY-CONTEXT: lost'))).toBe(true);

    const before = fc.fake.calls.length;
    for (let i = 0; i < 5; i++) hook.result.drawWebGL();
    expect(fc.fake.calls.length).toBe(before);
  });

  it('restored: program, VAO, buffer and textures are re-created, the matrix re-uploaded, drawing resumes', () => {
    const fc = createFakeCanvas();
    const { hook, debug } = mountOverlay(fc);
    const created = {
      programs: fc.fake.count('createProgram'),
      vaos: fc.fake.count('createVertexArray'),
      buffers: fc.fake.count('createBuffer'),
      textures: fc.fake.count('createTexture'),
      uploads: fc.fake.count('texImage2D'),
    };
    expect(created).toMatchObject({ programs: 1, vaos: 1, buffers: 1, textures: 3, uploads: 1 });

    fc.loseContext();
    const deletes = fc.fake.countPrefix('delete');
    fc.restoreContext();
    hook.rerender(); // the generation bump the restore handler scheduled

    expect(fc.fake.count('createProgram')).toBe(2);
    expect(fc.fake.count('createVertexArray')).toBe(2);
    expect(fc.fake.count('createBuffer')).toBe(2);
    expect(fc.fake.count('createTexture')).toBe(6);
    expect(fc.fake.count('texImage2D')).toBe(2); // the matrix went into the new cell texture
    // The dead objects were forgotten, not deleted.
    expect(fc.fake.countPrefix('delete')).toBe(deletes);
    expect(debug().errors.some((e) => e.startsWith('WEBGL-OVERLAY-CONTEXT'))).toBe(false);

    const draws = fc.fake.count('drawArraysInstanced');
    hook.result.drawWebGL();
    expect(fc.fake.count('drawArraysInstanced')).toBe(draws + 1);
  });

  it('a cap image that finishes loading after a loss/restore does not touch the dead texture', () => {
    const fc = createFakeCanvas();
    const { hook } = mountOverlay(fc);
    const staleImage = FakeImage.instances[0]!;
    fc.loseContext();
    fc.restoreContext();
    hook.rerender();
    const uploads = fc.fake.count('texImage2D');
    staleImage.load(); // belongs to the pre-loss texture
    expect(fc.fake.count('texImage2D')).toBe(uploads);
    FakeImage.instances.at(-1)!.load(); // the restore's own load
    expect(fc.fake.count('texImage2D')).toBe(uploads + 1);
  });

  it('a loss while the overlay is inactive is still restorable, and re-activation rebuilds on the restored context', () => {
    const fc = createFakeCanvas();
    const { hook, params } = mountOverlay(fc);
    params.isOverlayActive = false; // e.g. lite mode toggled on
    hook.rerender();
    expect(fc.fake.count('deleteProgram')).toBe(1); // live context: deactivation frees normally

    expect(fc.loseContext().defaultPrevented).toBe(true);
    fc.restoreContext();
    hook.rerender();
    expect(fc.fake.count('createProgram')).toBe(1); // inactive: nothing rebuilt yet

    params.isOverlayActive = true;
    hook.rerender();
    expect(fc.fake.count('createProgram')).toBe(2);
    const draws = fc.fake.count('drawArraysInstanced');
    hook.result.drawWebGL();
    expect(fc.fake.count('drawArraysInstanced')).toBe(draws + 1);
  });

  it('unmount removes the listeners and deletes the live resources', () => {
    const fc = createFakeCanvas();
    const { hook } = mountOverlay(fc);
    hook.unmount();
    expect(fc.fake.count('deleteProgram')).toBe(1);
    expect(fc.loseContext().defaultPrevented).toBe(false);
  });
});
