/**
 * The committed libopenmpt pairs must not depend on where the repository is checked out.
 *
 * wasm-ld names each ThinLTO input "<archive path>(<member> at <offset>)". Linked with an absolute
 * -L, that path decided the LTO input order relative to emsdk's own (absolute) system libraries,
 * so CI (/home/runner/work/…, emsdk in /home/runner/work/_temp/…) and other machines produced
 * playback wasms that differ in a few bytes of code layout, and the drift check failed on a
 * correct commit. The link now runs inside the libopenmpt tree with a relative -Lbin.
 * .github/workflows/wasm-reproducibility.yml rebuilds at two paths weekly to prove it.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

describe('libopenmpt build is path-independent', () => {
  const script = read('scripts/build-js-libopenmpt.sh');

  it('links the static lib by a relative path from inside its tree', () => {
    const link = script.slice(script.indexOf('echo "🔗 Linking'), script.indexOf('-o "$GLUE"'));
    expect(link).toContain('pushd "$JS_TREE"');
    expect(link).toContain('-Lbin -lopenmpt');
    expect(link).not.toMatch(/-L"\$LIB_DIR"/);
    expect(script).toMatch(/-o "\$GLUE"\npopd/);
  });

  it('resolves OUT_DIR to an absolute path before the link changes directory', () => {
    expect(script).toMatch(/OUT_DIR="\$\(cd "\$OUT_DIR" && pwd\)"/);
  });
});

describe('libopenmpt link is deterministic (#561)', () => {
  const script = read('scripts/build-js-libopenmpt.sh');
  const flags = read('scripts/lib/wasm-flags.sh');
  const link = script.slice(script.indexOf('echo "🔗 Linking'), script.indexOf('-o "$GLUE"'));

  it('runs the link on one CPU, one arena, one linker thread, one ThinLTO job, ASLR off', () => {
    // LLVM's wasm backend lays out openmpt::version::get_string differently from run to run otherwise;
    // the measurements are in wasm-flags.sh. Dropping any of these brings the weekly drift failure back.
    expect(link).toContain('determinism_prefix');
    expect(link).toContain('MALLOC_ARENA_MAX=1');
    expect(link).toContain('"${DET_PREFIX[@]}" em++');
    expect(link).toContain('"${WASM_DETERMINISM_LINK_FLAGS[@]}"');
    expect(flags).toMatch(/WASM_DETERMINISM_LINK_FLAGS=\(-Wl,--threads=1 -Wl,--thinlto-jobs=1\)/);
    expect(flags).toMatch(/setarch "\$arch" -R/);
    expect(flags).toMatch(/taskset -c "\$cpu"/);
  });
});

describe('emsdk is pinned in CI', () => {
  const flags = read('scripts/lib/wasm-flags.sh');
  const ci = read('.github/workflows/ci.yml');
  const weekly = read('.github/workflows/wasm-reproducibility.yml');

  it('pins the emsdk scripts to a commit, not HEAD', () => {
    expect(flags).toMatch(/WASM_EMSDK_SCRIPTS_COMMIT="[0-9a-f]{40}"/);
    expect(ci).not.toContain('mymindstorm/setup-emsdk');
    expect(ci).toContain('scripts/ci/setup-emsdk.sh');
    expect(weekly).toContain('scripts/ci/setup-emsdk.sh');
  });

  it('keys the object cache on the committed binaries', () => {
    expect(ci).toMatch(/libopenmpt-js-engine-.*public\/worklets\/libopenmpt-playback\.wasm/);
  });

  it('runs a weekly cold rebuild with no cache restore', () => {
    expect(weekly).toMatch(/schedule:[\s\S]*?- cron:/);
    expect(weekly).not.toContain('actions/cache');
  });
});
