/**
 * Resolve the Emscripten createOpenMPTModule factory from a dynamic import()
 * namespace or globals written by UMD glue (openmpt-native.js).
 *
 * emcc -sMODULARIZE=1 -sEXPORT_NAME=createOpenMPTModule without EXPORT_ES6
 * emits classic/UMD JS. `import()` then yields an empty ESM namespace; the
 * factory is assigned to `globalThis.AudioWorkletModule` (see cpp/pre.js tail).
 */

import type { CreateOpenMPTModule } from './types';

type WasmNs = typeof WebAssembly & { isWasm2js?: boolean };

/** Real browser WebAssembly (not the wasm2js stub from libopenmptjs.js). */
export function getNativeWebAssembly(): WasmNs | null {
  const g = globalThis as typeof globalThis & { __NATIVE_WEBASSEMBLY__?: WasmNs };
  const snap = g.__NATIVE_WEBASSEMBLY__;
  if (snap && typeof snap.Memory === 'function' && !snap.isWasm2js) {
    return snap;
  }
  if (typeof WebAssembly !== 'undefined' && !(WebAssembly as WasmNs).isWasm2js) {
    return WebAssembly as WasmNs;
  }
  return snap ?? null;
}

/**
 * Install the real WebAssembly API for the native engine.
 * Main-thread wasm2js overwrites global WebAssembly with a stub Memory();
 * AUDIO_WORKLET / WASM_WORKERS need the real constructor after instantiate.
 * wasm2js keeps its own local binding — do not put the stub back.
 */
export function installNativeWebAssembly(): boolean {
  const real = getNativeWebAssembly();
  if (!real) {
    return false;
  }
  (globalThis as typeof globalThis & { WebAssembly: typeof WebAssembly }).WebAssembly = real;
  return true;
}

/**
 * Run `fn` with the real WebAssembly API installed (left installed afterward).
 */
export async function withNativeWebAssembly<T>(fn: () => Promise<T>): Promise<T> {
  installNativeWebAssembly();
  return fn();
}

/**
 * Emscripten 3.1.51 addModule('openmpt-native.aw.js') is resolved against the
 * page URL (site root), not locateFile / wasmBasePath. Rewrite to the glue dir.
 */
export function installNativeAwJsModuleRewrite(basePath: string): void {
  if (typeof AudioWorklet === 'undefined') return;
  const proto = AudioWorklet.prototype as AudioWorklet & { __xasm1AwRewrite?: boolean };
  if (proto.__xasm1AwRewrite) return;
  const orig = proto.addModule;
  proto.addModule = function (this: AudioWorklet, moduleURL: string | URL, options?: WorkletOptions) {
    let url = moduleURL;
    if (typeof url === 'string' && /(?:^|\/)openmpt-native\.aw\.js(?:\?|$)/.test(url) && !url.includes(basePath)) {
      const name = url.split('/').pop() ?? 'openmpt-native.aw.js';
      url = `${basePath}${name}`;
    }
    return orig.call(this, url, options);
  };
  proto.__xasm1AwRewrite = true;
}

export function resolveCreateOpenMPTModule(
  ns: Record<string, unknown> | null | undefined,
  globalObj: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): CreateOpenMPTModule | null {
  const candidates: unknown[] = [
    ns?.['default'],
    ns?.['createOpenMPTModule'],
    globalObj['AudioWorkletModule'],
    globalObj['createOpenMPTModule'],
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'function') {
      return candidate as CreateOpenMPTModule;
    }
  }
  return null;
}
