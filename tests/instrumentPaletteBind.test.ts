import { describe, expect, it } from 'vitest';
import {
  generateEmptyInstrumentPalette,
  generateInstrumentPalette,
  instrumentPalettesEqual,
  MAX_INSTRUMENT_PALETTE_SIZE,
} from '../utils/instrumentPalette';

describe('instrumentPalettesEqual', () => {
  it('returns true for the same reference', () => {
    const palette = generateEmptyInstrumentPalette();
    expect(instrumentPalettesEqual(palette, palette)).toBe(true);
  });

  it('returns true for equal byte content in different arrays', () => {
    const a = generateEmptyInstrumentPalette();
    const b = generateEmptyInstrumentPalette();
    expect(a).not.toBe(b);
    expect(instrumentPalettesEqual(a, b)).toBe(true);
  });

  it('returns false when lengths differ', () => {
    const a = generateEmptyInstrumentPalette();
    const b = new Uint8Array(a.length - 4);
    expect(instrumentPalettesEqual(a, b)).toBe(false);
  });

  it('returns false when bytes differ', () => {
    const a = generateInstrumentPalette(4, ['kick', 'snare', 'hat', 'bass']);
    const b = new Uint8Array(a);
    b[0] = (b[0]! + 1) % 256;
    expect(instrumentPalettesEqual(a, b)).toBe(false);
  });

  it('returns false when either argument is nullish', () => {
    const palette = generateEmptyInstrumentPalette();
    expect(instrumentPalettesEqual(null, palette)).toBe(false);
    expect(instrumentPalettesEqual(palette, undefined)).toBe(false);
    expect(instrumentPalettesEqual(null, undefined)).toBe(false);
  });

  it('compares full palette size used by GPU upload', () => {
    const a = generateInstrumentPalette(MAX_INSTRUMENT_PALETTE_SIZE);
    const b = generateInstrumentPalette(MAX_INSTRUMENT_PALETTE_SIZE);
    expect(a.length).toBe(MAX_INSTRUMENT_PALETTE_SIZE * 4);
    expect(instrumentPalettesEqual(a, b)).toBe(true);
  });
});
