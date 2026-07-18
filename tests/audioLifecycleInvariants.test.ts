import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getWorkletUrl } from '../hooks/useWorkletLoader';

const ROOT = join(import.meta.dirname, '..');

function readRepoFile(relPath: string): string {
  return readFileSync(join(ROOT, relPath), 'utf8');
}

function extractStopMusicBody(source: string): string {
  const start = source.indexOf('const stopMusic = useCallback');
  expect(start).toBeGreaterThan(-1);
  const slice = source.slice(start);
  const end = slice.indexOf('}, [');
  expect(end).toBeGreaterThan(-1);
  return slice.slice(0, end);
}

describe('audio lifecycle invariants (#329 + #330)', () => {
  it('worklet source uses shared libopenmpt singleton', () => {
    const worklet = readRepoFile('public/worklets/openmpt-worklet.js');
    expect(worklet).toContain('ensureSharedLibOpenMPT');
    expect(worklet).toContain('__openmptWorkletLibInitPromise');
    expect(worklet).toContain('Reusing shared libopenmpt instance');
    expect(worklet).toContain('__openmptLibEvalCount');
  });

  it('stopMusic does not suspend the AudioContext on normal stop/reload', () => {
    const hook = readRepoFile('hooks/useLibOpenMPT.ts');
    const stopMusicBody = extractStopMusicBody(hook);
    expect(stopMusicBody).not.toMatch(/audioContextRef\.current\.suspend\s*\(/);
    expect(stopMusicBody).toContain('Keep the node alive on normal stop/module reload');
  });

  it('initLib is gated behind canReuseWorkletNode in useAudioGraph', () => {
    const graph = readRepoFile('hooks/useAudioGraph.ts');
    expect(graph).toMatch(/if\s*\(\s*!canReuseWorkletNode\s*&&\s*libJsText\s*\)/);
    expect(graph).toContain("type: 'initLib'");
    expect(graph).toContain('__openmptInitLibPostCount');
  });

  it('duplicate play requests are ignored while already playing', () => {
    const graph = readRepoFile('hooks/useAudioGraph.ts');
    expect(graph).toContain('Already playing — ignoring duplicate play request');
    expect(graph).toMatch(
      /if\s*\(\s*refs\.isPlayingRef\.current\s*&&\s*refs\.audioWorkletNodeRef\.current\s*\)/,
    );
  });

  it('cache-bust chain is coherent (worklet v6 + SW v4)', () => {
    const loader = readRepoFile('hooks/useWorkletLoader.ts');
    const sw = readRepoFile('public/sw.js');
    expect(loader).toMatch(/WORKLET_VERSION\s*=\s*'6'/);
    expect(sw).toContain("const CACHE_NAME = 'mod-player-v4'");
    expect(getWorkletUrl()).toMatch(/openmpt-worklet\.js\?v=6/);
  });

  it('loadModule awaits play() before returning (prevents initLib race)', () => {
    const hook = readRepoFile('hooks/useLibOpenMPT.ts');
    expect(hook).toMatch(/if\s*\(\s*playRef\.current\s*\)\s*await\s+playRef\.current\s*\(\s*\)/);
  });
});
