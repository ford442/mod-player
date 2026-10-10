/** Small shared conversions for the FX rack (#453). */
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}
