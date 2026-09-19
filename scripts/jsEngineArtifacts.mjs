/**
 * Inspect / verify the real-WASM libopenmpt pair used by the default JS engine:
 *
 *   public/worklets/libopenmpt-worklet.js     Emscripten glue (classic script)
 *   public/worklets/libopenmpt-worklet.wasm   real \0asm binary
 *   audio-worklet/js/libopenmpt-worklet.generated.json   manifest (SRI, sizes, cache key)
 *
 * Built by scripts/build-js-libopenmpt.sh; CLI wrapper is scripts/verify-js-libopenmpt.mjs.
 * Everything here is pure Node (no emsdk needed) so CI and vitest can run it.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..');

export const JS_ENGINE_GLUE = 'libopenmpt-worklet.js';
export const JS_ENGINE_WASM = 'libopenmpt-worklet.wasm';
export const JS_ENGINE_MANIFEST_REL = 'audio-worklet/js/libopenmpt-worklet.generated.json';
export const JS_ENGINE_MANIFEST_SCHEMA = 1;

const WASM_MAGIC = Buffer.from([0x00, 0x61, 0x73, 0x6d]);
const MIN_WASM_BYTES = 64 * 1024;

/**
 * C exports the app relies on. The build exports the WHOLE libopenmpt C API; this list is the
 * regression floor (main thread, parser worker, JS worklet, offline render, ext mute).
 */
export const REQUIRED_C_EXPORTS = Object.freeze([
  '_malloc',
  '_free',
  '_openmpt_free_string',
  '_openmpt_module_create_from_memory2',
  '_openmpt_module_destroy',
  '_openmpt_module_ext_create_from_memory',
  '_openmpt_module_ext_destroy',
  '_openmpt_module_ext_get_interface',
  '_openmpt_module_ext_get_module',
  '_openmpt_module_ctl_set_text',
  '_openmpt_module_get_current_channel_vu_mono',
  '_openmpt_module_get_current_estimated_bpm',
  '_openmpt_module_get_current_order',
  '_openmpt_module_get_current_playing_channels',
  '_openmpt_module_get_current_row',
  '_openmpt_module_get_current_speed',
  '_openmpt_module_get_duration_seconds',
  '_openmpt_module_get_instrument_name',
  '_openmpt_module_get_metadata',
  '_openmpt_module_get_num_channels',
  '_openmpt_module_get_num_instruments',
  '_openmpt_module_get_num_orders',
  '_openmpt_module_get_num_samples',
  '_openmpt_module_get_order_pattern',
  '_openmpt_module_get_pattern_num_rows',
  '_openmpt_module_get_pattern_row_channel_command',
  '_openmpt_module_get_position_seconds',
  '_openmpt_module_get_sample_name',
  '_openmpt_module_get_time_at_position',
  '_openmpt_module_read_float_stereo',
  '_openmpt_module_set_position_order_row',
  '_openmpt_module_set_position_seconds',
  '_openmpt_module_set_render_param',
  '_openmpt_module_set_repeat_count',
]);

/** Module members the consumers read (worklet: HEAPU8/HEAPF32; main thread: UTF8ToString, ext mute: getValue/dynCall). */
export const REQUIRED_RUNTIME_MEMBERS = Object.freeze([
  'HEAPU8',
  'HEAPF32',
  'UTF8ToString',
  'getValue',
  'dynCall',
]);

/**
 * Must NOT be exported: the app polyfills its own (str) → ptr stringToUTF8 only when the glue
 * lacks one (hooks/libOpenMPT/runInit.ts). Emscripten's real (str, outPtr, maxBytes) would be
 * picked up instead and silently corrupt every metadata call.
 */
export const FORBIDDEN_RUNTIME_MEMBERS = Object.freeze(['stringToUTF8']);

export function sha384Sri(buf) {
  return `sha384-${createHash('sha384').update(buf).digest('base64')}`;
}

export function cacheKey(glueBuf, wasmBuf) {
  return createHash('sha256').update(glueBuf).update(wasmBuf).digest('hex').slice(0, 10);
}

