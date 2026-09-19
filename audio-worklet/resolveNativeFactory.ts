/**
 * Resolve the Emscripten createOpenMPTModule factory from a dynamic import()
 * namespace or globals written by UMD glue (openmpt-native.js).
 *
 * emcc -sMODULARIZE=1 -sEXPORT_NAME=createOpenMPTModule without EXPORT_ES6
 * emits classic/UMD JS. `import()` then yields an empty ESM namespace; the
 * factory is assigned to `globalThis.AudioWorkletModule` (see cpp/pre.js tail).
 */

import type { CreateOpenMPTModule } from './types';

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

/**
 * Native --pre-js used to replace window.setTimeout with a delay-ignoring
 * microtask. Keep the real timers around createModule() so JS worklet fallback
 * and addModule timeouts still work if an old glue file loads.
 */
export async function withPreservedMainThreadTimers<T>(fn: () => Promise<T>): Promise<T> {
  const setTimeoutFn = globalThis.setTimeout;
  const clearTimeoutFn = globalThis.clearTimeout;
  const setIntervalFn = globalThis.setInterval;
  const clearIntervalFn = globalThis.clearInterval;
  try {
    return await fn();
  } finally {
    if (globalThis.setTimeout !== setTimeoutFn) globalThis.setTimeout = setTimeoutFn;
    if (globalThis.clearTimeout !== clearTimeoutFn) globalThis.clearTimeout = clearTimeoutFn;
    if (globalThis.setInterval !== setIntervalFn) globalThis.setInterval = setIntervalFn;
    if (globalThis.clearInterval !== clearIntervalFn) globalThis.clearInterval = clearIntervalFn;
  }
}

export function resolveEmscriptenRegisterAudioObject(
  moduleObj: { emscriptenRegisterAudioObject?: (obj: AudioContext | AudioNode) => number } | null | undefined,
  globalObj: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): ((obj: AudioContext | AudioNode) => number) | null {
  const fromMod = moduleObj?.emscriptenRegisterAudioObject;
  if (typeof fromMod === 'function') {
    return fromMod.bind(moduleObj);
  }
  const fromGlobal = globalObj['emscriptenRegisterAudioObject'];
  if (typeof fromGlobal === 'function') {
    return fromGlobal as (obj: AudioContext | AudioNode) => number;
  }
  return null;
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
