import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WAVEFORM_POINTS } from '../../types/instruments';
import { downsamplePeaks } from '../../utils/sampleExtract/downsample';
import {
  extractModInstrumentTable,
  isProTrackerMod,
  readModTitle,
} from '../../utils/sampleExtract/mod';
import { extractInstrumentTable } from '../../utils/sampleExtract';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_MOD = join(__dirname, '../../public/4-mat_madness.mod');

function loadFixture(): Uint8Array {
  return new Uint8Array(readFileSync(FIXTURE_MOD));
}

describe('sampleExtract/mod', () => {
  it('detects ProTracker MOD signature', () => {
    const data = loadFixture();
    expect(isProTrackerMod(data)).toBe(true);
    expect(readModTitle(data)).toBe("4-mat's.madness");
  });

  it('extracts 31 samples with waveforms', () => {
    const table = extractModInstrumentTable(loadFixture());
    expect(table.format).toBe('mod');
    expect(table.samples).toHaveLength(31);
    expect(table.instruments).toHaveLength(31);

    const nonEmpty = table.samples.filter((s) => s.length > 0);
    expect(nonEmpty.length).toBeGreaterThan(0);

    for (const sample of nonEmpty) {
      expect(sample.waveform).toHaveLength(WAVEFORM_POINTS);
      expect(sample.waveform.some((v) => v !== 0)).toBe(true);
      expect(sample.volume).toBeGreaterThanOrEqual(0);
      expect(sample.volume).toBeLessThanOrEqual(64);
    }
  });

  it('maps MOD samples 1:1 to instruments', () => {
    const table = extractModInstrumentTable(loadFixture());
    const first = table.instruments[0];
    expect(first?.index).toBe(1);
    expect(first?.sampleIndices).toEqual([1]);
    expect(first?.samples).toHaveLength(1);
  });

  it('extractInstrumentTable routes .mod files', () => {
    const table = extractInstrumentTable(loadFixture(), '4-mat_madness.mod');
    expect(table.format).toBe('mod');
    expect(table.samples).toHaveLength(31);
  });
});

describe('downsamplePeaks', () => {
  it('returns zeros for empty PCM', () => {
    const out = downsamplePeaks(new Int8Array(0), 8);
    expect(out).toHaveLength(8);
    expect(out.every((v) => v === 0)).toBe(true);
  });

  it('preserves peak magnitude', () => {
    const pcm = new Int8Array([0, 127, -128, 0, 64, -64]);
    const out = downsamplePeaks(pcm, 2);
    expect(Math.abs(out[0]!)).toBeGreaterThan(0.9);
  });
});
