import { describe, expect, it, vi } from 'vitest';
import {
  fetchWorkletLibAssets,
  hasWasmMagic,
  looksLikeWasm2jsGlue,
} from '../utils/workletLibAssets';

const WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0xde, 0xad]);
const GLUE = 'var Module=typeof libopenmpt!="undefined"?libopenmpt:{};/* real glue */';

function respond(body: string | Uint8Array, init: { ok?: boolean; status?: number } = {}): Response {
  const ok = init.ok ?? true;
  return {
    ok,
    status: init.status ?? (ok ? 200 : 500),
    text: async () => (typeof body === 'string' ? body : new TextDecoder().decode(body)),
    arrayBuffer: async () => {
      const u8 = typeof body === 'string' ? new TextEncoder().encode(body) : body;
      return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    },
  } as unknown as Response;
}

function fakeFetch(map: Record<string, Response>): typeof fetch {
  return vi.fn(async (url: RequestInfo | URL) => {
    const hit = map[String(url)];
    if (!hit) throw new Error(`unexpected fetch ${String(url)}`);
    return hit;
  }) as unknown as typeof fetch;
}

const URLS = { jsUrl: '/w/libopenmpt-worklet.js?v=abc', wasmUrl: '/w/libopenmpt-worklet.wasm?v=abc' };

describe('hasWasmMagic', () => {
  it('accepts \\0asm, rejects everything else', () => {
    expect(hasWasmMagic(WASM)).toBe(true);
    expect(hasWasmMagic(WASM.buffer.slice(0))).toBe(true);
    expect(hasWasmMagic(new TextEncoder().encode('<!doctype html>'))).toBe(false);
    expect(hasWasmMagic(new Uint8Array(2))).toBe(false);
  });
});

describe('looksLikeWasm2jsGlue', () => {
  it('detects minified and readable wasm2js markers', () => {
    expect(looksLikeWasm2jsGlue('Module={isWasm2js:!0}')).toBe(true);
    expect(looksLikeWasm2jsGlue('Module = { isWasm2js: true }')).toBe(true);
    expect(looksLikeWasm2jsGlue(GLUE)).toBe(false);
  });
});

describe('fetchWorkletLibAssets', () => {
  it('fetches glue + wasm and returns both', async () => {
    const f = fakeFetch({ [URLS.jsUrl]: respond(GLUE), [URLS.wasmUrl]: respond(WASM) });
    const assets = await fetchWorkletLibAssets({ fetchImpl: f, ...URLS });
    expect(assets.scriptText).toBe(GLUE);
    expect(new Uint8Array(assets.wasmBytes)).toEqual(WASM);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('keeps the "HTTP 404" wording the play error mapper keys on', async () => {
    const f = fakeFetch({
      [URLS.jsUrl]: respond('nope', { ok: false, status: 404 }),
      [URLS.wasmUrl]: respond(WASM),
    });
    await expect(fetchWorkletLibAssets({ fetchImpl: f, ...URLS })).rejects.toThrow(/HTTP 404 for libopenmpt-worklet\.js/);
  });

  it('rejects an HTML 404 body masquerading as the wasm', async () => {
    const f = fakeFetch({
      [URLS.jsUrl]: respond(GLUE),
      [URLS.wasmUrl]: respond('<!doctype html><title>Not Found</title>'),
    });
    await expect(fetchWorkletLibAssets({ fetchImpl: f, ...URLS })).rejects.toThrow(/not a valid WebAssembly binary/);
  });

  it('rejects a stale wasm2js glue — there is no JS-only init path any more', async () => {
    const f = fakeFetch({
      [URLS.jsUrl]: respond('var Module={isWasm2js:!0};'),
      [URLS.wasmUrl]: respond(WASM),
    });
    await expect(fetchWorkletLibAssets({ fetchImpl: f, ...URLS })).rejects.toThrow(/wasm2js/);
  });

  it('rejects an empty glue', async () => {
    const f = fakeFetch({ [URLS.jsUrl]: respond('   '), [URLS.wasmUrl]: respond(WASM) });
    await expect(fetchWorkletLibAssets({ fetchImpl: f, ...URLS })).rejects.toThrow(/empty/);
  });
});
