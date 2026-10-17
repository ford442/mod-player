import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  releaseWebGLContext,
  wantsDrawingBufferReadback,
  watchWebGLContextLoss,
} from '../utils/webglContext';
import { isWebGL2Available } from '../src/renderers/rendererSelection';
import { WebGL2PatternRenderer } from '../src/renderers/webgl2/WebGL2PatternRenderer';
import type { WebGPURenderParams } from '../src/renderers/params';
import { createFakeCanvas, FakeImage } from './helpers/fakeWebGL2';
import { makeMatrix } from './helpers/patternMatrix';

/**
 * #492 WebGL2 slice: context loss → restore, probe release, preserveDrawingBuffer gating.
 * The live browser proof is scripts/webgl2-context-loss-smoke.mjs (`npm run smoke:webgl2-context`).
 */

const SHADER = 'patternv0.30b.wgsl';

/** `wantsDrawingBufferReadback()` reads `globalThis.location` (the browser's `window.location`). */
function setSearch(search: string): void {
  vi.stubGlobal('location', { search });
}

function renderParams(): WebGPURenderParams {
  const matrix = makeMatrix(64, [[{ note: 49 }], [{ note: 52 }], [], []]);
  return {
    matrix, channels: [], padTopChannel: false, isPlaying: true, bpm: 125, timeSec: 1, tickOffset: 0,
    beatPhase: 0, grooveAmount: 0.5, kickTrigger: 0, activeChannels: [], isModuleLoaded: true,
    bloomIntensity: 1, bloomThreshold: 0.8, dimFactor: 1, volume: 0.5, pan: 0, isLooping: false,
    invertChannels: false, clickedButton: 0, cellWidth: 120, cellHeight: 24, playheadRow: 4,
    localTime: 0, isHorizontal: false, externalVideoSource: null, canvasMetrics: { width: 512, height: 512 },
  };
}

beforeEach(() => {
  FakeImage.instances = [];
  vi.stubGlobal('Image', FakeImage);
  setSearch('');
});

afterEach(() => {
  vi.unstubAllGlobals();
  setSearch('');
});

describe('watchWebGLContextLoss', () => {
  it('preventDefault()s the lost event (or the browser never restores) and forwards both events', () => {
    const { canvas, loseContext, restoreContext } = createFakeCanvas();
    const onLost = vi.fn();
    const onRestored = vi.fn();
    watchWebGLContextLoss(canvas, { onLost, onRestored });

    expect(loseContext().defaultPrevented).toBe(true);
    expect(onLost).toHaveBeenCalledTimes(1);
    restoreContext();
    expect(onRestored).toHaveBeenCalledTimes(1);
  });

  it('the disposer removes both listeners', () => {
    const { canvas, loseContext, restoreContext } = createFakeCanvas();
    const onLost = vi.fn();
    const onRestored = vi.fn();
    const dispose = watchWebGLContextLoss(canvas, { onLost, onRestored });
    dispose();

    expect(loseContext().defaultPrevented).toBe(false);
    restoreContext();
    expect(onLost).not.toHaveBeenCalled();
    expect(onRestored).not.toHaveBeenCalled();
  });
});

describe('releaseWebGLContext / the WebGL2 support probe', () => {
  it('loses the context through WEBGL_lose_context, and tolerates null / a missing extension', () => {
    const loseContext = vi.fn();
    const gl = { getExtension: vi.fn(() => ({ loseContext })) } as unknown as WebGL2RenderingContext;
    releaseWebGLContext(gl);
    expect(gl.getExtension).toHaveBeenCalledWith('WEBGL_lose_context');
    expect(loseContext).toHaveBeenCalledTimes(1);

    expect(() => releaseWebGLContext(null)).not.toThrow();
    expect(() => releaseWebGLContext({ getExtension: () => null } as unknown as WebGL2RenderingContext)).not.toThrow();
  });

  it('isWebGL2Available() releases its probe context instead of leaving it to GC', () => {
    const loseContext = vi.fn();
    const probeGl = { getExtension: vi.fn(() => ({ loseContext })) };
    const getContext = vi.fn(() => probeGl);
    vi.stubGlobal('document', { createElement: vi.fn(() => ({ getContext })) });

    expect(isWebGL2Available()).toBe(true);
    expect(getContext).toHaveBeenCalledWith('webgl2');
    expect(loseContext).toHaveBeenCalledTimes(1);

    getContext.mockReturnValueOnce(null as never);
    expect(isWebGL2Available()).toBe(false);
    expect(loseContext).toHaveBeenCalledTimes(1);
  });
});

