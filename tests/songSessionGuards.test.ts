/**
 * Source guards for #511: one song identity, and session I/O stays off the
 * audio thread and off the render frame.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const NOT_PRODUCTION = /^(tests|scripts|archive|docs|public|cpp)\//;

/** Tracked + new (not ignored) app sources. */
function sources(): string[] {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '*.ts', '*.tsx'], { cwd: ROOT, encoding: 'utf8' });
  return out.split('\n').filter((f) => f && !NOT_PRODUCTION.test(f) && !f.endsWith('.d.ts') && existsSync(join(ROOT, f)));
}

/** Source without comments, so prose that names a symbol is not a use of it. */
const code = (f: string) => readFileSync(join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

const SESSION_IMPORT = /from ['"][./]*(?:\.\.\/)*utils\/songSession(?:Idb)?['"]|from ['"]\.\/songSession(?:Idb)?['"]/;

describe('#511 guards', () => {
  const files = sources();

  it('computeModuleHash has no production caller', () => {
    const callers = files.filter((f) => f !== 'appConfig.ts' && /\bcomputeModuleHash\b/.test(code(f)));
    expect(callers).toEqual([]);
    expect(code('appConfig.ts').match(/computeModuleHash\(/g)).toHaveLength(1); // the definition
  });

  it('no setModuleHash wiring is left', () => {
    expect(files.filter((f) => /\bsetModuleHash\b/.test(code(f)))).toEqual([]);
  });

  it('the AudioWorklet bundle never reaches the session store', () => {
    const worklet = files.filter((f) => f.startsWith('audio-worklet/'));
    expect(worklet.length).toBeGreaterThan(0);
    expect(worklet.filter((f) => /songSession|songIdentity|shaderPrefsStore|indexedDB/.test(readFileSync(join(ROOT, f), 'utf8')))).toEqual([]);
  });

  it('session I/O is not imported by render-loop / frame code', () => {
    const importers = files.filter((f) => SESSION_IMPORT.test(readFileSync(join(ROOT, f), 'utf8')));
    expect(importers.sort()).toEqual(['store/shaderPrefsStore.ts', 'utils/songSession.ts', 'utils/songSessionIdb.ts']);
    for (const f of importers) {
      expect(code(f)).not.toMatch(/requestAnimationFrame|AudioWorkletProcessor/);
    }
  });
});
