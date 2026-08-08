/**
 * Tests for accessibility palette utilities (utils/accessiblePalettes.ts).
 */
import { describe, expect, it } from 'vitest';
import {
  PALETTE_DEFAULT,
  PALETTE_DEUTAN,
  PALETTE_TRITAN,
  PALETTE_MONO,
  CVD_PALETTES,
  CVD_PALETTE_NAMES,
  getCvdPalette,
} from '../utils/accessiblePalettes';

const SEMITONES = 12;
const BYTES_PER_ENTRY = 4; // RGBA

describe('accessiblePalettes', () => {
  it('each palette has exactly SEMITONES * 4 bytes', () => {
    for (const palette of [PALETTE_DEFAULT, PALETTE_DEUTAN, PALETTE_TRITAN, PALETTE_MONO]) {
      expect(palette.byteLength).toBe(SEMITONES * BYTES_PER_ENTRY);
      expect(palette.length).toBe(SEMITONES * BYTES_PER_ENTRY);
    }
  });

  it('all alpha channels are 255', () => {
    for (const palette of [PALETTE_DEFAULT, PALETTE_DEUTAN, PALETTE_TRITAN, PALETTE_MONO]) {
      for (let i = 0; i < SEMITONES; i++) {
        expect(palette[i * 4 + 3]).toBe(255);
      }
    }
  });

  it('all RGB values are in [0, 255]', () => {
    for (const palette of [PALETTE_DEFAULT, PALETTE_DEUTAN, PALETTE_TRITAN, PALETTE_MONO]) {
      for (let i = 0; i < palette.length; i++) {
        const v = palette[i]!;
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(255);
      }
    }
  });

  it('CVD_PALETTES contains all 4 entries', () => {
    expect(Object.keys(CVD_PALETTES)).toHaveLength(4);
    expect(CVD_PALETTES[0]).toBe(PALETTE_DEFAULT);
    expect(CVD_PALETTES[1]).toBe(PALETTE_DEUTAN);
    expect(CVD_PALETTES[2]).toBe(PALETTE_TRITAN);
    expect(CVD_PALETTES[3]).toBe(PALETTE_MONO);
  });

  it('CVD_PALETTE_NAMES has 4 entries', () => {
    expect(CVD_PALETTE_NAMES).toHaveLength(4);
  });

  it('getCvdPalette returns correct palette for each valid id', () => {
    expect(getCvdPalette(0)).toBe(PALETTE_DEFAULT);
    expect(getCvdPalette(1)).toBe(PALETTE_DEUTAN);
    expect(getCvdPalette(2)).toBe(PALETTE_TRITAN);
    expect(getCvdPalette(3)).toBe(PALETTE_MONO);
  });

  it('getCvdPalette falls back to default for unknown id', () => {
    expect(getCvdPalette(99)).toBe(PALETTE_DEFAULT);
    expect(getCvdPalette(-1)).toBe(PALETTE_DEFAULT);
  });

  it('PALETTE_MONO has evenly spaced luminance values', () => {
    // All three channels equal (monochrome)
    for (let i = 0; i < SEMITONES; i++) {
      const r = PALETTE_MONO[i * 4 + 0]!;
      const g = PALETTE_MONO[i * 4 + 1]!;
      const b = PALETTE_MONO[i * 4 + 2]!;
      expect(r).toBe(g);
      expect(g).toBe(b);
    }
  });

  it('PALETTE_DEUTAN avoids pure red and pure green distinctions', () => {
    // Check that none of the entries are pure green (0, 255, 0)
    // which would be invisible to deuteranopes
    for (let i = 0; i < SEMITONES; i++) {
      const r = PALETTE_DEUTAN[i * 4 + 0]!;
      const g = PALETTE_DEUTAN[i * 4 + 1]!;
      const b = PALETTE_DEUTAN[i * 4 + 2]!;
      // Not pure red or pure green (ambiguous for deuteranopes)
      expect(r === 255 && g === 0 && b === 0).toBe(false);
      expect(r === 0 && g === 255 && b === 0).toBe(false);
    }
  });
});
