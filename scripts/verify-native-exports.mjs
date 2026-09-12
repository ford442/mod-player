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

if (![BUILD_SH, CPP, ENGINE, TYPES].every(mustExist)) {
  console.error('verify-native-exports FAILED:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

const buildSh = readFileSync(BUILD_SH, 'utf8');
const cpp = readFileSync(CPP, 'utf8');
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
  'init_audio',
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
  'set_ring_buffer',
  'get_ring_write_head',
  'init_audio_with_context',
  'get_num_channels',
  'get_num_orders',
  'get_num_patterns',
  'get_duration_seconds',
  'get_initial_bpm',
  'get_order_pattern',
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
if (!/-sDISABLE_EXCEPTION_CATCHING=1/.test(buildSh)) {
  errors.push(
    'scripts/build-wasm.sh must set -sDISABLE_EXCEPTION_CATCHING=1 explicitly (do not rely on the emcc default)',
  );
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

// Root build-wasm.sh must not write openmpt-worklet outputs
const rootBuild = join(ROOT, 'build-wasm.sh');
if (existsSync(rootBuild)) {
  const rootCode = stripShellComments(readFileSync(rootBuild, 'utf8'));
  if (/-o\s+public\/worklets\/openmpt-worklet/.test(rootCode)) {
    errors.push('root build-wasm.sh still writes public/worklets/openmpt-worklet.* — must delegate only');
  }
  if (/rm\s+-rf\s+public\/worklets/.test(rootCode)) {
    errors.push('root build-wasm.sh must not rm -rf public/worklets');
  }
  if (!/scripts\/build-wasm\.sh/.test(rootCode)) {
    errors.push('root build-wasm.sh should delegate to scripts/build-wasm.sh');
  }
}

// Canonical script must not wipe worklets dir
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
