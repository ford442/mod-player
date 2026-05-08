#pragma once
// ============================================================
// duration_system.wgsl — Note Duration Unpacking (DURA)
//                        and three-emitter intensity logic.
//
// Include AFTER common.wgsl or bloom/core.wgsl.
// ============================================================

// ── Note Duration Info (DURA) ──

struct NoteDurationInfo {
  duration: u32,    // Total note duration in rows
  rowOffset: u32,   // Rows from note start (0 = note-on)
  isNoteOff: bool,  // Whether this cell is the note-off row
};

/// Unpack duration metadata from the high-precision packed cell format.
/// Duration lives in bits 8-15 of packedA.
/// rowOffset + isNoteOff live in bits 8-14 of packedB.
fn unpackDurationInfo(packedA: u32, packedB: u32) -> NoteDurationInfo {
  var info: NoteDurationInfo;

  info.duration = (packedA >> 8) & 0xFFu;
  if (info.duration == 0u) { info.duration = 1u; }

  let durationFlags = (packedB >> 8) & 0x7Fu;
  info.rowOffset = durationFlags >> 1u;
  info.isNoteOff = (durationFlags & 1u) != 0u;

  return info;
}

/// Compute sustain-tail brightness based on position within a note.
///   • Note-on row  → full baseIntensity
///   • Last 3 rows  → fade from 60% → 30%
///   • Middle       → 40–60% (slight decay toward the end)
fn calculateSustainBrightness(info: NoteDurationInfo, baseIntensity: f32) -> f32 {
  if (info.duration <= 1u) {
    return baseIntensity;
  }

  let progress = f32(info.rowOffset) / f32(info.duration);

  if (info.rowOffset == 0u) {
    return baseIntensity;
  }

  let remaining = info.duration - info.rowOffset;
  if (remaining <= 3u) {
    let fadeFactor = f32(remaining) / 3.0;
    return baseIntensity * (0.3 + 0.3 * fadeFactor);
  }

  return baseIntensity * (0.4 + 0.2 * (1.0 - progress));
}

// ── Three-Emitter Intensity Logic ──

/// Calculate the TOP emitter intensity (blue note-on / amber expression).
fn calculateTopIntensity(
  isNoteOn: bool,
  isExprOnly: bool,
  isSustain: bool,
  isMuted: bool,
  trigger: u32,
  bloom: f32,
  beat: f32
) -> f32 {
  var intensity = 0.0;
  if (isNoteOn) {
    intensity = 1.0 + bloom * 2.0;
    if (trigger > 0u) {
      intensity += beat * 0.3;
    }
  } else if (isExprOnly) {
    intensity = 1.0 + bloom * 2.0;
  } else if (isSustain) {
    intensity = 0.1 + bloom * 0.2;
  }
  if (isMuted) { intensity *= 0.2; }
  return intensity;
}
