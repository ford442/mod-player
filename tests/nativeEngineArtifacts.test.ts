import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  NATIVE_TRIO,
  classifyNativeEngine,
  exitCodeForResult,
  formatNativeEngineSummary,
} from '../scripts/nativeEngineArtifacts.mjs';

const WASM_MAGIC = Buffer.from([0x00, 0x61, 0x73, 0x6d]);

function writeValidTrio(dir: string): void {
  writeFileSync(join(dir, 'openmpt-native.js'), '// glue\nexport default 1;\n');
  writeFileSync(join(dir, 'openmpt-native.aw.js'), '// audio worklet bootstrap\n');
  writeFileSync(join(dir, 'openmpt-native.wasm'), Buffer.concat([WASM_MAGIC, Buffer.alloc(8)]));
}

describe('classifyNativeEngine', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function scratch(): string {
    const dir = mkdtempSync(join(tmpdir(), 'native-engine-'));
    dirs.push(dir);
    return dir;
  }

  it('reports absent when the worklets dir is empty or missing', () => {
    const empty = scratch();
    const missing = join(empty, 'no-such-worklets');
    for (const dir of [empty, missing]) {
      const result = classifyNativeEngine(dir);
      expect(result.status).toBe('absent');
      expect(result.present).toEqual([]);
      expect(result.missing).toEqual([...NATIVE_TRIO]);
      expect(exitCodeForResult(result)).toBe(0);
      expect(exitCodeForResult(result, true)).toBe(1);
      expect(formatNativeEngineSummary(result)).toMatch(/ABSENT/);
      expect(formatNativeEngineSummary(result)).toMatch(/npm run build:emcc/);
    }
  });

  it('reports complete when all three artifacts are valid', () => {
    const dir = scratch();
    writeValidTrio(dir);
    const result = classifyNativeEngine(dir);
    expect(result.status).toBe('complete');
    expect(result.present).toEqual([...NATIVE_TRIO]);
    expect(result.missing).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.sizes['openmpt-native.wasm']).toBeGreaterThan(0);
    expect(exitCodeForResult(result)).toBe(0);
    expect(formatNativeEngineSummary(result)).toMatch(/COMPLETE/);
  });

  it.each([
    [['openmpt-native.js']],
    [['openmpt-native.wasm']],
    [['openmpt-native.aw.js']],
    [['openmpt-native.js', 'openmpt-native.wasm']],
    [['openmpt-native.js', 'openmpt-native.aw.js']],
    [['openmpt-native.wasm', 'openmpt-native.aw.js']],
  ] as const)('reports partial for %j', (names) => {
    const dir = scratch();
    for (const name of names) {
      if (name.endsWith('.wasm')) {
        writeFileSync(join(dir, name), Buffer.concat([WASM_MAGIC, Buffer.alloc(4)]));
      } else {
        writeFileSync(join(dir, name), '// ok\n');
      }
    }
    const result = classifyNativeEngine(dir);
    expect(result.status).toBe('partial');
    expect(result.present).toEqual([...names]);
    expect(result.missing).toHaveLength(3 - names.length);
    expect(exitCodeForResult(result)).toBe(1);
    expect(formatNativeEngineSummary(result)).toMatch(/PARTIAL/);
  });

  it('reports invalid when wasm is missing \\0asm magic', () => {
    const dir = scratch();
    writeValidTrio(dir);
    writeFileSync(join(dir, 'openmpt-native.wasm'), Buffer.from('not wasm'));
    const result = classifyNativeEngine(dir);
    expect(result.status).toBe('invalid');
    expect(result.errors.some((e) => e.includes('\\0asm') || e.includes('0asm'))).toBe(true);
    expect(exitCodeForResult(result)).toBe(1);
  });

  it('reports invalid when wasm looks like an HTML 404 page', () => {
    const dir = scratch();
    writeValidTrio(dir);
    writeFileSync(join(dir, 'openmpt-native.wasm'), '<!DOCTYPE html><html>404</html>');
    const result = classifyNativeEngine(dir);
    expect(result.status).toBe('invalid');
    expect(result.errors.join(' ')).toMatch(/HTML/i);
  });

  it('reports invalid when JS glue looks like HTML', () => {
    const dir = scratch();
    writeValidTrio(dir);
    writeFileSync(join(dir, 'openmpt-native.js'), '<html>not found</html>');
    const result = classifyNativeEngine(dir);
    expect(result.status).toBe('invalid');
    expect(result.errors.join(' ')).toMatch(/openmpt-native\.js/);
  });

  it('ignores extra files such as openmpt-native.ww.js', () => {
    const dir = scratch();
    writeValidTrio(dir);
    writeFileSync(join(dir, 'openmpt-native.ww.js'), '// wasm worker leftover\n');
    expect(classifyNativeEngine(dir).status).toBe('complete');
  });
});
