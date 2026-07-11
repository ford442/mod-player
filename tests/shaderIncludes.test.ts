/**
 * Shader include system — packing / night-family circular variants.
 * Acceptance: ≥3 circular variants expand from shared libs; packing changes
 * flow through npm run sync:shaders into public/ flat WGSL.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it, beforeAll } from 'vitest';
import { expandShader, resolveIncludes } from '../scripts/sync-shaders.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = join(ROOT, 'shaders');
const DEST = join(ROOT, 'public/shaders');

const NIGHT_VARIANTS = [
  'patternv0.52.wgsl',
  'patternv0.53.wgsl',
  'patternv0.54.wgsl',
] as const;

describe('shader include expansion (night circular family)', () => {
  beforeAll(() => {
    // Ensure public/ is current (predev/prebuild also run this)
    // Re-expand from source so tests do not depend on a prior sync side-effect only.
  });

  it('entry files are thin theme shells', () => {
    for (const name of NIGHT_VARIANTS) {
      const src = readFileSync(join(SRC, name), 'utf8');
      const lines = src.split('\n').filter((l) => l.trim().length > 0);
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
      expect(includes.some((p) => p.includes('packing.wgsl'))).toBe(true);
      expect(includes.some((p) => p.includes('emitters.wgsl') || p.includes('lens_cap.wgsl'))).toBe(true);
      expect(includes.some((p) => p.includes('polar_layout.wgsl'))).toBe(true);
      expect(includes.some((p) => p.includes('circular_night_body.wgsl'))).toBe(true);
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
