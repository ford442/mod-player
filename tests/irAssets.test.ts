/** Room IR assets (#453): the synth, the committed Opus files and their manifest. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FX_PARAM_SPECS } from '../audio/fx/spec/paramSpecs';
import { IR_IDS, IR_SPECS, synthIr } from '../scripts/lib/ir-synth.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifest = JSON.parse(readFileSync(join(ROOT, 'audio/fx/room/ir-manifest.generated.json'), 'utf8')) as Record<
  string,
  { file: string; durationSeconds: number; channels: number }
>;

describe('room IR synth (#453)', () => {
  for (const id of IR_IDS) {
    it(`${id}: deterministic, unit-energy, decorrelated, wet-only`, () => {
      const [l, r] = synthIr(id, 48000);
      expect(l!.length).toBe(Math.round(IR_SPECS[id].seconds * 48000));
      expect(synthIr(id, 48000)[0]).toEqual(l); // deterministic
      let el = 0;
      let er = 0;
      let cross = 0;
      for (let i = 0; i < l!.length; i++) {
        expect(Number.isFinite(l![i]!)).toBe(true);
        el += l![i]! * l![i]!;
        er += r![i]! * r![i]!;
        cross += l![i]! * r![i]!;
      }
      expect(el).toBeCloseTo(1, 4);
      expect(er).toBeCloseTo(1, 4);
      expect(Math.abs(cross)).toBeLessThan(0.3); // decorrelated channels
      expect(Math.abs(l![0]!)).toBe(0); // no direct impulse (onset fades in from 0)
      expect(Math.abs(l![l!.length - 1]!)).toBeLessThan(1e-6); // faded out
    });
  }

  it('synthesizes at any context rate (export renders at 44.1 kHz)', () => {
    expect(synthIr('small', 44100)[0]!.length).toBe(Math.round(0.35 * 44100));
  });
});

describe('committed room IRs (#453)', () => {
  it('npm run verify:irs passes (files, hashes, sizes, synth spec unchanged)', () => {
    const out = execFileSync('node', [join(ROOT, 'scripts/generate-irs.mjs'), '--check'], { encoding: 'utf8' });
    expect(out).toContain('verify-irs OK');
  });

  it('the manifest, the synth and the room param options list the same IRs', () => {
    const roomIr = FX_PARAM_SPECS.room.find((s) => s.key === 'ir');
    expect(roomIr?.kind).toBe('enum');
    const options = roomIr?.kind === 'enum' ? roomIr.options.map((o) => o.value) : [];
    expect(Object.keys(manifest).sort()).toEqual([...IR_IDS].sort());
    expect([...options].sort()).toEqual([...IR_IDS].sort());
    for (const id of IR_IDS) {
      expect(manifest[id]!.durationSeconds).toBe(IR_SPECS[id].seconds);
      expect(manifest[id]!.channels).toBe(2);
      const bytes = readFileSync(join(ROOT, 'public/ir', manifest[id]!.file));
      expect(bytes.byteLength).toBeLessThan(64 * 1024); // small: fetched on demand
    }
  });
});
