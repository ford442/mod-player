#!/usr/bin/env node
/**
 * Verify native WASM EXPORTED_FUNCTIONS stay in sync with C++ KEEPALIVE
 * symbols and TypeScript OpenMPTWorkletEngine usage.
 *
 * Usage: node scripts/verify-native-exports.mjs
 * Exit 0 if consistent; 1 on missing/extra critical symbols.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const BUILD_SH = join(ROOT, 'scripts/build-wasm.sh');
const CPP = join(ROOT, 'cpp/worklet_processor.cpp');
const ENGINE_CPP = join(ROOT, 'cpp/native_engine.cpp');
const ENGINE_H = join(ROOT, 'cpp/native_engine.h');
const ENGINE = join(ROOT, 'audio-worklet/OpenMPTWorkletEngine.ts');
const TYPES = join(ROOT, 'audio-worklet/types.ts');

const errors = [];
const warnings = [];

function mustExist(path) {
  if (!existsSync(path)) {
    errors.push(`missing file: ${path}`);
    return false;
  }
  return true;
}

if (![BUILD_SH, CPP, ENGINE_CPP, ENGINE_H, ENGINE, TYPES].every(mustExist)) {
  console.error('verify-native-exports FAILED:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

const buildSh = readFileSync(BUILD_SH, 'utf8');
const cpp = readFileSync(CPP, 'utf8');
const engineCpp = readFileSync(ENGINE_CPP, 'utf8');
const engineH = readFileSync(ENGINE_H, 'utf8');
const engine = readFileSync(ENGINE, 'utf8');
const types = readFileSync(TYPES, 'utf8');

// Parse EXPORTED_FUNCTIONS from build script (list of '_name')
const exportMatch = buildSh.match(/EXPORTED_FUNCTIONS=\$\(cat <<'EOF'\s*([\s\S]*?)EOF\s*\)/);
let exported = new Set();
if (exportMatch) {
  for (const m of exportMatch[1].matchAll(/'_([a-z0-9_]+)'/gi)) {
    exported.add(m[1]);
  }
} else {
  // Fallback: flat -sEXPORTED_FUNCTIONS="[...]"
  const flat = buildSh.match(/EXPORTED_FUNCTIONS="\[([^\]]+)\]"/);
  if (flat) {
    for (const m of flat[1].matchAll(/_([a-z0-9_]+)/gi)) {
      exported.add(m[1]);
    }
  } else {
    errors.push('could not parse EXPORTED_FUNCTIONS from scripts/build-wasm.sh');
  }
}

// C++ EMSCRIPTEN_KEEPALIVE function names (next non-empty line after macro)
const keepalive = new Set();
const lines = cpp.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (/EMSCRIPTEN_KEEPALIVE/.test(lines[i] ?? '')) {
    for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
      const lm = (lines[j] ?? '').match(
        /^(?:static\s+)?(?:inline\s+)?(?:[\w:<*&]+\s+)+(\w+)\s*\(/,
      );
      if (lm) {
        keepalive.add(lm[1]);
        break;
      }
    }
  }
}

// TS: this.module._foo or module._foo or m._foo
const tsUsed = new Set();
const tsOptional = new Set();
for (const m of engine.matchAll(/\._([a-z0-9_]+)\b/gi)) {
  tsUsed.add(m[1]);
}
for (const m of types.matchAll(/_([a-z0-9_]+)\??\s*[:(]/g)) {
  // types interface members
  if (m[0].includes('?:')) tsOptional.add(m[1]);
  else tsUsed.add(m[1]);
}
// Also pick optional from types more carefully
for (const m of types.matchAll(/^\s*_([a-z0-9_]+)\??\s*:/gim)) {
  const name = m[1];
  const line = m[0];
  if (line.includes('?:')) tsOptional.add(name);
  else tsUsed.add(name);
}

// Always required from engine (hard calls without optional chaining type guard)
const requiredByEngine = [
  'load_module',
  'resume_audio',
  'suspend_audio',
  'seek_order_row',
  'set_volume',
  'set_channel_mute',
  'set_render_param',
  'ctl_set_text',
  'set_loop',
  'poll_position',
  'get_audio_context',
  'get_worklet_node',
  'cleanup_audio',
  'malloc',
  'free',
  'get_pattern_num_rows',
  'get_pattern_row_channel_command',
];

// Optional but should be exported if present in C++
const optionalButExport = [
  // Headless harness only — production attaches via init_audio_with_context.
  // Still exported so a bench can render without a JS-side audio graph.
  'init_audio',
  'commit_module',
  'get_last_error',
  'clear_last_error',
  'set_ring_buffer',
  'get_ring_write_head',
  'init_audio_with_context',
  'get_position_seq',
  'get_num_channels',
  'get_num_orders',
  'get_num_patterns',
  'get_duration_seconds',
  'get_initial_bpm',
  'get_order_pattern',
  'get_pattern_cells',
];

for (const name of requiredByEngine) {
  if (!exported.has(name)) {
    errors.push(`EXPORTED_FUNCTIONS missing required symbol _${name} (used by OpenMPTWorkletEngine)`);
  }
  if (!keepalive.has(name) && name !== 'malloc' && name !== 'free') {
    // malloc/free come from emscripten runtime, not KEEPALIVE
    errors.push(`C++ KEEPALIVE missing ${name} (required by engine)`);
  }
}

for (const name of optionalButExport) {
  if (keepalive.has(name) && !exported.has(name)) {
    errors.push(
      `C++ has KEEPALIVE ${name} but EXPORTED_FUNCTIONS omits _${name} (TS expects it optionally)`,
    );
  }
}

// Exported but not in C++ (except malloc/free)
for (const name of exported) {
  if (name === 'malloc' || name === 'free') continue;
  if (!keepalive.has(name)) {
    warnings.push(`exported _${name} has no EMSCRIPTEN_KEEPALIVE in worklet_processor.cpp`);
  }
}

// ── Thread model (#491) ──────────────────────────────────────────────
// One parse per file, on the main thread; ownership of a module moves between
// threads only by atomic exchange; the audio thread never parses, frees,
// allocates or logs; pattern queries never touch the module being rendered.
// cpp/host/ proves it under TSan/ASan at runtime — these are the source guards.

/** Body of `name(` up to the matching closing brace (brace-counted). */
function functionBody(src, signature) {
  const at = src.indexOf(signature);
  if (at < 0) return null;
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1);
  }
  return null;
}

