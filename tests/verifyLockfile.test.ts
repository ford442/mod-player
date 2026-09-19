import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SCRIPT = join(ROOT, 'scripts', 'verify-lockfile.mjs');

const tmp = mkdtempSync(join(tmpdir(), 'verify-lockfile-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/**
 * Small hand-written fixtures on purpose — the real 271 KB lockfile is not copied here.
 * The dependency-graph check is `npm ci --dry-run`; this script only covers the metadata
 * npm's own validation passes over silently.
 */
function validLock(): Record<string, unknown> {
  return {
    name: 'fixture',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': { name: 'fixture', version: '0.0.0', dependencies: { left: '^1.0.0' } },
      'node_modules/left': {
        version: '1.0.0',
        resolved: 'https://registry.npmjs.org/left/-/left-1.0.0.tgz',
        integrity: 'sha512-AAAA',
      },
      'packages/local': { resolved: 'packages/local', link: true },
    },
  };
}

function run(lock: unknown): { status: number; stderr: string; stdout: string } {
  const file = join(tmp, `lock-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify(lock, null, 2));
  const r = spawnSync(process.execPath, [SCRIPT, file], { encoding: 'utf8' });
  return { status: r.status ?? -1, stderr: r.stderr, stdout: r.stdout };
}

describe('verify-lockfile', () => {
  it('accepts a well-formed lockfile and ignores root + link entries', () => {
    const r = run(validLock());
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('verify-lockfile OK');
  });

  it('rejects an entry missing integrity, naming the package path', () => {
    const lock = validLock();
    delete (lock.packages as Record<string, Record<string, unknown>>)['node_modules/left']!
      .integrity;
    const r = run(lock);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('packages["node_modules/left"] is missing integrity');
  });

  it('rejects an entry missing resolved, naming the package path', () => {
    const lock = validLock();
    delete (lock.packages as Record<string, Record<string, unknown>>)['node_modules/left']!
      .resolved;
    const r = run(lock);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('packages["node_modules/left"] is missing resolved');
  });

  it('rejects a lockfileVersion other than 3', () => {
    const lock = validLock();
    lock.lockfileVersion = 2;
    const r = run(lock);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('lockfileVersion is 2, expected 3');
  });

  it('rejects a lockfile with no packages{} map', () => {
    const lock = validLock();
    delete lock.packages;
    const r = run(lock);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('packages{} is missing or not an object');
  });

  it('exits non-zero when the lockfile does not exist', () => {
    const r = spawnSync(process.execPath, [SCRIPT, join(tmp, 'nope.json')], {
      encoding: 'utf8',
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('missing');
  });

  it('passes on the repository lockfile', () => {
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: ROOT, encoding: 'utf8' });
    expect(r.status).toBe(0);
  });
});
