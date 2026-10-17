/**
 * #491 Phase 2: both WASM builds share one audited flag set
 * (scripts/lib/wasm-flags.sh) and one hash-pinned libopenmpt source
 * (scripts/lib/libopenmpt-source.sh), and an emsdk other than the pin is fatal
 * unless XASM_ALLOW_EMSDK_DRIFT=1. The emcc builds themselves run in CI
 * (native-full-build, js-libopenmpt-rebuild); these keep the wiring honest.
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

const BUILDS = ['scripts/build-wasm.sh', 'scripts/build-js-libopenmpt.sh'] as const;

describe('one audited WASM flag set (#491)', () => {
  const flags = read('scripts/lib/wasm-flags.sh');

  it('defines the features, the exception model and the dropped libopenmpt makefile flags', () => {
    expect(flags).toMatch(/^WASM_FEATURE_FLAGS=\(-mbulk-memory -mnontrapping-fptoint -msign-ext\)$/m);
    expect(flags).toMatch(/^WASM_EH_FLAGS=\(-fwasm-exceptions\)$/m);
    expect(flags).toMatch(/^LIBOPENMPT_C_EXTRA_FLAGS=\([^)]*-fno-strict-aliasing[^)]*\)$/m);
    expect(flags).toMatch(/^LIBOPENMPT_CXX_EXTRA_FLAGS=\([^)]*-std=c\+\+17[^)]*\)$/m);
    expect(flags).toMatch(/^WASM_EMSDK_PIN="3\.1\.51"$/m);
  });

  it.each(BUILDS)('%s sources both shared files and uses their flags', (script) => {
    const src = code(script);
    expect(src).toContain('source "$SCRIPT_DIR/lib/wasm-flags.sh"');
    expect(src).toContain('source "$SCRIPT_DIR/lib/libopenmpt-source.sh"');
    expect(src).toContain('WASM_FEATURE_FLAGS');
    expect(src).toContain('WASM_EH_FLAGS');
    expect(src).toMatch(/LIBOPENMPT_C_EXTRA_FLAGS/);
    expect(src).not.toMatch(/^LIBOPENMPT_VERSION=/m);
  });

  it('the native build links libopenmpt with exceptions instead of DISABLE_EXCEPTION_CATCHING=1', () => {
    const src = code('scripts/build-wasm.sh');
    expect(src).not.toContain('-sDISABLE_EXCEPTION_CATCHING=1');
    expect(src).toMatch(/LIBOPENMPT_RELEASE_CXXFLAGS="[^"]*\$\{WASM_EH_FLAGS\[\*\]\}/);
    expect(src).toMatch(/em\+\+ \\\s*\n\s*"\$\{COMPILE_FLAGS\[@\]\}" \\\s*\n\s*"\$\{WASM_EH_FLAGS\[@\]\}"/);
    // The wrapper stays a no-throw C-API shim (compile-only flags).
    expect(src).toContain('CXX_ONLY_FLAGS=(-fno-exceptions -fno-rtti)');
  });

  it.each(BUILDS)('%s gates its output at the instruction level', (script) => {
    expect(code(script)).toMatch(/verify-wasm-features\.mjs" --profile/);
  });
});

describe('libopenmpt source pinned by hash (#491)', () => {
  const lib = read('scripts/lib/libopenmpt-source.sh');

  it('the pinned version has a sha256 and downloads are verified against it', () => {
    const version = lib.match(/^LIBOPENMPT_VERSION="([0-9.]+)"$/m)?.[1];
    expect(version).toBeDefined();
    expect(lib).toMatch(new RegExp(`${version!.replace(/\./g, '\\.')}\\) echo "[0-9a-f]{64}"`));
    expect(lib).toMatch(/got="\$\(sha256sum "\$archive"/);
    expect(lib).toMatch(/refusing to build from it/);
  });

  it('no build script downloads anything itself', () => {
    for (const script of [...BUILDS, 'scripts/native-host-test.sh']) {
      expect(code(script), script).not.toMatch(/\bwget\b|\bcurl\b/);
    }
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
    const r = pinCheck('6.0.2');
    expect(r.status).toBe(1);
    expect(r.stdout).not.toContain('reached');
    expect(r.stderr).toMatch(/pinned to emsdk 3\.1\.51/);
  });

  it('XASM_ALLOW_EMSDK_DRIFT=1 downgrades it to a warning', () => {
    const r = pinCheck('6.0.2', { XASM_ALLOW_EMSDK_DRIFT: '1' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('reached');
    expect(r.stderr).toMatch(/will not match CI/);
  });

  it.each(BUILDS)('%s calls the check', (script) => {
    expect(code(script)).toMatch(/require_emsdk_pin build-/);
  });
});
