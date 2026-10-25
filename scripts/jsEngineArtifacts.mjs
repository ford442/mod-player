/**
 * Inspect / verify the real-WASM libopenmpt pairs used by the default JS engine:
 *
 *   shared — main thread, parser worker (and the worklet on a non-isolated page):
 *     public/worklets/libopenmpt-worklet.{js,wasm}
 *     audio-worklet/js/libopenmpt-worklet.generated.json
 *   playback — the AudioWorklet's shared-memory heap + its create worker (#513):
 *     public/worklets/libopenmpt-playback.{js,wasm}
 *     audio-worklet/js/libopenmpt-playback.generated.json
 *
 * Each manifest records SRI, sizes and a cache key. The shared wasm must import a NON-shared
 * memory (it is what index.html injects; it must never become threaded) and the playback wasm a
 * shared one — read from the binary's import section, not trusted from flags.
 *
 * Built by scripts/build-js-libopenmpt.sh; CLI wrapper is scripts/verify-js-libopenmpt.mjs.
 * Everything here is pure Node (no emsdk needed) so CI and vitest can run it.
 */
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { synthIt } from './lib/synth-it.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..');

export const JS_ENGINE_GLUE = 'libopenmpt-worklet.js';
export const JS_ENGINE_WASM = 'libopenmpt-worklet.wasm';
export const JS_ENGINE_MANIFEST_REL = 'audio-worklet/js/libopenmpt-worklet.generated.json';
export const JS_ENGINE_MANIFEST_SCHEMA = 1;

/** The two artifact pairs (see the header). `sharedMemory` is what the wasm's memory import must be. */
export const JS_ENGINE_ARTIFACTS = Object.freeze({
  shared: Object.freeze({
    glue: JS_ENGINE_GLUE,
    wasm: JS_ENGINE_WASM,
    manifestRel: JS_ENGINE_MANIFEST_REL,
    sharedMemory: false,
    buildFlag: '',
  }),
  playback: Object.freeze({
    glue: 'libopenmpt-playback.js',
    wasm: 'libopenmpt-playback.wasm',
    manifestRel: 'audio-worklet/js/libopenmpt-playback.generated.json',
    sharedMemory: true,
    buildFlag: ' -- --playback',
  }),
});

function artifactSpec(artifact) {
  const spec = JS_ENGINE_ARTIFACTS[artifact];
  if (!spec) throw new Error(`unknown JS-engine artifact ${artifact} (shared | playback)`);
  return spec;
}

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

/** Extra C exports the playback heap needs: the create worker initialises its stack + TLS with it. */
export const PLAYBACK_C_EXPORTS = Object.freeze(['_emscripten_wasm_worker_initialize']);

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

function readLeb(buf, pos) {
  let result = 0;
  let shift = 0;
  for (;;) {
    const b = buf[pos++];
    result += (b & 0x7f) * 2 ** shift;
    shift += 7;
    if (!(b & 0x80)) return [result, pos];
  }
}

/**
 * Limits of the module's memory (imported or defined) straight from the binary — the JS API
 * does not expose whether a memory is shared. Returns null when the module has no memory.
 * @returns {{ imported: boolean, shared: boolean, minPages: number, maxPages: number | null } | null}
 */
