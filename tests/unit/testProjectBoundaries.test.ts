/**
 * Vitest projects are chosen by directory (vitest.config.ts, #541). Two things keep that honest:
 * every test file sits in a project directory (a file left in tests/ would silently never run),
 * and tests/unit/ — the fast loop — never pulls in real Web Audio or real-WASM harnesses.
 * ESLint's no-restricted-imports on tests/unit/** says the same at edit time.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const TESTS = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PROJECT_DIRS = ['unit', 'wasm', 'webaudio', 'build'];

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'fixtures' ? [] : walk(p);
    return [p];
  });
}

const FORBIDDEN_IN_UNIT = [
  /['"]node-web-audio-api['"]/,
  /helpers\/(webAudioNode|fxRender|libopenmptNode|wasmModuleCache|workletScope|createWorkerThread)['"]/,
];

describe('test project layout', () => {
  it('every *.test.ts lives under a project directory', () => {
    const stray = walk(TESTS)
      .filter((p) => p.endsWith('.test.ts'))
      .map((p) => relative(TESTS, p))
      .filter((rel) => !PROJECT_DIRS.includes(rel.split(/[\\/]/)[0] ?? ''));
    expect(stray).toEqual([]);
  });

  it('tests/unit/ imports no Web Audio or real-WASM harness', () => {
    const offenders = walk(join(TESTS, 'unit'))
      .filter((p) => p.endsWith('.ts') && !p.endsWith('testProjectBoundaries.test.ts'))
      .filter((p) => {
        const src = readFileSync(p, 'utf8');
        return FORBIDDEN_IN_UNIT.some((re) => re.test(src));
      })
      .map((p) => relative(TESTS, p));
    expect(offenders).toEqual([]);
  });
});