describe('preserveDrawingBuffer is only requested for readback (automation / ?debug=readback)', () => {
  it('wantsDrawingBufferReadback(): navigator.webdriver or ?debug=readback, otherwise off', () => {
    expect(wantsDrawingBufferReadback()).toBe(false);
    setSearch('?debug=log');
    expect(wantsDrawingBufferReadback()).toBe(false);
    setSearch('?debug=log,readback');
    expect(wantsDrawingBufferReadback()).toBe(true);
    setSearch('');
    vi.stubGlobal('navigator', { webdriver: true });
    expect(wantsDrawingBufferReadback()).toBe(true);
    vi.stubGlobal('navigator', { webdriver: false });
    expect(wantsDrawingBufferReadback()).toBe(false);
  });

  it('the renderer asks for it only when the flag is set', () => {
    const attrs = (search: string, webdriver: boolean) => {
      setSearch(search);
      vi.stubGlobal('navigator', { webdriver });
      const { canvas, getContext } = createFakeCanvas();
      const renderer = new WebGL2PatternRenderer();
      expect(renderer.init(canvas, SHADER)).toBe(true);
      renderer.destroy();
      return getContext.mock.calls[0]?.[1] as WebGLContextAttributes;
    };
    expect(attrs('', false).preserveDrawingBuffer).toBe(false);
    expect(attrs('', true).preserveDrawingBuffer).toBe(true);
    expect(attrs('?debug=readback', false).preserveDrawingBuffer).toBe(true);
  });
});

