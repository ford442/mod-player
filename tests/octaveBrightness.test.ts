import { describe, expect, it } from 'vitest';

const NOTE_MAX = 119;

/** Mirrors patternv0.50.wgsl `octaveBrightness` verbatim. */
function octaveBrightness(note: number): number {
  if (note === 0 || note > NOTE_MAX) {
    return 1.0;
  }
  const oct = Math.floor((note - 1) / 12);
  return 0.65 + (0.35 * oct) / 9.0;
}

describe('octaveBrightness', () => {
  it('matches reference anchors from acceptance criteria', () => {
    expect(octaveBrightness(1)).toBeCloseTo(0.65, 3);
    expect(octaveBrightness(13)).toBeCloseTo(0.689, 3);
    expect(octaveBrightness(109)).toBeCloseTo(1.0, 3);
  });

  it('returns 1.0 for empty / note-off guards', () => {
    expect(octaveBrightness(0)).toBe(1.0);
    expect(octaveBrightness(120)).toBe(1.0);
    expect(octaveBrightness(255)).toBe(1.0);
  });

  it('dims lower octaves less than higher octaves for same pitch class', () => {
    expect(octaveBrightness(25)).toBeLessThan(octaveBrightness(49));
  });
});
