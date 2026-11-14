import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const SCRIPT = join(ROOT, 'scripts', 'symbolicate.mjs');
const MAPS = join(ROOT, 'tests', 'fixtures', 'symbol-maps');

const tmp = mkdtempSync(join(tmpdir(), 'symbolicate-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function run(content: string, ...args: string[]): { status: number; stderr: string; stdout: string } {
  const file = join(tmp, `in-${Math.random().toString(36).slice(2)}`);
  writeFileSync(file, content);
  const r = spawnSync(process.execPath, [SCRIPT, file, ...args], { encoding: 'utf8' });
  return { status: r.status ?? -1, stderr: r.stderr, stdout: r.stdout };
}

const bundle = (key: string) =>
  JSON.stringify({
    kind: 'xasm1-diagnostics',
    faults: [
      {
        at: '2026-11-14T00:00:00.000Z',
        kind: 'error',
        source: 'window',
        message: 'RuntimeError: unreachable',
        stack: 'RuntimeError: unreachable\n    at wasm://wasm/1a:wasm-function[9]:0x10',
        wasmPair: 'libopenmpt-worklet',
        context: { assets: { 'libopenmpt-worklet': key } },
      },
    ],
  });

describe('scripts/symbolicate.mjs', () => {
  it('prints the named frames and exits 0 when every frame resolves', () => {
    const r = run(bundle('f1x7ure0aa'), '--maps', MAPS);
    expect(r.stderr).toContain('1 frame(s) named, 0 not');
    expect(r.stdout).toContain('wasm-function[9]:0x10  → OpenMPT::CSoundFile::ReadNote()');
    expect(r.status).toBe(0);
  });

  it('writes the report back with --json', () => {
    const r = run(bundle('f1x7ure0aa'), '--maps', MAPS, '--json');
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.faults[0].symbolicated.stack).toContain('→ OpenMPT::CSoundFile::ReadNote()');
  });

  it('exits 1 and names the missing map', () => {
    const r = run(bundle('0000000000'), '--maps', MAPS);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('libopenmpt-worklet.0000000000.symbols');
    expect(r.stderr).toContain('libopenmpt-symbol-maps');
  });

  it('decodes a plain stack trace against --pair / --key', () => {
    const r = run('trap\n  at wasm-function[7]:0x1', '--maps', MAPS, '--pair', 'libopenmpt-playback', '--key', 'f1x7ure0bb');
    expect(r.stdout).toContain('→ OpenMPT::CSoundFile::ProcessRamping(OpenMPT::ModChannel&)');
    expect(r.status).toBe(0);
  });

  it('exits 2 on a usage error', () => {
    expect(run('{}', '--bogus').status).toBe(2);
    expect(run('{"hello":1}').status).toBe(2);
  });
});
