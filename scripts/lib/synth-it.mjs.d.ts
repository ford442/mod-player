/** Deterministic, audible synthetic IT with `channels` voices (1..64); `sampleFrames` sets the file size. */
export function synthIt(
  channels: number,
  opts?: { sampleFrames?: number; patterns?: number; rows?: number; seed?: number },
): Uint8Array;