/** @returns {{ok: boolean, exports: string[], imports: {module: string, name: string, kind: string}[], error?: string}} */
export function inspectWasm(bytes) {
  const buf = Buffer.from(bytes);
  if (buf.length < 4 || !buf.subarray(0, 4).equals(WASM_MAGIC)) {
    return { ok: false, exports: [], imports: [], error: 'missing \\0asm magic' };
  }
  try {
    const mod = new WebAssembly.Module(buf);
    return {
      ok: true,
      exports: WebAssembly.Module.exports(mod).map((e) => e.name),
      imports: WebAssembly.Module.imports(mod),
    };
  } catch (e) {
    return { ok: false, exports: [], imports: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Release wasm minifies its own export/import names, so the readable C export list and any JS
 * exception trampolines have to be read from the glue: every export is mapped as
 * `Module["_name"] = wasmExports[...]` and JS-based EH defines `function invoke_<sig>(...)`.
 */
export function inspectGlue(text) {
  const cExports = new Set();
  for (const m of text.matchAll(/Module\["(_[A-Za-z0-9_]+)"\]\s*=/g)) cExports.add(m[1]);
  return {
    isWasm2js: /isWasm2js\s*:\s*(!0|true)/.test(text),
    hasEsmExport: /^\s*export\s/m.test(text),
    replacesGlobalWebAssembly: /\bvar\s+WebAssembly\s*=/.test(text),
    referencesWasmFile: text.includes(JS_ENGINE_WASM),
    usesJsExceptionTrampolines: /\bfunction\s+invoke_[a-z]+\s*\(/.test(text),
    cExports: [...cExports].sort(),
  };
}

function readOrNull(path) {
  try {
    return readFileSync(path);
  } catch {
    return null;
  }
}

export function resolveArtifactPaths(root = REPO_ROOT) {
  const dir = join(root, 'public', 'worklets');
  return {
    dir,
    glue: join(dir, JS_ENGINE_GLUE),
    wasm: join(dir, JS_ENGINE_WASM),
    manifest: join(root, JS_ENGINE_MANIFEST_REL),
  };
}

/** Build (and optionally write) the manifest for the artifacts currently on disk. */
export function buildManifest({ root = REPO_ROOT, emcc, eh, simd, libopenmpt, variant, write = false }) {
  const p = resolveArtifactPaths(root);
  const glueBuf = readFileSync(p.glue);
  const wasmBuf = readFileSync(p.wasm);
  const info = inspectWasm(wasmBuf);
  if (!info.ok) throw new Error(`cannot build manifest: ${info.error}`);
  const manifest = {
    schema: JS_ENGINE_MANIFEST_SCHEMA,
    libopenmpt,
    emsdk: emcc,
    variant,
    exceptions: eh,
    simd: simd === true || simd === '1' || simd === 1,
    version: cacheKey(glueBuf, wasmBuf),
    glue: { file: JS_ENGINE_GLUE, bytes: glueBuf.length, integrity: sha384Sri(glueBuf) },
    wasm: { file: JS_ENGINE_WASM, bytes: wasmBuf.length, integrity: sha384Sri(wasmBuf) },
    cExportCount: inspectGlue(glueBuf.toString('utf8')).cExports.filter((n) => n.startsWith('_openmpt_')).length,
  };
  if (write) writeFileSync(p.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/**
 * Static checks (no instantiate): files exist, real wasm, glue is not wasm2js, manifest agrees
 * with the bytes on disk, required exports present, no JS-EH trampolines when the manifest says
 * wasm exceptions.
 */
export function checkArtifacts({ root = REPO_ROOT } = {}) {
  const errors = [];
  const p = resolveArtifactPaths(root);
  const glueBuf = readOrNull(p.glue);
  const wasmBuf = readOrNull(p.wasm);
  const manifestBuf = readOrNull(p.manifest);

  if (!glueBuf) errors.push(`missing ${JS_ENGINE_GLUE} (run: npm run build:js-libopenmpt)`);
  if (!wasmBuf) errors.push(`missing ${JS_ENGINE_WASM} (run: npm run build:js-libopenmpt)`);
  if (!manifestBuf) errors.push(`missing manifest ${JS_ENGINE_MANIFEST_REL}`);
  if (!glueBuf || !wasmBuf || !manifestBuf) return { errors, manifest: null, wasm: null };

  let manifest;
  try {
    manifest = JSON.parse(manifestBuf.toString('utf8'));
  } catch (e) {
    errors.push(`manifest is not valid JSON: ${e instanceof Error ? e.message : e}`);
    return { errors, manifest: null, wasm: null };
  }

  if (manifest.schema !== JS_ENGINE_MANIFEST_SCHEMA) {
    errors.push(`manifest schema ${manifest.schema} != ${JS_ENGINE_MANIFEST_SCHEMA}`);
  }

  if (wasmBuf.length < MIN_WASM_BYTES) {
    errors.push(`${JS_ENGINE_WASM} is only ${wasmBuf.length} bytes (expected >= ${MIN_WASM_BYTES})`);
  }
  const wasm = inspectWasm(wasmBuf);
  if (!wasm.ok) {
    errors.push(`${JS_ENGINE_WASM} is not a valid WebAssembly module: ${wasm.error}`);
  }

  const glue = inspectGlue(glueBuf.toString('utf8'));
  {
    const have = new Set(glue.cExports);
    const missing = REQUIRED_C_EXPORTS.filter((n) => !have.has(n));
    if (missing.length) errors.push(`glue does not export required functions: ${missing.join(', ')}`);
    if (manifest.exceptions === 'wasm' && glue.usesJsExceptionTrampolines) {
      errors.push('manifest says native wasm exceptions but the glue defines JS invoke_* trampolines');
    }
  }
  if (glue.isWasm2js) errors.push(`${JS_ENGINE_GLUE} is a wasm2js build (isWasm2js) — the JS engine must be real WebAssembly`);
  if (glue.replacesGlobalWebAssembly) errors.push(`${JS_ENGINE_GLUE} replaces global WebAssembly (var WebAssembly=…)`);
  if (glue.hasEsmExport) errors.push(`${JS_ENGINE_GLUE} contains ESM export statements; it is evaluated as a classic script`);
  if (!glue.referencesWasmFile) errors.push(`${JS_ENGINE_GLUE} does not reference ${JS_ENGINE_WASM} (locateFile mapping would break)`);

  if (manifest.glue?.integrity !== sha384Sri(glueBuf) || manifest.glue?.bytes !== glueBuf.length) {
    errors.push(`manifest is stale for ${JS_ENGINE_GLUE} (rebuild, or re-run node scripts/verify-js-libopenmpt.mjs --write ...)`);
  }
  if (manifest.wasm?.integrity !== sha384Sri(wasmBuf) || manifest.wasm?.bytes !== wasmBuf.length) {
    errors.push(`manifest is stale for ${JS_ENGINE_WASM}`);
  }
  if (manifest.version !== cacheKey(glueBuf, wasmBuf)) {
    errors.push('manifest cache key does not match the artifacts');
  }

  return { errors, manifest, wasm };
}

/**
 * Behavioural checks: evaluates the glue exactly the way the AudioWorklet processor does
 * (new Function + seeded globalThis.libopenmpt.wasmBinary) and drives the C API.
 *
 * @param {{ root?: string, moduleBytes?: Uint8Array }} [opts]
 */
export async function smokeArtifacts({ root = REPO_ROOT, moduleBytes } = {}) {
  const errors = [];
  const p = resolveArtifactPaths(root);
  const glueText = readFileSync(p.glue, 'utf8');
  const wasmBuf = readFileSync(p.wasm);
  const modBytes = moduleBytes ?? new Uint8Array(readFileSync(join(root, 'public', '4-mat_madness.mod')));

  const previous = globalThis.libopenmpt;
  const wasmGlobalBefore = globalThis.WebAssembly;
  const t0 = performance.now();
  globalThis.libopenmpt = { noInitialRun: true, wasmBinary: wasmBuf };
  try {
    new Function(glueText.replace(/^\s*export\s+(default\s+)?/gm, '')).call(globalThis);
    const lib = globalThis.libopenmpt;
    await new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error('runtime init timeout (30s)')), 30000);
      const done = () => { clearTimeout(timer); res(undefined); };
      if (lib.calledRun) done();
      else lib.onRuntimeInitialized = done;
    });
    const initMs = performance.now() - t0;

    // The whole point of moving off wasm2js: evaluating the glue must not replace the real API.
    if (globalThis.WebAssembly !== wasmGlobalBefore) {
      errors.push('evaluating the glue replaced globalThis.WebAssembly');
      globalThis.WebAssembly = wasmGlobalBefore;
    }

    for (const name of REQUIRED_C_EXPORTS) {
      if (typeof lib[name] !== 'function') errors.push(`Module.${name} is not a function at runtime`);
    }
    for (const m of REQUIRED_RUNTIME_MEMBERS) {
      if (lib[m] === undefined) errors.push(`runtime member Module.${m} is not exported`);
    }
    for (const m of FORBIDDEN_RUNTIME_MEMBERS) {
      if (lib[m] !== undefined) errors.push(`Module.${m} must not be exported (signature clash with the app polyfill)`);
    }

    const cstr = (s) => {
      const b = new TextEncoder().encode(`${s}\0`);
      const ptr = lib._malloc(b.length);
      lib.HEAPU8.set(b, ptr);
      return ptr;
    };
    const create = (bytes) => {
      const fp = lib._malloc(bytes.length);
      lib.HEAPU8.set(bytes, fp);
      const mod = lib._openmpt_module_create_from_memory2(fp, bytes.length, 0, 0, 0, 0, 0, 0, 0);
      lib._free(fp);
      return mod;
    };

    // 1. A real module renders audible, finite audio.
    const mod = create(modBytes);
    let peak = 0;
    let finite = true;
    if (!mod) {
      errors.push('create_from_memory2 returned 0 for a valid module');
    } else {
      lib._openmpt_module_set_render_param(mod, 3, 8);
      const l = lib._malloc(4 * 128);
      const r = lib._malloc(4 * 128);
      for (let q = 0; q < 400; q++) {
        const n = lib._openmpt_module_read_float_stereo(mod, 48000, 128, l, r);
        if (n === 0) break;
        const a = new Float32Array(lib.HEAPF32.buffer, l, n);
        for (let i = 0; i < n; i++) {
          if (!Number.isFinite(a[i])) finite = false;
          peak = Math.max(peak, Math.abs(a[i]));
        }
      }
      lib._free(l); lib._free(r);
      if (!(peak > 0.01)) errors.push(`rendered audio is silent (peak ${peak})`);
      if (!finite) errors.push('rendered audio contains NaN/Inf');

      const titlePtr = lib._openmpt_module_get_metadata(mod, cstr('title'));
      const title = lib.UTF8ToString(titlePtr);
      lib._openmpt_free_string(titlePtr);
      if (typeof title !== 'string') errors.push('UTF8ToString(metadata title) did not return a string');
      lib._openmpt_module_destroy(mod);
    }

    // 2. Corrupt input must be REPORTED (NULL), not abort the runtime — catching is what makes
    //    a bad upload survivable inside the shared AudioWorkletGlobalScope.
    let garbageResult = 'unset';
    try {
      const junk = new Uint8Array(4096);
      for (let i = 0; i < junk.length; i++) junk[i] = (i * 2654435761) >>> 24;
      garbageResult = create(junk);
    } catch (e) {
      errors.push(`corrupt input threw out of the wasm module (${e instanceof Error ? e.message : e}); C++ exceptions are not caught`);
    }
    if (garbageResult !== 0 && garbageResult !== 'unset') errors.push('corrupt input unexpectedly produced a module');
    const again = create(modBytes);
    if (!again) errors.push('module creation failed after a corrupt-input attempt (runtime is dead)');
    else lib._openmpt_module_destroy(again);

    // 3. Heap growth must refresh the exported views (the processor re-derives its Float32Array
    //    views whenever HEAPF32.buffer changes).
    const before = lib.HEAPU8.buffer;
    const bigPtr = lib._malloc(96 * 1024 * 1024);
    if (!bigPtr) errors.push('_malloc(96 MiB) failed — heap growth is not working');
    else {
      if (lib.HEAPU8.buffer === before) errors.push('HEAPU8 was not refreshed after memory growth');
      if (lib.HEAPF32.buffer !== lib.HEAPU8.buffer) errors.push('HEAPF32/HEAPU8 disagree after memory growth');
      lib._free(bigPtr);
    }

    return { errors, initMs, peak, heapMiB: lib.HEAPU8.length / 1048576 };
  } finally {
    if (previous === undefined) delete globalThis.libopenmpt;
    else globalThis.libopenmpt = previous;
  }
}
