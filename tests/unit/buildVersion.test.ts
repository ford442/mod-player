import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildMetaContent, readBuildVersion } from '../../vite-plugins/buildVersion';

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'build-version-'));
  const run = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  run('init', '-q');
  run('config', 'user.email', 't@example.invalid');
  run('config', 'user.name', 't');
  run('config', 'commit.gpgsign', 'false');
  writeFileSync(join(dir, 'a.txt'), 'a');
  run('add', '.');
  run('commit', '-q', '-m', 'init');
  return dir;
}

describe('readBuildVersion (#561)', () => {
  it('reports the full SHA, a clean tree, the profile and base', () => {
    const dir = repo();
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
    const v = readBuildVersion({ cwd: dir, base: '/xm-player/', env: {}, now: new Date('2026-11-27T12:00:00Z') });
    expect(v).toEqual({ sha, builtAt: '2026-11-27T12:00:00.000Z', profile: 'test', base: '/xm-player/', dirty: false });
    expect(v.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(buildMetaContent(v)).toBe(sha);
  });

  it('flags a dirty tree and marks the meta content', () => {
    const dir = repo();
    writeFileSync(join(dir, 'a.txt'), 'changed');
    const v = readBuildVersion({ cwd: dir, base: '/', env: {} });
    expect(v.dirty).toBe(true);
    expect(buildMetaContent(v)).toBe(`${v.sha}-dirty`);
  });

  it('uses the public profile for VITE_PUBLIC_MODE=1 and SOURCE_DATE_EPOCH for the time', () => {
    const dir = repo();
    const v = readBuildVersion({ cwd: dir, base: '/xm-player/', env: { VITE_PUBLIC_MODE: '1', SOURCE_DATE_EPOCH: '1700000000' } });
    expect(v.profile).toBe('public');
    expect(v.builtAt).toBe('2023-11-14T22:13:20.000Z');
  });

  it('is unknown and dirty outside a git checkout', () => {
    const dir = mkdtempSync(join(tmpdir(), 'no-git-'));
    const v = readBuildVersion({ cwd: dir, base: '/', env: {} });
    expect(v.sha).toBe('unknown');
    expect(v.dirty).toBe(true);
  });
});
