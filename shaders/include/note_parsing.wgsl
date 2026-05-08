#pragma once
// ============================================================
// note_parsing.wgsl — Note and effect parsing helpers.
//
// Include AFTER common.wgsl or bloom/core.wgsl.
// ============================================================

/// Convert an ASCII character to uppercase (A–Z / a–z only).
fn toUpperAscii(code: u32) -> u32 {
  if (code >= 97u && code <= 122u) {
    return code - 32u;
  }
  return code;
}

/// Map an ASCII-packed note representation to a pitch-class hue [0,1).
/// Used by high-precision shaders where the note is stored as ASCII
/// characters in the upper bytes of packedA.
fn pitchClassFromPacked(packed: u32) -> f32 {
  let c0 = toUpperAscii((packed >> 24) & 255u);
  var semitone: i32 = 0;
  var valid = true;
  switch (c0) {
    case 65u: { semitone = 9; }   // A
    case 66u: { semitone = 11; }  // B
    case 67u: { semitone = 0; }   // C
    case 68u: { semitone = 2; }   // D
    case 69u: { semitone = 4; }   // E
    case 70u: { semitone = 5; }   // F
    case 71u: { semitone = 7; }   // G
    default: { valid = false; }
  }
  if (!valid) { return 0.0; }
  let c1 = toUpperAscii((packed >> 16) & 255u);
  if ((c1 == 35u) || (c1 == 43u)) {        // # or +
    semitone = (semitone + 1) % 12;
  } else if (c1 == 66u) {                  // b (flat)
    semitone = (semitone + 11) % 12;
  }
  return f32(semitone) / 12.0;
}

/// Convert an effect command code (ASCII) to a tinted color.
fn effectColorFromCode(code: u32, fallback: vec3<f32>) -> vec3<f32> {
  let c = toUpperAscii(code & 255u);
  switch c {
    case 49u: { return mix(fallback, vec3<f32>(0.2, 0.85, 0.4), 0.75); } // 1xx Porta Up — Green
    case 50u: { return mix(fallback, vec3<f32>(0.85, 0.3, 0.3), 0.75); } // 2xx Porta Down — Red
    case 52u: { return mix(fallback, vec3<f32>(0.4, 0.7, 1.0), 0.6); }  // 4xx Vibrato — Blue
    case 55u: { return mix(fallback, vec3<f32>(0.9, 0.6, 0.2), 0.6); }  // 7xx Tremolo — Orange
    case 65u: { return mix(fallback, vec3<f32>(0.95, 0.9, 0.25), 0.7); } // Axx VolSlide — Yellow
    default:  { return fallback; }
  }
}
