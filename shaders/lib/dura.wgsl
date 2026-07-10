// DURA: Structure to hold unpacked note duration info
struct NoteDurationInfo {
  duration: u32,
  rowOffset: u32,
  isNoteOff: bool,
  isTrigger: bool,
}

fn unpackDurationInfo(packedA: u32, packedB: u32) -> NoteDurationInfo {
  var info: NoteDurationInfo;
  info.duration = (packedA >> 8) & 0xFFu;
  if (info.duration == 0u) { info.duration = 1u; }
  let durationFlags = (packedB >> 8) & 0x7Fu;
  info.rowOffset = durationFlags >> 1u;
  info.isNoteOff = (durationFlags & 1u) != 0u;
  info.isTrigger = ((packedB & 0x8000u) != 0u) || (info.rowOffset == 0u && !info.isNoteOff);
  return info;
}

fn calculateSustainBrightness(info: NoteDurationInfo, baseIntensity: f32) -> f32 {
  if (info.duration <= 1u) { return baseIntensity; }
  let progress = f32(info.rowOffset) / f32(info.duration);
  if (info.rowOffset == 0u) { return baseIntensity; }
  let remaining = info.duration - info.rowOffset;
  if (remaining <= 3u) {
    let fadeFactor = f32(remaining) / 3.0;
    return baseIntensity * (0.3 + 0.3 * fadeFactor);
  }
  return baseIntensity * (0.4 + 0.2 * (1.0 - progress));
}
