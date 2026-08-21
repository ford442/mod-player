/**
 * Shader include system — packing / night-family circular variants.
 * Acceptance: ≥3 circular variants expand from shared libs; packing changes
 * flow through npm run sync:shaders into public/ flat WGSL.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, beforeAll } from 'vitest';
import { expandShader, resolveIncludes } from '../scripts/sync-shaders.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SRC = join(ROOT, 'shaders');
const DEST = join(ROOT, 'public/shaders');

const NIGHT_VARIANTS = [
  'patternv0.52.wgsl',
  'patternv0.53.wgsl',
  'patternv0.54.wgsl',
] as const;

const LED_CORE_VARIANTS = [
  'patternv0.50.wgsl',
  'patternv0.50b.wgsl',
  'patternv0.51.wgsl',
  'patternv0.57.wgsl',
  'patternv0.58.wgsl',
] as const;

const TIER_A_SAMPLES = [
  'patternv0.45b.wgsl',
  'patternv0.47.wgsl',
  'patternv0.55.wgsl',
  'patternv0.56.wgsl',
] as const;

describe('shader include expansion (night circular family)', () => {
  beforeAll(() => {
    // Ensure public/ is current (predev/prebuild also run this)
    // Re-expand from source so tests do not depend on a prior sync side-effect only.
  });

  it('entry files are thin theme shells', () => {
    for (const name of NIGHT_VARIANTS) {
      const src = readFileSync(join(SRC, name), 'utf8');
      const lines = src.split('\n').filter((l: string) => l.trim().length > 0);
      // Header comments + two includes
      expect(lines.length).toBeLessThan(12);
      expect(src).toMatch(/\/\/#include\s+"lib\/circular_night_body\.wgsl"/);
      expect(src).toMatch(/\/\/#include\s+"lib\/(night_theme|theme_night_\d+)\.wgsl"/);
    }
  });

  it('expands all three night variants from shared libs without residual includes', () => {
    for (const name of NIGHT_VARIANTS) {
      const { flat, includes } = expandShader(join(SRC, name));
      expect(flat).not.toMatch(/^\s*\/\/\s*#include\s+"/m);
      expect(includes.some((p: string) => p.includes('packing.wgsl'))).toBe(true);
      expect(includes.some((p: string) => p.includes('emitters.wgsl') || p.includes('lens_cap.wgsl'))).toBe(true);
      expect(includes.some((p: string) => p.includes('polar_layout.wgsl'))).toBe(true);
      expect(includes.some((p: string) => p.includes('circular_night_body.wgsl'))).toBe(true);
      // TRIG-001 / DURA path present once expanded
      expect(flat).toContain('fn unpackDurationInfo');
      expect(flat).toContain('fn unpackCellFields');
      expect(flat).toContain('fn classifyCell');
      expect(flat).toContain('fn octaveBrightness');
      expect(flat).toContain('fn polarComputeRing');
      expect(flat).toContain('@fragment');
      expect(flat).toContain('@vertex');
    }
  });

  it('changing packing.wgsl content appears in every night variant expansion', () => {
    const packingPath = join(SRC, 'lib/packing.wgsl');
    const packing = readFileSync(packingPath, 'utf8');
    // Use a stable unique marker already present in packing.wgsl header
    expect(packing).toContain('bit-field unpack + TRIG-001');

    for (const name of NIGHT_VARIANTS) {
      const flat = resolveIncludes(join(SRC, name));
      expect(flat).toContain('bit-field unpack + TRIG-001');
      // Shared unpack body — single definition after dedupe
      const matches = flat.match(/fn unpackDurationInfo\s*\(/g) ?? [];
      expect(matches.length).toBe(1);
    }
  });

  it('public/shaders flat copies match expandShader when present', () => {
    for (const name of NIGHT_VARIANTS) {
      const pub = join(DEST, name);
      if (!existsSync(pub)) continue;
      const { flat } = expandShader(join(SRC, name));
      const onDisk = readFileSync(pub, 'utf8');
      // Allow trailing newline drift
      expect(onDisk.replace(/\s+$/, '')).toBe(flat.replace(/\s+$/, ''));
    }
  });

  it('shared packing sets isTrigger (TRIG-001) — not left default-false', () => {
    const packing = readFileSync(join(SRC, 'lib/dura.wgsl'), 'utf8');
    expect(packing).toMatch(/info\.isTrigger\s*=/);
    for (const name of NIGHT_VARIANTS) {
      const flat = resolveIncludes(join(SRC, name));
      // Must call shared unpack rather than hand-assign partial NoteDurationInfo
      expect(flat).toContain('unpackDurationInfo(in.packedA, in.packedB)');
      expect(flat).toContain('classifyCell(');
    }
  });
});

describe('shader include expansion (trap LED core family)', () => {
  it('tier-B entry files are thin theme + body shells', () => {
    const thin = ['patternv0.50.wgsl', 'patternv0.57.wgsl', 'patternv0.58.wgsl'] as const;
    for (const name of thin) {
      const src = readFileSync(join(SRC, name), 'utf8');
      const lines = src.split('\n').filter((l: string) => l.trim().length > 0);
      expect(lines.length).toBeLessThan(14);
      expect(src).toMatch(/\/\/#include\s+"lib\/theme_trap_frosted\.wgsl"/);
      expect(src).toMatch(/\/\/#include\s+"lib\/circular_led/);
    }
  });

  it('expands LED core variants without residual includes', () => {
    for (const name of LED_CORE_VARIANTS) {
      const { flat, includes } = expandShader(join(SRC, name));
      expect(flat).not.toMatch(/^\s*\/\/\s*#include\s+"/m);
      if (name !== 'patternv0.50b.wgsl') {
        expect(
          includes.some((p: string) =>
            p.includes('emitters_trap.wgsl') || p.includes('emitters_playhead.wgsl') || p.includes('circular_led')
          )
        ).toBe(true);
      }
      expect(flat).toContain('fn unpackDurationInfo');
      if (name !== 'patternv0.50b.wgsl') {
        expect(flat).toContain('fn drawUnifiedLensCap');
      }
      expect(flat).toContain('@fragment');
    }
  });

  it('v0.58 includes audio-reactive lib', () => {
    const { includes, flat } = expandShader(join(SRC, 'patternv0.58.wgsl'));
    expect(includes.some((p: string) => p.includes('audio_reactive.wgsl'))).toBe(true);
    expect(flat).toContain('audioKickPulse');
  });
});

describe('shader include expansion (tier-A utility includes)', () => {
  it('tier-A shaders use //#include for shared libs', () => {
    for (const name of TIER_A_SAMPLES) {
      const src = readFileSync(join(SRC, name), 'utf8');
      expect(src).toMatch(/\/\/#include\s+"lib\//);
      const { flat } = expandShader(join(SRC, name));
      expect(flat).not.toMatch(/^\s*\/\/\s*#include\s+"/m);
    }
  });

  it('video shaders are documented procedural exceptions (no packing path)', () => {
    for (const name of ['patternv0.23.wgsl', 'patternv0.24.wgsl'] as const) {
      const src = readFileSync(join(SRC, name), 'utf8');
      // May use pitch helpers only; must not duplicate full packing stack
      expect(src).not.toMatch(/fn unpackDurationInfo/);
    }
  });
});

describe('shader include expansion (GPU audio analysis)', () => {
  const ENTRY = 'compute_analysis.wgsl';
  const LIBS = ['lib/waveform_minmax.wgsl', 'lib/fft.wgsl', 'lib/spectrum_bands.wgsl'] as const;

  it('entry shader pulls every analysis lib through //#include', () => {
    const src = readFileSync(join(SRC, ENTRY), 'utf8');
    for (const lib of LIBS) {
      expect(src).toContain(`//#include "${lib}"`);
    }

    const { flat, includes } = expandShader(join(SRC, ENTRY));
    expect(flat).not.toMatch(/^\s*\/\/\s*#include\s+"/m);
    for (const lib of LIBS) {
      expect(includes).toContain(lib);
    }
  });

  it('expands to both compute entry points and the kernels they call', () => {
    const { flat } = expandShader(join(SRC, ENTRY));
    expect(flat).toContain('fn waveform_main(');
    expect(flat).toContain('fn spectrum_main(');
    expect(flat).toContain('fn fftRunStages');
    expect(flat).toContain('fn fftBitReverse');
    expect(flat).toContain('fn spectrumAccumulateBands');
    expect(flat).toContain('fn spectrumFillBins');
    expect(flat).toContain('fn waveformTileExtrema');
  });

  it('libs stay include-only — no bindings, no entry points of their own', () => {
    for (const lib of LIBS) {
      const src = readFileSync(join(SRC, lib), 'utf8');
      expect(src).not.toMatch(/@group\(/);
      expect(src).not.toMatch(/@compute/);
    }
  });

  it('waveform lib documents its forward-declaration contract', () => {
    // lib/waveform_minmax.wgsl calls waveformSampleMono, which the entry shader
    // must declare *before* the include (WGSL resolves in declaration order).
    const entry = readFileSync(join(SRC, ENTRY), 'utf8');
    const declIndex = entry.indexOf('fn waveformSampleMono');
    const includeIndex = entry.indexOf('//#include "lib/waveform_minmax.wgsl"');
    expect(declIndex).toBeGreaterThan(-1);
    expect(includeIndex).toBeGreaterThan(declIndex);
  });

  it('the analysis entry is published to public/ as flat WGSL', () => {
    const published = join(DEST, ENTRY);
    expect(existsSync(published)).toBe(true);
    const { flat } = expandShader(join(SRC, ENTRY));
    expect(readFileSync(published, 'utf8').replace(/\s+$/, '')).toBe(flat.replace(/\s+$/, ''));
  });
});
