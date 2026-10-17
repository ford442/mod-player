import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * scripts/build-wasm.sh decides whether a cached libopenmpt.a may be reused by comparing a "flag
 * stamp", and CI keys its actions/cache entries on the same stamp. These tests pin what is and is
 * not allowed to change it, and that the workflows stay wired to it. They run the real script, but
 * only its `--print-flag-stamp` mode, which needs no emcc (the compile itself is CI's job).
 */

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SCRIPT = join(ROOT, 'scripts', 'build-wasm.sh');
const SCRIPT_TEXT = readFileSync(SCRIPT, 'utf8');
// #491: the flags and the libopenmpt version/hash live in shared files the script sources.
const LIB_FILES = ['wasm-flags.sh', 'libopenmpt-source.sh'] as const;
type LibFile = (typeof LIB_FILES)[number];
const LIB_TEXT: Record<LibFile, string> = {
  'wasm-flags.sh': readFileSync(join(ROOT, 'scripts', 'lib', 'wasm-flags.sh'), 'utf8'),
  'libopenmpt-source.sh': readFileSync(join(ROOT, 'scripts', 'lib', 'libopenmpt-source.sh'), 'utf8'),
};

const hasSha256sum = spawnSync('sha256sum', ['--version'], { encoding: 'utf8' }).status === 0;
const hasBash = spawnSync('bash', ['--version'], { encoding: 'utf8' }).status === 0;
const canRun = hasBash && hasSha256sum && process.platform !== 'win32';

const tmp = mkdtempSync(join(tmpdir(), 'flag-stamp-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

let variant = 0;
/**
 * A copy of the script (and the scripts/lib files it sources) with `edit` applied to one of them,
 * placed so its PROJECT_ROOT is a scratch directory.
 */
function scriptVariant(edit: (text: string) => string, target: 'build-wasm.sh' | LibFile = 'build-wasm.sh'): string {
  const dir = join(tmp, `v${variant++}`, 'scripts');
  mkdirSync(join(dir, 'lib'), { recursive: true });
  const original = target === 'build-wasm.sh' ? SCRIPT_TEXT : LIB_TEXT[target];
  const edited = edit(original);
  expect(edited, `the edit must actually change ${target}`).not.toBe(original);
  writeFileSync(join(dir, 'build-wasm.sh'), target === 'build-wasm.sh' ? edited : SCRIPT_TEXT);
  for (const lib of LIB_FILES) writeFileSync(join(dir, 'lib', lib), target === lib ? edited : LIB_TEXT[lib]);
  return join(dir, 'build-wasm.sh');
}

/** The unedited script, runnable from a scratch PROJECT_ROOT (its lib files copied alongside). */
const PRISTINE = scriptVariant((t) => `${t}\n`);

/** Replace exactly one occurrence, so a drifting script fails the test instead of silently skipping it. */
function replaceOnce(text: string, find: string, replacement: string): string {
  const parts = text.split(find);
  expect(parts.length - 1, `expected exactly one "${find}"`).toBe(1);
  return parts.join(replacement);
}

function stamp(script: string, ...args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('bash', [script, '--print-flag-stamp', ...args], {
    encoding: 'utf8',
    // No emcc on PATH, and a HOME with no emsdk to source: the stamp must not depend on a toolchain.
    env: { PATH: '/usr/bin:/bin', HOME: tmp, EMSDK_QUIET: '1' },
  });
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

describe.skipIf(!canRun)('build-wasm.sh --print-flag-stamp', () => {
  it('prints only a 16-hex stamp on stdout, with no toolchain, in both modes', () => {
    for (const args of [[], ['--debug']]) {
      const r = stamp(PRISTINE, ...args);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/^[0-9a-f]{16}\n$/);
    }
  });

  it('is stable across runs and differs between release and debug', () => {
    const a = stamp(PRISTINE).stdout;
    expect(stamp(PRISTINE).stdout).toBe(a);
    expect(stamp(PRISTINE, '--debug').stdout).not.toBe(a);
    // The link-only modes do not change what libopenmpt.a is.
    expect(stamp(PRISTINE, '--grow').stdout).toBe(a);
    expect(stamp(PRISTINE, '--safe-heap').stdout).toBe(a);
  });

  it('changes when the release libopenmpt flags change, and only for release', () => {
    const release = stamp(PRISTINE).stdout;
    const debug = stamp(PRISTINE, '--debug').stdout;
    for (const name of ['LIBOPENMPT_RELEASE_CXXFLAGS', 'LIBOPENMPT_RELEASE_CFLAGS']) {
      const edited = scriptVariant((t) => replaceOnce(t, `${name}="-O3 -DNDEBUG`, `${name}="-O2 -DNDEBUG`));
      expect(stamp(edited).stdout, name).not.toBe(release);
      expect(stamp(edited, '--debug').stdout, `${name} must not affect debug`).toBe(debug);
    }
  });

  it('changes when the debug libopenmpt flags change, and only for debug', () => {
    const release = stamp(PRISTINE).stdout;
    const debug = stamp(PRISTINE, '--debug').stdout;
    for (const name of ['LIBOPENMPT_DEBUG_CXXFLAGS', 'LIBOPENMPT_DEBUG_CFLAGS']) {
      const edited = scriptVariant((t) => replaceOnce(t, `${name}="-O1 `, `${name}="-O2 `));
      expect(stamp(edited, '--debug').stdout, name).not.toBe(debug);
      expect(stamp(edited).stdout, `${name} must not affect release`).toBe(release);
    }
  });

  it('changes with the emsdk pin and with LIBOPENMPT_BUILD_REV, in both modes', () => {
    const release = stamp(PRISTINE).stdout;
    const debug = stamp(PRISTINE, '--debug').stdout;
    const pin = scriptVariant((t) => replaceOnce(t, 'WASM_EMSDK_PIN="3.1.51"', 'WASM_EMSDK_PIN="3.1.52"'), 'wasm-flags.sh');
    const rev = scriptVariant((t) => replaceOnce(t, 'LIBOPENMPT_BUILD_REV=1', 'LIBOPENMPT_BUILD_REV=2'));
    // The shared flag set and the libopenmpt version shape libopenmpt.a too (#491).
    const features = scriptVariant(
      (t) => replaceOnce(t, 'WASM_FEATURE_FLAGS=(-mbulk-memory -mnontrapping-fptoint -msign-ext)', 'WASM_FEATURE_FLAGS=(-mbulk-memory -msign-ext)'),
      'wasm-flags.sh',
    );
    const eh = scriptVariant((t) => replaceOnce(t, 'WASM_EH_FLAGS=(-fwasm-exceptions)', 'WASM_EH_FLAGS=(-fexceptions)'), 'wasm-flags.sh');
    const version = scriptVariant(
      (t) => t.replace(/^LIBOPENMPT_VERSION="[^"]+"$/m, 'LIBOPENMPT_VERSION="0.8.4"'),
      'libopenmpt-source.sh',
    );
    for (const edited of [pin, rev, features, eh, version]) {
      expect(stamp(edited).stdout).not.toBe(release);
      expect(stamp(edited, '--debug').stdout).not.toBe(debug);
    }
  });

  it('does not change for comments or for flags that only affect the wrapper/link', () => {
    const release = stamp(PRISTINE).stdout;
    const debug = stamp(PRISTINE, '--debug').stdout;
    const comment = scriptVariant((t) => replaceOnce(t, '# Verify emcc is available', '# Verify emcc is available (edited comment)'));
    const link = scriptVariant((t) => replaceOnce(t, '-sMAXIMUM_MEMORY=256mb', '-sMAXIMUM_MEMORY=384mb'));
    for (const edited of [comment, link]) {
      expect(stamp(edited).stdout).toBe(release);
      expect(stamp(edited, '--debug').stdout).toBe(debug);
    }
  });
});

describe('libopenmpt flags the build depends on', () => {
  it('debug libopenmpt is built with atomics + bulk-memory (wasm-ld --shared-memory rejects objects without them)', () => {
    expect(LIB_TEXT['wasm-flags.sh']).toMatch(/^WASM_FEATURE_FLAGS=\([^)]*-mbulk-memory[^)]*\)$/m);
    for (const name of ['LIBOPENMPT_DEBUG_CXXFLAGS', 'LIBOPENMPT_DEBUG_CFLAGS']) {
      const m = new RegExp(`^${name}="([^"]*)"`, 'm').exec(SCRIPT_TEXT);
      expect(m, `${name} is defined`).not.toBeNull();
      expect(m?.[1]).toContain('-matomics');
      expect(m?.[1]).toContain('${WASM_FEATURE_FLAGS[*]}');
    }
  });

  it('no longer passes the meaningless -mtune=wasm32', () => {
    expect(SCRIPT_TEXT).not.toContain('-mtune=wasm32');
  });
});

describe('workflows key the native libopenmpt cache on the stamp', () => {
  const LIBOPENMPT_VERSION = /^LIBOPENMPT_VERSION="([^"]+)"/m.exec(LIB_TEXT['libopenmpt-source.sh'])?.[1] ?? '';

  /** Split a workflow into its `- name:` steps (indentation-agnostic enough for our files). */
  function steps(file: string): string[] {
    const text = readFileSync(join(ROOT, '.github', 'workflows', file), 'utf8');
    return text.split(/\n(?=\s+- name: )/);
  }

  const cases: Array<{ file: string; mode: 'release' | 'debug' }> = [
    { file: 'ci.yml', mode: 'release' },
    { file: 'native-wasm-scheduled.yml', mode: 'release' },
    { file: 'native-wasm-scheduled.yml', mode: 'debug' },
  ];

  it('knows the libopenmpt version', () => {
    expect(LIBOPENMPT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it.each(cases)('$file ($mode): exact stamp key, per-mode path, no restore-keys', ({ file, mode }) => {
    const cacheSteps = steps(file).filter((s) => /actions\/cache@/.test(s) && /libopenmpt/.test(s) && /native-(release|debug)/.test(s));
    const mine = cacheSteps.filter((s) => s.includes(`-native-${mode}`));
    expect(mine, `one native ${mode} libopenmpt cache step in ${file}`).toHaveLength(1);
    const step = mine[0] ?? '';

    // Version-free tree (#491): the version is part of the stamp, and the tree records it.
    expect(step).toContain(`path: vendor/libopenmpt-native-${mode}`);
    expect(step).toContain(`key: libopenmpt-native-\${{ runner.os }}-${mode}-\${{ steps.libopenmpt_stamp.outputs.stamp }}`);
    expect(step).not.toMatch(/^\s*restore-keys:/m);
  });

  it.each(cases)('$file ($mode): the stamp step asks the script for that mode', ({ file, mode }) => {
    const stampSteps = steps(file).filter((s) => /id: libopenmpt_stamp/.test(s));
    const wantsDebug = (s: string) => /--print-flag-stamp --debug/.test(s);
    const matching = stampSteps.filter((s) => wantsDebug(s) === (mode === 'debug'));
    expect(matching.length, `a ${mode} stamp step in ${file}`).toBeGreaterThanOrEqual(1);
  });

  it('no workflow still keys a native libopenmpt cache on the build script hash or a prefix fallback', () => {
    for (const file of ['ci.yml', 'native-wasm-scheduled.yml']) {
      const text = readFileSync(join(ROOT, '.github', 'workflows', file), 'utf8');
      expect(text, file).not.toContain("hashFiles('scripts/build-wasm.sh')");
      expect(text, file).not.toContain('libopenmpt-a-');
    }
  });
});
