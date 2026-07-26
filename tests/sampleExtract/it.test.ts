import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WAVEFORM_POINTS } from '../../types/instruments';
import { extractItInstrumentTable, isItModule } from '../../utils/sampleExtract/it';
import { extractInstrumentTable } from '../../utils/sampleExtract';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_IT = join(__dirname, '../fixtures/minimal.it');

function loadFixture(): Uint8Array {
  return new Uint8Array(readFileSync(FIXTURE_IT));
}

describe('sampleExtract/it', () => {
  it('detects IMPM magic', () => {
    expect(isItModule(loadFixture())).toBe(true);
  });

  it('extracts instrument + sample with waveform', () => {
    const table = extractItInstrumentTable(loadFixture());
    expect(table.format).toBe('it');
    expect(table.samples.length).toBeGreaterThanOrEqual(1);
    expect(table.instruments.length).toBeGreaterThanOrEqual(1);

    const sine = table.samples.find((s) => s.name.includes('Sine')) ?? table.samples[0];
    expect(sine).toBeDefined();
    expect(sine!.length).toBeGreaterThan(0);
    expect(sine!.waveform).toHaveLength(WAVEFORM_POINTS);
    expect(sine!.waveform.some((v) => v !== 0)).toBe(true);

    const inst = table.instruments[0];
    expect(inst?.sampleIndices.length).toBeGreaterThan(0);
  });

  it('extractInstrumentTable routes .it files', () => {
    const table = extractInstrumentTable(loadFixture(), 'minimal.it');
    expect(table.format).toBe('it');
    expect(table.samples.length).toBeGreaterThan(0);
  });
});
