import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Runs tests/python/test_coi_headers.py (stdlib unittest, no network) so npm test / preflight
// cover deploy.py's live COOP/COEP judgement (scripts/lib/coi_headers.py).
describe('scripts/lib/coi_headers.py', () => {
  it('passes its Python unit tests', () => {
    const root = join(__dirname, '..');
    const run = () =>
      execFileSync('python3', ['-B', '-m', 'unittest', 'discover', '-s', 'tests/python', '-p', 'test_*.py'], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    expect(run).not.toThrow();
  });
});
