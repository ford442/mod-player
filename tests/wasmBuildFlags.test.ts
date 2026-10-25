/**
 * #491 / #515: the JS engine's libopenmpt pairs share one audited flag set
 * (scripts/lib/wasm-flags.sh) and one hash-pinned libopenmpt source
 * (scripts/lib/libopenmpt-source.sh), an emsdk other than the pin is fatal
 * unless XASM_ALLOW_EMSDK_DRIFT=1, and the playback heap's link whole-archives
 * libwasm_workers so its main thread's TLS is initialised. The emcc builds run
 * in CI (js-libopenmpt-rebuild); these keep the wiring honest in preflight.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
/** Shell source without full-line comments. */
const code = (p: string) => read(p).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

const BUILD = 'scripts/build-js-libopenmpt.sh';

describe('one audited WASM flag set (#491, #515)', () => {
  const flags = code('scripts/lib/wasm-flags.sh');

  it('defines the features, the exception model, the -O level, Closure and the dropped libopenmpt makefile flags', () => {
    expect(flags).toMatch(/^WASM_FEATURE_FLAGS=\(-mbulk-memory -mnontrapping-fptoint\)$/m);
    expect(flags).toMatch(/^WASM_EH_FLAGS=\(-fwasm-exceptions\)$/m);
    expect(flags).toMatch(/^WASM_OPT_LEVEL="-Os"$/m);
    expect(flags).toMatch(/^WASM_RELEASE_CLOSURE=1$/m);
    expect(flags).toMatch(/^LIBOPENMPT_C_EXTRA_FLAGS=\([^)]*-fno-strict-aliasing[^)]*\)$/m);
    expect(flags).toMatch(/^LIBOPENMPT_CXX_EXTRA_FLAGS=\([^)]*-std=c\+\+17[^)]*-fvisibility=hidden[^)]*\)$/m);
    expect(flags).toMatch(/^WASM_EMSDK_PIN="3\.1\.51"$/m);
  });

  it('the build sources both shared files and uses their flags', () => {
    const src = code(BUILD);
    expect(src).toContain('source "$SCRIPT_DIR/lib/wasm-flags.sh"');
    expect(src).toContain('source "$SCRIPT_DIR/lib/libopenmpt-source.sh"');
    for (const name of ['WASM_FEATURE_FLAGS', 'WASM_EH_FLAGS', 'WASM_OPT_LEVEL', 'WASM_RELEASE_CLOSURE', 'LIBOPENMPT_C_EXTRA_FLAGS', 'LIBOPENMPT_CXX_EXTRA_FLAGS']) {
      expect(src, name).toContain(name);
    }
    expect(src).not.toMatch(/^LIBOPENMPT_VERSION=/m);
  });

  it('flags that were no-ops stay gone', () => {
    const src = code(BUILD);
    for (const flag of ['-ffunction-sections', '-fdata-sections', '--gc-sections', '-sSAFE_HEAP', '-msign-ext']) {
      expect(src, flag).not.toContain(flag);
    }
  });

  it('the playback link whole-archives libwasm_workers (the main-thread TLS constructor, #515)', () => {
    const src = code(BUILD);
    expect(src).toContain('LINK_ENV=(EMCC_FORCE_STDLIBS=libwasm_workers)');
    expect(src).toMatch(/env "\$\{LINK_ENV\[@\]\}" em\+\+/);
  });

  it('a --debug glue can boot in an AudioWorkletGlobalScope (no window, no importScripts)', () => {
    const src = code(BUILD);
    expect(src).toMatch(/if \[\[ "\$DEBUG_MODE" -eq 1 \]\]; then\s+ENVIRONMENT="web,worker,shell"/);
    // Both pairs export wasmMemory: the processor reads it, and an ASSERTIONS glue aborts on unexported reads.
    expect(src).toMatch(/EXPORTED_RUNTIME_METHODS="\[[^\]]*'wasmMemory'\]"\s+else\s+EXPORTED_RUNTIME_METHODS="\[[^\]]*'wasmMemory'\]"/);
  });

  it('release links emit a symbol map, kept out of public/worklets/', () => {
    const src = code(BUILD);
    expect(src).toContain('--emit-symbol-map');
    expect(src).toMatch(/mv "\$\{GLUE\}\.symbols" "\$SYMBOL_DIR\//);
  });

  it('the build verifies what it wrote (manifest + instruction-level feature gate)', () => {
    expect(code(BUILD)).toMatch(/verify-js-libopenmpt\.mjs" --write/);
  });
});

describe('libopenmpt source pinned by hash (#491)', () => {
  const lib = read('scripts/lib/libopenmpt-source.sh');

  it('the pinned version has a sha256 and downloads are verified against it', () => {
    const version = lib.match(/^LIBOPENMPT_VERSION="([0-9.]+)"$/m)?.[1];
    expect(version).toBe('0.8.9');
    expect(lib).toMatch(new RegExp(`${version!.replace(/\./g, '\\.')}\\) echo "[0-9a-f]{64}"`));
    expect(lib).toMatch(/got="\$\(sha256sum "\$archive"/);
    expect(lib).toMatch(/refusing to build from it/);
  });

  it('the build script downloads nothing itself', () => {
    expect(code(BUILD)).not.toMatch(/\bwget\b|\bcurl\b/);
  });

  it('the shell lib returns the same digest the table holds', () => {
    const out = execFileSync('bash', ['-c', 'source scripts/lib/libopenmpt-source.sh; libopenmpt_tarball_sha256 "$LIBOPENMPT_VERSION"'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
    expect(out).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('emsdk drift is fatal by default (#491)', () => {
  /** Run require_emsdk_pin with a fake `emcc` reporting `version`. */
  const pinCheck = (version: string, env: Record<string, string> = {}) =>
    spawnSync('bash', ['-c', `emcc() { echo "emcc (Emscripten gcc/clang-like replacement) ${version} (abc)"; }; source scripts/lib/wasm-flags.sh; require_emsdk_pin test-build; echo reached`], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, XASM_ALLOW_EMSDK_DRIFT: '', ...env },
    });

  it('accepts the pin', () => {
    const r = pinCheck('3.1.51');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('reached');
  });

  it('refuses any other emcc', () => {
    const r = pinCheck('6.0.13');
    expect(r.status).toBe(1);
    expect(r.stdout).not.toContain('reached');
    expect(r.stderr).toMatch(/pinned to emsdk 3\.1\.51/);
  });

  it('XASM_ALLOW_EMSDK_DRIFT=1 downgrades it to a warning', () => {
    const r = pinCheck('6.0.13', { XASM_ALLOW_EMSDK_DRIFT: '1' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('reached');
    expect(r.stderr).toMatch(/will not match CI/);
  });

  it('the build calls the check', () => {
    expect(code(BUILD)).toMatch(/require_emsdk_pin "build-js-libopenmpt\.sh"/);
  });
});