export function wasmMemoryLimits(bytes) {
  const buf = Buffer.from(bytes);
  const limits = (p, imported) => {
    const flags = buf[p++];
    let minPages;
    let maxPages = null;
    [minPages, p] = readLeb(buf, p);
    if (flags & 0x01) [maxPages, p] = readLeb(buf, p);
    return { imported, shared: (flags & 0x02) !== 0, minPages, maxPages };
  };
  let pos = 8;
  while (pos < buf.length) {
    const id = buf[pos++];
    let size;
    [size, pos] = readLeb(buf, pos);
    const end = pos + size;
    if (id === 2) {
      let count;
      let p = pos;
      [count, p] = readLeb(buf, p);
      for (let i = 0; i < count; i++) {
        for (let k = 0; k < 2; k++) { // module name, field name
          let len;
          [len, p] = readLeb(buf, p);
          p += len;
        }
        const kind = buf[p++];
        if (kind === 0x02) return limits(p, true);
        if (kind === 0x00) [, p] = readLeb(buf, p); // func: type index
        else if (kind === 0x01) { p++; const f = buf[p++]; [, p] = readLeb(buf, p); if (f & 1) [, p] = readLeb(buf, p); } // table
        else if (kind === 0x03) p += 2; // global: valtype + mut
        else if (kind === 0x04) { p++; [, p] = readLeb(buf, p); } // tag: attribute + type index
        else return null;
      }
    } else if (id === 5) {
      let count;
      let p = pos;
      [count, p] = readLeb(buf, p);
      if (count > 0) return limits(p, false);
    }
    pos = end;
  }
  return null;
}

