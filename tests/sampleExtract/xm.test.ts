import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WAVEFORM_POINTS } from '../../types/instruments';
import {
  decodeXmDeltaPcm,
  extractXmInstrumentTable,
} from '../../utils/sampleExtract/xm';
import { extractInstrumentTable } from '../../utils/sampleExtract';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_XM = join(__dirname, '../../public/test.xm');

function loadFixture(): Uint8Array {
  return new Uint8Array(readFileSync(FIXTURE_XM));
}

describe('sampleExtract/xm', () => {
  it('extracts instruments and samples from test.xm', () => {
    const table = extractXmInstrumentTable(loadFixture());
    expect(table.format).toBe('xm');
    expect(table.instruments.length).toBeGreaterThanOrEqual(1);
    expect(table.samples.length).toBeGreaterThanOrEqual(1);

    const pulse = table.samples.find((s) => s.name.includes('Pulse'));
    expect(pulse).toBeDefined();
    expect(pulse!.length).toBeGreaterThan(0);
    expect(pulse!.waveform).toHaveLength(WAVEFORM_POINTS);
    expect(pulse!.waveform.some((v) => v !== 0)).toBe(true);
  });

  it('maps instrument sample indices', () => {
    const table = extractXmInstrumentTable(loadFixture());
    const inst = table.instruments[0];
    expect(inst?.index).toBe(1);
    expect(inst?.sampleIndices.length).toBeGreaterThan(0);
  });

  it('extractInstrumentTable routes .xm files', () => {
    const table = extractInstrumentTable(loadFixture(), 'test.xm');
    expect(table.format).toBe('xm');
    expect(table.samples.length).toBeGreaterThan(0);
  });

  it('delta-decodes 8-bit XM PCM', () => {
    // Encoded deltas that integrate to [0, 64, 0, -64]
    const encoded = new Uint8Array([0, 64, 192, 192]); // 0, +64, -64, -64 → 0, 64, 0, -64
    const pcm = decodeXmDeltaPcm(encoded, 0, 4, false) as Int8Array;
    expect([...pcm]).toEqual([0, 64, 0, -64]);
  });
});
