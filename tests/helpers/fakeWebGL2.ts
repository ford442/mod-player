/**
 * Minimal fake WebGL2 context + canvas for unit tests (vitest runs in node, no DOM / GL).
 *
 * Every method records its name in `calls` and returns something plausible: `create*` → a fresh
 * handle object, compile/link status → true (or false while `failCompile`), `getError` →
 * NO_ERROR, `isContextLost` → the `lost` flag. Enum constants resolve to stable numbers
 * (`NO_ERROR` is 0). The canvas is a real `EventTarget`, so `webglcontextlost` /
 * `webglcontextrestored` dispatch through the same listener API a browser uses.
 */
import { vi } from 'vitest';

export interface FakeGL {
  gl: WebGL2RenderingContext;
  /** Method names in call order. */
  calls: string[];
  /** What `isContextLost()` reports (set together with dispatching the events). */
  lost: boolean;
  /** Make `getShaderParameter(COMPILE_STATUS)` fail. */
  failCompile: boolean;
  count(name: string): number;
  /** Calls whose name starts with one of the prefixes. */
  countPrefix(...prefixes: string[]): number;
}

export interface FakeCanvas {
  canvas: HTMLCanvasElement;
  fake: FakeGL;
  getContext: ReturnType<typeof vi.fn>;
  /** Simulate the browser losing the context; returns the event (check `defaultPrevented`). */
  loseContext(): Event;
  /** Simulate the browser restoring it. */
  restoreContext(): void;
}

function enumValue(name: string): number {
  if (name === 'NO_ERROR') return 0;
  let h = 0x8000;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return h | 0x10000;
}

export function createFakeGL(canvas: { width: number; height: number }): FakeGL {
  let nextId = 1;
  const fake: FakeGL = {
    gl: null as unknown as WebGL2RenderingContext,
    calls: [],
    lost: false,
    failCompile: false,
    count: (name) => fake.calls.filter((c) => c === name).length,
    countPrefix: (...prefixes) => fake.calls.filter((c) => prefixes.some((p) => c.startsWith(p))).length,
  };
  const method = (name: string) => (..._args: unknown[]) => {
    fake.calls.push(name);
    switch (name) {
      case 'isContextLost':
        return fake.lost;
      case 'getError':
        return 0;
      case 'getShaderParameter':
        return !fake.failCompile;
      case 'getProgramParameter':
        return true;
      case 'getShaderInfoLog':
      case 'getProgramInfoLog':
        return 'fake compile error';
      case 'getUniformLocation':
        return { uniform: nextId++ };
      case 'getExtension':
        return null;
      default:
        return name.startsWith('create') ? { handle: nextId++, kind: name } : undefined;
    }
  };
  fake.gl = new Proxy({} as WebGL2RenderingContext, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined;
      if (prop === 'canvas') return canvas;
      if (/^[A-Z][A-Z0-9_]*$/.test(prop)) return enumValue(prop);
      return method(prop);
    },
  });
  return fake;
}

export function createFakeCanvas(width = 512, height = 512): FakeCanvas {
  const target = new EventTarget() as EventTarget & { width: number; height: number; getContext?: unknown };
  target.width = width;
  target.height = height;
  const fake = createFakeGL(target);
  const getContext = vi.fn((type: string) => (type === 'webgl2' ? fake.gl : null));
  target.getContext = getContext;
  return {
    canvas: target as unknown as HTMLCanvasElement,
    fake,
    getContext,
    loseContext: () => {
      fake.lost = true;
      const event = new Event('webglcontextlost', { cancelable: true });
      target.dispatchEvent(event);
      return event;
    },
    restoreContext: () => {
      fake.lost = false;
      target.dispatchEvent(new Event('webglcontextrestored'));
    },
  };
}

/** `new Image()` stand-in: never loads unless `complete` / `naturalWidth` are set by the test. */
export class FakeImage {
  static instances: FakeImage[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  complete = false;
  naturalWidth = 0;
  src = '';
  constructor() {
    FakeImage.instances.push(this);
  }
  /** Finish loading and fire `onload`. */
  load(): void {
    this.complete = true;
    this.naturalWidth = 64;
    this.onload?.();
  }
}