/** @returns {{ok: boolean, exports: string[], imports: {module: string, name: string, kind: string}[], memory: ReturnType<typeof wasmMemoryLimits>, error?: string}} */
export function inspectWasm(bytes) {
  const buf = Buffer.from(bytes);
  if (buf.length < 4 || !buf.subarray(0, 4).equals(WASM_MAGIC)) {
    return { ok: false, exports: [], imports: [], memory: null, error: 'missing \\0asm magic' };
  }
  try {
    const mod = new WebAssembly.Module(buf);
    return {
      ok: true,
      exports: WebAssembly.Module.exports(mod).map((e) => e.name),
      imports: WebAssembly.Module.imports(mod),
      memory: wasmMemoryLimits(buf),
    };
  } catch (e) {
    return { ok: false, exports: [], imports: [], memory: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Release wasm minifies its own export/import names, so the readable C export list and any JS
 * exception trampolines have to be read from the glue: every export is mapped as
 * `Module["_name"] = wasmExports[...]` and JS-based EH defines `function invoke_<sig>(...)`.
 */
export function inspectGlue(text, wasmFile = JS_ENGINE_WASM) {
  const cExports = new Set();
  for (const m of text.matchAll(/Module\["(_[A-Za-z0-9_]+)"\]\s*=/g)) cExports.add(m[1]);
  return {
    isWasm2js: /isWasm2js\s*:\s*(!0|true)/.test(text),
    hasEsmExport: /^\s*export\s/m.test(text),
    replacesGlobalWebAssembly: /\bvar\s+WebAssembly\s*=/.test(text),
    referencesWasmFile: text.includes(wasmFile),
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

export function resolveArtifactPaths(root = REPO_ROOT, artifact = 'shared') {
  const spec = artifactSpec(artifact);
  const dir = join(root, 'public', 'worklets');
  return {
    dir,
    glue: join(dir, spec.glue),
    wasm: join(dir, spec.wasm),
    manifest: join(root, spec.manifestRel),
  };
}

/** Build (and optionally write) the manifest for the artifacts currently on disk. */
export function buildManifest({ root = REPO_ROOT, artifact = 'shared', emcc, eh, simd, libopenmpt, variant, write = false }) {
  const spec = artifactSpec(artifact);
  const p = resolveArtifactPaths(root, artifact);
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
    sharedMemory: info.memory?.shared === true,
    glue: { file: spec.glue, bytes: glueBuf.length, integrity: sha384Sri(glueBuf) },
    wasm: { file: spec.wasm, bytes: wasmBuf.length, integrity: sha384Sri(wasmBuf) },
    cExportCount: inspectGlue(glueBuf.toString('utf8'), spec.wasm).cExports.filter((n) => n.startsWith('_openmpt_')).length,
  };
  if (write) writeFileSync(p.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/**
 * Static checks (no instantiate): files exist, real wasm, glue is not wasm2js, manifest agrees
 * with the bytes on disk, required exports present, no JS-EH trampolines when the manifest says
 * wasm exceptions.
 */
export function checkArtifacts({ root = REPO_ROOT, artifact = 'shared' } = {}) {
  const errors = [];
  const spec = artifactSpec(artifact);
  const GLUE = spec.glue;
  const WASM = spec.wasm;
  const p = resolveArtifactPaths(root, artifact);
  const glueBuf = readOrNull(p.glue);
  const wasmBuf = readOrNull(p.wasm);
  const manifestBuf = readOrNull(p.manifest);

  if (!glueBuf) errors.push(`missing ${GLUE} (run: npm run build:js-libopenmpt${spec.buildFlag})`);
  if (!wasmBuf) errors.push(`missing ${WASM} (run: npm run build:js-libopenmpt${spec.buildFlag})`);
  if (!manifestBuf) errors.push(`missing manifest ${spec.manifestRel}`);
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
    errors.push(`${WASM} is only ${wasmBuf.length} bytes (expected >= ${MIN_WASM_BYTES})`);
  }
  const wasm = inspectWasm(wasmBuf);
  if (!wasm.ok) {
    errors.push(`${WASM} is not a valid WebAssembly module: ${wasm.error}`);
  }

  if (wasm.ok) {
    if (!wasm.memory) {
      errors.push(`${WASM} declares no memory`);
    } else if (wasm.memory.shared !== spec.sharedMemory) {
      errors.push(spec.sharedMemory
        ? `${WASM} memory is not shared — the create worker cannot join this heap (build with --playback)`
        : `${WASM} memory is SHARED — the main-thread / parser-worker artifact must stay non-threaded (no -pthread / -sWASM_WORKERS)`);
    }
  }
  if (manifest.sharedMemory !== undefined && manifest.sharedMemory !== spec.sharedMemory) {
    errors.push(`manifest says sharedMemory=${manifest.sharedMemory}, expected ${spec.sharedMemory}`);
  }

  const glue = inspectGlue(glueBuf.toString('utf8'), WASM);
  {
    const have = new Set(glue.cExports);
    const required = spec.sharedMemory ? [...REQUIRED_C_EXPORTS, ...PLAYBACK_C_EXPORTS] : REQUIRED_C_EXPORTS;
    const missing = required.filter((n) => !have.has(n));
    if (missing.length) errors.push(`glue does not export required functions: ${missing.join(', ')}`);
    if (manifest.exceptions === 'wasm' && glue.usesJsExceptionTrampolines) {
      errors.push('manifest says native wasm exceptions but the glue defines JS invoke_* trampolines');
    }
  }
  if (glue.isWasm2js) errors.push(`${GLUE} is a wasm2js build (isWasm2js) — the JS engine must be real WebAssembly`);
  if (glue.replacesGlobalWebAssembly) errors.push(`${GLUE} replaces global WebAssembly (var WebAssembly=…)`);
  if (glue.hasEsmExport) errors.push(`${GLUE} contains ESM export statements; it is evaluated as a classic script`);
  if (!glue.referencesWasmFile) errors.push(`${GLUE} does not reference ${WASM} (locateFile mapping would break)`);

  if (manifest.glue?.integrity !== sha384Sri(glueBuf) || manifest.glue?.bytes !== glueBuf.length) {
    errors.push(`manifest is stale for ${GLUE} (rebuild, or re-run node scripts/verify-js-libopenmpt.mjs --write ...)`);
  }
  if (manifest.wasm?.integrity !== sha384Sri(wasmBuf) || manifest.wasm?.bytes !== wasmBuf.length) {
    errors.push(`manifest is stale for ${WASM}`);
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
    /** @type {number | 'unset'} */
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

/**
 * The create-worker side of the code below, run in a worker_threads Worker: boot the playback
 * glue as a wasm worker on the given heap (what workers/openmpt-create.worker.ts does in the
 * browser), then create/destroy on request.
 */
const PLAYBACK_SIDE_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const { glue, wasmModule, memory, sb, sz } = workerData;
// The ww glue listens for Emscripten's own postMessage calls; nothing sends those here.
globalThis.addEventListener ??= () => {};
globalThis.removeEventListener ??= () => {};
globalThis.libopenmpt = { $ww: 1, wasmMemory: memory, sb, sz,
  instantiateWasm(info, receive) { return receive(new WebAssembly.Instance(wasmModule, info), wasmModule); } };
new Function(glue).call(globalThis);
const lib = globalThis.libopenmpt;
parentPort.postMessage({ type: 'ready', ok: typeof lib._openmpt_module_create_from_memory2 === 'function' });
parentPort.on('message', (m) => {
  if (m.type === 'create') {
    const fp = lib._malloc(m.bytes.byteLength);
    new Uint8Array(memory.buffer, fp, m.bytes.byteLength).set(new Uint8Array(m.bytes));
    let ptr = 0; let threw = null;
    try { ptr = lib._openmpt_module_create_from_memory2(fp, m.bytes.byteLength, 0, 0, 0, 0, 0, 0, 0); }
    catch (e) { threw = String(e); }
    lib._free(fp);
    parentPort.postMessage({ type: 'created', ptr, threw, heapBytes: memory.buffer.byteLength });
  } else if (m.type === 'destroy') {
    lib._openmpt_module_destroy(m.ptr);
    parentPort.postMessage({ type: 'destroyed' });
  }
});
`;

/**
 * Behavioural checks for the playback heap (#513), with real threads: this thread boots the glue
 * the way the AudioWorklet does (heap main thread), a worker_threads Worker joins the same shared
 * memory as a wasm worker, creates a large module there while this thread keeps rendering, and
 * this thread then renders the module the worker created. Also: a corrupt file is NULL on the
 * worker (its C++ exception is caught on that thread), and the worker's heap growth is visible here.
 *
 * @param {{ root?: string, largeModuleBytes?: Uint8Array }} [opts]
 */
export async function smokePlaybackArtifacts({ root = REPO_ROOT, largeModuleBytes } = {}) {
  const errors = [];
  const p = resolveArtifactPaths(root, 'playback');
  const glueText = readFileSync(p.glue, 'utf8');
  const wasmBuf = readFileSync(p.wasm);
  const small = new Uint8Array(readFileSync(join(root, 'public', '4-mat_madness.mod')));
  const large = largeModuleBytes ?? synthIt(64, { sampleFrames: 2 << 20 });

  const previous = globalThis.libopenmpt;
  globalThis.libopenmpt = { noInitialRun: true, wasmBinary: wasmBuf };
  let worker = null;
  try {
    new Function(glueText.replace(/^\s*export\s+(default\s+)?/gm, '')).call(globalThis);
    const lib = globalThis.libopenmpt;
    await new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error('runtime init timeout (30s)')), 30000);
      const done = () => { clearTimeout(timer); res(undefined); };
      if (lib.calledRun) done();
      else lib.onRuntimeInitialized = done;
    });
    const memory = lib.wasmMemory;
    if (!memory || !(memory.buffer instanceof SharedArrayBuffer)) {
      errors.push('Module.wasmMemory is missing or not shared');
      return { errors, createMs: 0, quantaDuringCreate: 0, heapMiB: 0 };
    }
    for (const name of [...REQUIRED_C_EXPORTS, ...PLAYBACK_C_EXPORTS]) {
      if (typeof lib[name] !== 'function') errors.push(`Module.${name} is not a function at runtime`);
    }
    for (const m of FORBIDDEN_RUNTIME_MEMBERS) {
      if (lib[m] !== undefined) errors.push(`Module.${m} must not be exported (signature clash with the app polyfill)`);
    }

    const STACK = 1 << 20;
    const raw = lib._malloc(STACK + 16);
    const sb = Math.ceil(raw / 16) * 16;
    const wasmModule = new WebAssembly.Module(wasmBuf);
    worker = new Worker(PLAYBACK_SIDE_SOURCE, {
      eval: true,
      workerData: { glue: glueText, wasmModule, memory, sb, sz: STACK },
    });
    const inbox = [];
    let wake = null;
    worker.on('message', (m) => { inbox.push(m); wake?.(); });
    worker.on('error', (e) => { inbox.push({ type: 'error', message: String(e) }); wake?.(); });
    const next = async () => {
      while (inbox.length === 0) await new Promise((r) => { wake = r; });
      return inbox.shift();
    };
    const ready = await next();
    if (!ready.ok) {
      errors.push(`create worker did not boot as a wasm worker: ${JSON.stringify(ready)}`);
      return { errors, createMs: 0, quantaDuringCreate: 0, heapMiB: 0 };
    }

    // Module A plays on this thread.
    const fp = lib._malloc(small.length);
    lib.HEAPU8.set(small, fp);
    const modA = lib._openmpt_module_create_from_memory2(fp, small.length, 0, 0, 0, 0, 0, 0, 0);
    lib._free(fp);
    const l = lib._malloc(4 * 128);
    const r = lib._malloc(4 * 128);
    if (!modA) errors.push('create_from_memory2 returned 0 for a valid module on the heap main thread');

    const heapBefore = memory.buffer.byteLength;
    const t0 = performance.now();
    const copy = large.slice().buffer;
    worker.postMessage({ type: 'create', bytes: copy }, [copy]);
    let quanta = 0;
    while (inbox.length === 0) {
      if (modA) lib._openmpt_module_read_float_stereo(modA, 48000, 128, l, r);
      quanta++;
      await new Promise((res) => setImmediate(res));
    }
    const created = await next();
    const createMs = performance.now() - t0;
    if (created.threw) errors.push(`create threw out of wasm on the create worker: ${created.threw}`);
    if (!created.ptr) errors.push('create worker returned 0 for a valid large module');
    if (quanta < 2) errors.push(`the heap main thread rendered only ${quanta} quanta during the create — was it blocked?`);
    if (created.heapBytes <= heapBefore) errors.push('the large create did not grow the heap (test module too small?)');
    if (memory.buffer.byteLength !== created.heapBytes) errors.push('heap growth on the create worker is not visible to the heap main thread');

    if (created.ptr) {
      if (lib._openmpt_module_get_num_channels(created.ptr) !== 64) errors.push('module created on the worker is not the 64-channel IT');
      let peak = 0;
      for (let q = 0; q < 50; q++) {
        const n = lib._openmpt_module_read_float_stereo(created.ptr, 48000, 128, l, r);
        const a = new Float32Array(memory.buffer, l, n);
        for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(a[i]));
      }
      if (!(peak > 0.01)) errors.push(`module created on the worker renders silence here (peak ${peak})`);
      worker.postMessage({ type: 'destroy', ptr: created.ptr });
      await next();
    }

    const junk = new Uint8Array(4096);
    for (let i = 0; i < junk.length; i++) junk[i] = (i * 2654435761) >>> 24;
    worker.postMessage({ type: 'create', bytes: junk.buffer }, [junk.buffer]);
    const bad = await next();
    if (bad.threw) errors.push(`corrupt input threw out of wasm on the create worker (${bad.threw}); C++ exceptions are not caught there`);
    if (bad.ptr) errors.push('corrupt input unexpectedly produced a module');

    if (modA) lib._openmpt_module_destroy(modA);
    return { errors, createMs, quantaDuringCreate: quanta, heapMiB: memory.buffer.byteLength / 1048576 };
  } finally {
    await worker?.terminate();
    if (previous === undefined) delete globalThis.libopenmpt;
    else globalThis.libopenmpt = previous;
  }
}