for (const legacy of ['g_metaModule', 'g_moduleData', 'g_cmdLoad', 'patternQueryModule', 'metaOnlyModule']) {
  if (cpp.includes(legacy) || engineCpp.includes(legacy)) {
    errors.push(`cpp/: ${legacy} is the pre-#491 double-parse / shared-buffer design — it must not come back`);
  }
}
{
  const processBody = functionBody(engineCpp, 'void NativeEngine::process(');
  if (!processBody) {
    errors.push('cpp/native_engine.cpp: NativeEngine::process() not found');
  } else {
    /** @type {Array<[RegExp, string]>} */
    const forbidden = [
      [/\bmalloc\(|\bcalloc\(|\brealloc\(|\bfree\(/, 'malloc/free'],
      [/\bnew\b|\bdelete\b/, 'new/delete'],
      [/module\.load\(|\.unload\(|loadModule|destroyModule|snapshot_/, 'a parse / destroy / snapshot access'],
      [/printf\(|std::cout|std::cerr/, 'logging'],
    ];
    for (const [pattern, why] of forbidden) {
      if (pattern.test(processBody)) errors.push(`NativeEngine::process() (audio thread) must not contain ${why}`);
    }
    if (!/handoff_\.exchange\(nullptr/.test(processBody)) {
      errors.push('NativeEngine::process() must take the published module with handoff_.exchange(nullptr, …)');
    }
    if (!/graveyard_\.store\(/.test(processBody)) {
      errors.push('NativeEngine::process() must retire the replaced module into graveyard_ (freed on the main thread)');
    }
    if (!/ring_\.drain\(/.test(processBody)) {
      errors.push('NativeEngine::process() must drain the command ring (seek / mute / render params / ctls)');
    }
  }
  const commitBody = functionBody(engineCpp, 'int NativeEngine::commitModule(');
  if (!commitBody || !/handoff_\.exchange\(staged_/.test(commitBody)) {
    errors.push('NativeEngine::commitModule() must publish with handoff_.exchange(staged_, …) and free what it gets back');
  }
  const drainBody = functionBody(engineCpp, 'void NativeEngine::drainGraveyard(');
  if (!drainBody || !/graveyard_\.exchange\(nullptr/.test(drainBody)) {
    errors.push('NativeEngine::drainGraveyard() must take retired modules with graveyard_.exchange(nullptr, …)');
  }
  const teardownBody = functionBody(engineCpp, 'bool NativeEngine::teardown(');
  if (!teardownBody || !/teardownAck_/.test(teardownBody)) {
    errors.push('NativeEngine::teardown() must wait for the audio thread\'s teardownAck_ before freeing its module');
  }
  const cleanupBody = functionBody(cpp, 'void cleanup_audio(');
  if (!cleanupBody || !/g_engine\.teardown\(/.test(cleanupBody) || /\.unload\(/.test(cleanupBody)) {
    errors.push('cleanup_audio() must go through g_engine.teardown() and never unload a module itself');
  }
  if (!/SpscRing<Command, kCommandRingCapacity> ring_/.test(engineH)) {
    errors.push('cpp/native_engine.h: controls must travel through the SPSC command ring (ring_)');
  }
  // Pattern / metadata queries read the load-time snapshot, never a live module.
  for (const fn of [
    'int get_num_channels(', 'int get_num_orders(', 'int get_num_patterns(', 'double get_duration_seconds(',
    'double get_initial_bpm(', 'int get_order_pattern(', 'int get_pattern_num_rows(',
    'int get_pattern_row_channel_command(', 'get_pattern_cells(int pattern)',
  ]) {
    const body = functionBody(cpp, fn);
    if (!body) errors.push(`cpp/worklet_processor.cpp missing ${fn}…)`);
    else if (!/g_engine\.snapshot\(\)/.test(body)) errors.push(`${fn}…) must answer from g_engine.snapshot()`);
  }
  // Every control export is a thin forward to the engine (which uses the ring).
  for (const [fn, call] of [
    ['void set_channel_mute(', 'g_engine.setChannelMute('],
    ['void set_render_param(', 'g_engine.setRenderParam('],
    ['void ctl_set_text(', 'g_engine.ctlSetText('],
    ['void seek_order_row(', 'g_engine.seek('],
  ]) {
    const body = functionBody(cpp, fn);
    if (!body) errors.push(`cpp/worklet_processor.cpp missing ${fn}…)`);
    else if (!body.includes(call)) errors.push(`${fn}…) must forward to ${call}…) (one ring command)`);
  }
}

// emsdk 3.1.51 + WASM_WORKERS leaves the main thread's TLS relocations unapplied, which breaks
// every typed catch on the main thread (wasm EH keeps its selector in thread-local
// __wasm_lpad_context). The glue repairs it before any constructor touches TLS (#491).
{
  const tlsPath = join(ROOT, 'cpp/wasm_workers_tls.cpp');
  const tls = existsSync(tlsPath) ? readFileSync(tlsPath, 'utf8') : '';
  const ctorAt = tls.indexOf('__attribute__((constructor(101))) static void apply_main_thread_tls_relocations(');
  const body = ctorAt >= 0 ? functionBody(tls, 'static void apply_main_thread_tls_relocations(') : null;
  if (!body || !/__wasm_init_tls\(base\)/.test(body) || !/__wasm_lpad_context/.test(body)) {
    errors.push('cpp/wasm_workers_tls.cpp must keep the constructor(101) that applies main-thread TLS relocations (__wasm_init_tls) when __wasm_lpad_context is unrelocated');
  }
  if (!/for src in [^;]*\bwasm_workers_tls\b[^;]*; do/.test(buildSh)) {
    errors.push('scripts/build-wasm.sh must compile cpp/wasm_workers_tls.cpp into the native engine');
  }
}

// load_module failure has to be pollable: fprintf is invisible to the UI.
for (const code of ['ERR_BAD_ARGS', 'ERR_OUT_OF_MEMORY', 'ERR_UNSUPPORTED_MODULE', 'ERR_TORN_DOWN']) {
  if (!engineCpp.includes(code)) {
    errors.push(`cpp/native_engine.cpp must report a typed ${code} via get_last_error()`);
  }
}
if (!/for src in [^;]*\bnative_engine\b[^;]*; do/.test(buildSh)) {
  errors.push('scripts/build-wasm.sh must compile cpp/native_engine.cpp');
}

// Sample-rate contract (#runtime-hardening): the engine's
// readInterleavedStereo() call renders for its render rate, which must
// track the real AudioContext rate — not a hardcoded 48000 — or a device
// whose context opened at something other than 48000 (utils/audioContextFactory.ts's
// own fallback path) gets ~9% pitch/tempo drift.
{
  const sigMatch = cpp.match(/int init_audio_with_context\(([^)]*)\)/);
  if (!sigMatch) {
    errors.push('cpp/worklet_processor.cpp: init_audio_with_context() signature not found');
  } else if (!/sampleRateHz/.test(sigMatch[1])) {
    errors.push(
      'init_audio_with_context() must take a sampleRateHz parameter and set g_renderSampleRate from it '
      + '(a hardcoded rate mismatches a device whose AudioContext opened at a different rate)',
    );
  } else {
    const body = functionBody(cpp, sigMatch[0]) ?? '';
    if (!/setRenderSampleRate\([^;]*sampleRateHz/.test(body)) {
      errors.push('init_audio_with_context() must set the engine render rate from sampleRateHz');
    }
  }
  if (!/_init_audio_with_context\?\s*:\s*\(ctxHandle:\s*number,\s*sampleRateHz:\s*number\)/.test(types)) {
    errors.push('audio-worklet/types.ts: _init_audio_with_context must be typed (ctxHandle, sampleRateHz)');
  }
  if (!/initWithCtx\(handle, .*ctx\.sampleRate/.test(engine)) {
    errors.push('OpenMPTWorkletEngine.ts must call initWithCtx(handle, …ctx.sampleRate…) — not an assumed constant');
  }
}

// Guard: build script must not target openmpt-worklet as output basename
if (/OUTPUT_BASENAME="openmpt-worklet"/.test(buildSh) || /-o\s+"?\$OUTPUT_DIR\/openmpt-worklet/.test(buildSh)) {
  errors.push('scripts/build-wasm.sh must not output openmpt-worklet.* (clobbers JS processor)');
}
if (!/OUTPUT_BASENAME="openmpt-native"/.test(buildSh)) {
  errors.push('scripts/build-wasm.sh should set OUTPUT_BASENAME="openmpt-native"');
}

if (!/-sSTACK_SIZE=131072/.test(buildSh)) {
  errors.push('scripts/build-wasm.sh must set -sSTACK_SIZE=131072 (main + meta parse stack)');
}
if (!/-fno-exceptions/.test(buildSh)) {
  errors.push('scripts/build-wasm.sh must compile wrapper with -fno-exceptions');
}
if (!/--post-js "\$CPP_DIR\/post\.js"/.test(buildSh) && !/--post-js \$CPP_DIR\/post\.js/.test(buildSh)) {
  errors.push('scripts/build-wasm.sh must --post-js cpp/post.js (Module audio-object exports)');
}
if (!/patch-native-glue\.mjs/.test(buildSh)) {
  errors.push('scripts/build-wasm.sh must run scripts/patch-native-glue.mjs on openmpt-native.js');
}

const preJs = join(ROOT, 'cpp/pre.js');
if (existsSync(preJs)) {
  const pre = readFileSync(preJs, 'utf8');
  if (!/typeof globalThis\.setTimeout !== 'function'/.test(pre) && !/typeof globalThis\.setTimeout !== "function"/.test(pre)) {
    errors.push('cpp/pre.js must only polyfill setTimeout when it is missing (do not clobber main-thread timers)');
  }
}
const postJs = join(ROOT, 'cpp/post.js');
if (!existsSync(postJs)) {
  errors.push('missing cpp/post.js (exports emscriptenRegisterAudioObject onto Module)');
} else {
  const post = readFileSync(postJs, 'utf8');
  if (!/emscriptenRegisterAudioObject/.test(post)) {
    errors.push('cpp/post.js must assign emscriptenRegisterAudioObject onto Module');
  }
}

const glue = join(ROOT, 'public/worklets/openmpt-native.js');
if (existsSync(glue)) {
  const glueSrc = readFileSync(glue, 'utf8');
  if (/globalThis\.setTimeout=function\(callback,delay\)\{Promise\.resolve\(\)\.then\(callback\)/.test(glueSrc)
      && !/typeof globalThis\.setTimeout!=="function"/.test(glueSrc)) {
    errors.push('public/worklets/openmpt-native.js still clobbers main-thread setTimeout — run scripts/patch-native-glue.mjs');
  }
  if (!/Module\["emscriptenRegisterAudioObject"\]/.test(glueSrc) && !/Module\['emscriptenRegisterAudioObject'\]/.test(glueSrc)) {
    errors.push('public/worklets/openmpt-native.js must export Module.emscriptenRegisterAudioObject');
  }
}
// Exception contract. -fno-exceptions/-fno-rtti must stay COMPILE-only: on the
// link line Emscripten infers DISABLE_EXCEPTION_THROWING=1 and then wasm-ld
// cannot resolve __cxa_throw from libopenmpt.a (native-full-build red, #412).
if (!/CXX_ONLY_FLAGS=\(-fno-exceptions -fno-rtti\)/.test(buildSh)) {
  errors.push(
    'scripts/build-wasm.sh must keep -fno-exceptions/-fno-rtti in CXX_ONLY_FLAGS (compile-only)',
  );
}
for (const mode of ['COMPILE_FLAGS', 'LINK_FLAGS']) {
  const block = buildSh.match(new RegExp(`${mode}=\\(([^)]*)\\)`, 'g')) ?? [];
  if (block.some((b) => /-fno-exceptions|-fno-rtti/.test(b))) {
    errors.push(
      `${mode} must not carry -fno-exceptions/-fno-rtti (it reaches the link and drops __cxa_throw)`,
    );
  }
}
// #491: libopenmpt is built AND linked with native wasm exceptions. Its C API and its
// loaders catch their own throws; a no-catch link (DISABLE_EXCEPTION_CATCHING=1, the
// pre-#491 contract) let a truncated IT sample block escape load_module() into JS — or,
// on the audio thread, kill the worklet. The flags come from the shared file.
{
  const flagsPath = join(ROOT, 'scripts/lib/wasm-flags.sh');
  const flagsSh = existsSync(flagsPath) ? readFileSync(flagsPath, 'utf8') : '';
  const code = stripShellComments(buildSh);
  if (!/source "\$SCRIPT_DIR\/lib\/wasm-flags\.sh"/.test(buildSh)) {
    errors.push('scripts/build-wasm.sh must source scripts/lib/wasm-flags.sh (one flag set for both WASM builds)');
  }
  if (!/^WASM_EH_FLAGS=\(-fwasm-exceptions\)/m.test(flagsSh)) {
    errors.push('scripts/lib/wasm-flags.sh must define WASM_EH_FLAGS=(-fwasm-exceptions)');
  }
  for (const v of ['LIBOPENMPT_RELEASE_CXXFLAGS', 'LIBOPENMPT_RELEASE_CFLAGS', 'LIBOPENMPT_DEBUG_CXXFLAGS', 'LIBOPENMPT_DEBUG_CFLAGS']) {
    const line = code.match(new RegExp(`^${v}="([^"]*)"`, 'm'))?.[1] ?? '';
    if (!line.includes('${WASM_EH_FLAGS[*]}') || !line.includes('${WASM_FEATURE_FLAGS[*]}')) {
      errors.push(`${v} must include \${WASM_EH_FLAGS[*]} and \${WASM_FEATURE_FLAGS[*]} (libopenmpt.a with exceptions + the shared features)`);
    }
  }
  const linkAt = code.indexOf('-o "$OUTPUT_DIR/${OUTPUT_BASENAME}.js"');
  const linkStart = code.lastIndexOf('em++ \\', linkAt);
  if (linkAt < 0 || linkStart < 0 || !code.slice(linkStart, linkAt).includes('"${WASM_EH_FLAGS[@]}"')) {
    errors.push('the native link must pass "${WASM_EH_FLAGS[@]}" (catching is decided at link time)');
  }
  if (/-sDISABLE_EXCEPTION_CATCHING=1/.test(code)) {
    errors.push('scripts/build-wasm.sh must not link with -sDISABLE_EXCEPTION_CATCHING=1 (libopenmpt\'s catch blocks become dead code)');
  }
  if (!/require_emsdk_pin build-wasm\.sh/.test(code)) {
    errors.push('scripts/build-wasm.sh must call require_emsdk_pin (an emsdk mismatch is fatal unless XASM_ALLOW_EMSDK_DRIFT=1)');
  }
  if (/\bwget\b|\bcurl\b/.test(code)) {
    errors.push('scripts/build-wasm.sh must download libopenmpt only via scripts/lib/libopenmpt-source.sh (sha256-checked)');
  }
}
// The link must go through em++: with .o inputs there is no .cpp suffix left for
// emcc to infer C++ from, so libc++/libc++abi would be skipped and every
// `operator new` in libopenmpt.a would come back undefined.
if (!/^em\+\+ \\$/m.test(buildSh)) {
  errors.push('scripts/build-wasm.sh must link the native worklet with em++ (not emcc)');
}
if (!/-c "\$CPP_DIR\/\$\{src\}\.cpp"/.test(buildSh)) {
  errors.push('scripts/build-wasm.sh must compile C++ to .o objects before linking (two-phase build)');
}

// Strip comments before scanning shell for dangerous command patterns
function stripShellComments(src) {
  return src
    .split('\n')
    .map((line) => {
      // Keep shebang; drop full-line # comments and trailing # comments (naive)
      if (line.startsWith('#!')) return line;
      const hash = line.indexOf('#');
      if (hash === 0) return '';
      if (hash > 0) return line.slice(0, hash);
      return line;
    })
    .join('\n');
}

// The build script must not wipe the worklets dir (it also holds the tracked JS worklet)
const scriptsCode = stripShellComments(buildSh);
if (/rm\s+-rf\s+.*public\/worklets/.test(scriptsCode)) {
  errors.push('scripts/build-wasm.sh must not rm -rf public/worklets');
}

console.log('verify-native-exports:');
console.log(`  EXPORTED_FUNCTIONS: ${[...exported].sort().join(', ')}`);
console.log(`  C++ KEEPALIVE:      ${[...keepalive].sort().join(', ')}`);
if (warnings.length) {
  console.warn('  warnings:');
  for (const w of warnings) console.warn(`    - ${w}`);
}
if (errors.length) {
  console.error('verify-native-exports FAILED:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log('verify-native-exports OK');
