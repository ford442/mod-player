import { describe, expect, it } from 'vitest';
import {
  DB_FLOOR,
  dbToNormalized,
  linearToDb,
  onePoleStep,
  simulatePeakDecay,
  updatePeakHold,
} from '../components/channelMetersUtils';

describe('channelMetersUtils', () => {
  it('maps silence to DB_FLOOR and valid normalized range', () => {
    const silentDb = linearToDb(0);
    expect(Number.isFinite(silentDb)).toBe(true);
    expect(silentDb).toBe(DB_FLOOR);

    const silentNorm = dbToNormalized(silentDb);
    expect(Number.isFinite(silentNorm)).toBe(true);
    expect(silentNorm).toBeGreaterThanOrEqual(0);
  });

  it('maps quiet levels above zero on the normalized scale', () => {
    const quietNorm = dbToNormalized(linearToDb(0.003));
    expect(quietNorm).toBeGreaterThan(0);
  });

  it('decays peak hold consistently across refresh rates', () => {
    const elapsed = 1.0;
    const peak30 = simulatePeakDecay(30, elapsed);
    const peak144 = simulatePeakDecay(144, elapsed);
    expect(Math.abs(peak30 - peak144)).toBeLessThanOrEqual(0.5);
  });

  it('onePoleStep moves toward target with attack/release smoothing', () => {
    const attack = onePoleStep(0, 1, 1 / 60);
    expect(attack).toBeGreaterThan(0);
    expect(attack).toBeLessThan(1);

    const release = onePoleStep(1, 0, 1 / 60);
    expect(release).toBeLessThan(1);
    expect(release).toBeGreaterThan(0);
  });

  it('updatePeakHold instant attack then decays after hold window', () => {
    const instant = updatePeakHold(DB_FLOOR, 0, 0, 0, 1 / 60);
    expect(instant.peakDb).toBe(0);
    expect(instant.holdUntil).toBe(800);

    const held = updatePeakHold(0, DB_FLOOR, 500, 400, 1 / 60);
    expect(held.peakDb).toBe(0);

    const decayed = updatePeakHold(0, DB_FLOOR, 0, 900, 1 / 60);
    expect(decayed.peakDb).toBeLessThan(0);
    expect(decayed.peakDb).toBeGreaterThanOrEqual(DB_FLOOR);
  });
});
