/**
 * Source guards for UI wiring bugs that have no runtime harness here (no DOM renderer in the unit
 * project): the Project-M embed transport and the bezel BPM readout.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

describe('Project-M embed transport', () => {
  const view = read('components/ProjectMEmbedView.tsx');
  const host = read('app/ProjectMEmbedHost.tsx');

  it('never stops with destroy=true (that unloads the module and disables every button)', () => {
    expect(view).not.toMatch(/stopMusic\(\s*true\s*\)/);
    expect(host).not.toMatch(/stopMusic\(\s*true\s*\)/);
    expect(host).toMatch(/stopMusic\(\s*false\s*\)/);
  });

  it('pauses with pause(), not stop (pitfall 15)', () => {
    expect(view).toMatch(/if \(isPlaying\) \{\s*pause\(\);/);
  });

  it('uses the engine-bound LiveSeekBar (real duration, row-rate fields in a leaf)', () => {
    expect(view).toContain('<LiveSeekBar />');
    expect(view).not.toMatch(/durationSeconds=\{0\}/);
    // The host must not subscribe to row-rate snapshot fields (pitfall 17).
    expect(host).not.toMatch(/playbackSeconds|playbackRowFraction/);
  });
});

describe('bezel BPM readout', () => {
  it('feeds PatternDisplay the live tempo, not a constant', () => {
    const stage = read('components/PerformanceStage.tsx');
    expect(stage).not.toMatch(/bpm=\{\d+\}/);
    expect(stage).toMatch(/usePlayerEngine\(\(s\) => Math\.round\(s\.moduleInfo\.bpm\)\)/);
    expect(stage).toMatch(/bpm=\{bpm\}/);
  });
});