describe('WebGL2PatternRenderer context loss → restore', () => {
  function setup() {
    const fc = createFakeCanvas();
    const onContextLost = vi.fn();
    const onContextRestored = vi.fn();
    const renderer = new WebGL2PatternRenderer();
    expect(renderer.init(fc.canvas, SHADER, { onContextLost, onContextRestored })).toBe(true);
    return { ...fc, renderer, onContextLost, onContextRestored };
  }

  it('lost: preventDefault, frames stop issuing GL calls, nothing is deleted', () => {
    const { fake, renderer, loseContext, onContextLost } = setup();
    const params = renderParams();
    renderer.render(params, false, true);
    expect(fake.count('drawArraysInstanced')).toBe(1);
    expect(renderer.getContextState().frames).toBe(1);

    expect(loseContext().defaultPrevented).toBe(true);
    expect(onContextLost).toHaveBeenCalledTimes(1);
    expect(renderer.isContextLost()).toBe(true);

    const before = fake.calls.length;
    for (let i = 0; i < 5; i++) renderer.render(params, false, true);
    expect(renderer.readPixels()).toBeNull();
    expect(fake.calls.length).toBe(before); // not a single GL call while lost
    expect(renderer.getContextState()).toMatchObject({ lost: true, losses: 1, frames: 1 });
  });

  it('restored: every program / VAO / buffer / texture / FBO is re-created and frames resume', () => {
    const { fake, renderer, loseContext, restoreContext, onContextRestored } = setup();
    const params = renderParams();
    renderer.render(params, false, false);
    const created = {
      programs: fake.count('createProgram'),
      vaos: fake.count('createVertexArray'),
      buffers: fake.count('createBuffer'),
      textures: fake.count('createTexture'),
      fbos: fake.count('createFramebuffer'),
    };
    expect(created.programs).toBe(4); // chassis + pattern + bloom blur + composite
    expect(created.fbos).toBe(3); // bloom scene / ping / pong

    loseContext();
    const deletesBeforeRestore = fake.countPrefix('delete');
    restoreContext();

    expect(onContextRestored).toHaveBeenCalledWith(null);
    expect(renderer.isContextLost()).toBe(false);
    expect(fake.count('createProgram')).toBe(created.programs * 2);
    expect(fake.count('createVertexArray')).toBe(created.vaos * 2);
    expect(fake.count('createBuffer')).toBe(created.buffers * 2);
    expect(fake.count('createTexture')).toBe(created.textures * 2);
    expect(fake.count('createFramebuffer')).toBe(created.fbos * 2);
    // The dead objects are forgotten, never deleted (that would only raise INVALID_OPERATION).
    expect(fake.countPrefix('delete')).toBe(deletesBeforeRestore);

    const uploadsBefore = fake.count('texImage2D');
    const drawsBefore = fake.count('drawArraysInstanced');
    renderer.render(params, false, false);
    expect(fake.count('drawArraysInstanced')).toBe(drawsBefore + 1);
    // Cell texture (matrix) + channel state are uploaded into the new textures.
    expect(fake.count('texImage2D') - uploadsBefore).toBeGreaterThanOrEqual(2);
    expect(renderer.getContextState()).toMatchObject({ lost: false, losses: 1, restores: 1, frames: 2 });
  });

  it('re-uploads the already loaded lens-cap image into the new cap texture', () => {
    const { fake, loseContext, restoreContext } = setup();
    expect(FakeImage.instances).toHaveLength(1);
    const beforeLoad = fake.count('texImage2D');
    FakeImage.instances[0]!.load();
    const afterLoad = fake.count('texImage2D');
    expect(afterLoad - beforeLoad).toBe(1);

    loseContext();
    const fbos = fake.count('createFramebuffer');
    restoreContext();
    expect(FakeImage.instances).toHaveLength(1); // loaded once, not re-fetched
    // One allocation per new bloom FBO texture, plus the cap image upload.
    expect(fake.count('createFramebuffer') - fbos).toBe(3);
    expect(fake.count('texImage2D') - afterLoad).toBe(3 + 1);
  });

  it('can be lost and restored repeatedly', () => {
    const { renderer, loseContext, restoreContext } = setup();
    for (let i = 0; i < 3; i++) {
      loseContext();
      restoreContext();
      renderer.render(renderParams(), false, true);
    }
    expect(renderer.getContextState()).toMatchObject({ lost: false, losses: 3, restores: 3, frames: 3 });
  });

  it('reports a failed re-creation instead of throwing out of the event handler', () => {
    const { fake, renderer, loseContext, restoreContext, onContextRestored } = setup();
    loseContext();
    fake.failCompile = true;
    expect(() => restoreContext()).not.toThrow();
    expect(onContextRestored).toHaveBeenCalledWith(expect.stringContaining('shader error'));
    const before = fake.calls.length;
    renderer.render(renderParams(), false, true);
    expect(fake.calls.length).toBe(before); // idle, not crashing per frame
  });

  it('destroy() removes the listeners, and does not delete objects of a lost context', () => {
    const { fake, renderer, loseContext, restoreContext, onContextLost, onContextRestored } = setup();
    loseContext();
    const deletes = fake.countPrefix('delete');
    renderer.destroy();
    expect(fake.countPrefix('delete')).toBe(deletes);

    restoreContext();
    expect(loseContext().defaultPrevented).toBe(false);
    expect(onContextLost).toHaveBeenCalledTimes(1);
    expect(onContextRestored).not.toHaveBeenCalled();
  });

  it('destroy() on a live context still deletes its objects', () => {
    const { fake, renderer } = setup();
    renderer.destroy();
    expect(fake.count('deleteProgram')).toBe(4);
    expect(fake.count('deleteFramebuffer')).toBe(3);
  });

  it('init on an already-lost context waits for the restore instead of throwing', () => {
    const fc = createFakeCanvas();
    fc.fake.lost = true;
    const renderer = new WebGL2PatternRenderer();
    expect(renderer.init(fc.canvas, SHADER)).toBe(true);
    expect(renderer.isContextLost()).toBe(true);
    expect(fc.fake.count('createProgram')).toBe(0);
    fc.restoreContext();
    expect(fc.fake.count('createProgram')).toBe(4);
    expect(renderer.isContextLost()).toBe(false);
  });
});
