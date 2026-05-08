// ============================================================
// bloom/math.wgsl — SDF primitives, palettes, and note helpers
// for the unified bloom pattern system.
//
// Requires bloom/core.wgsl to be included first.
// ============================================================

// --- SDF Primitives ---
fn sdRoundedBox(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
  let q = abs(p) - b + r;
  return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

// --- Palette Helpers ---
fn neonPalette(t: f32) -> vec3<f32> {
  let a = vec3<f32>(0.5, 0.5, 0.5);
  let b = vec3<f32>(0.5, 0.5, 0.5);
  let c = vec3<f32>(1.0, 1.0, 1.0);
  let d = vec3<f32>(0.0, 0.33, 0.67);
  return a + b * cos(TAU * (c * t + d));
}

/// Map a tracker note index (1–119) to a pitch-class hue [0,1).
fn pitchClassFromIndex(note: u32) -> f32 {
  if (note == 0u || note >= NOTE_OFF_MIN) { return 0.0; }
  let semi = (note - 1u) % 12u;
  return f32(semi) / 12.0;
}

/// Convert an effect command code (ASCII) to a tinted color.
fn effectColorFromCode(code: u32, fallback: vec3<f32>) -> vec3<f32> {
  let c = code & 255u;
  switch c {
    case 49u: { return mix(fallback, vec3<f32>(0.2, 0.85, 0.4), 0.75); } // 1xx Porta Up — Green
    case 50u: { return mix(fallback, vec3<f32>(0.85, 0.3, 0.3), 0.75); } // 2xx Porta Down — Red
    case 52u: { return mix(fallback, vec3<f32>(0.4, 0.7, 1.0), 0.6); }  // 4xx Vibrato — Blue
    case 55u: { return mix(fallback, vec3<f32>(0.9, 0.6, 0.2), 0.6); }  // 7xx Tremolo — Orange
    case 65u: { return mix(fallback, vec3<f32>(0.95, 0.9, 0.25), 0.7); } // Axx VolSlide — Yellow
    default:  { return fallback; }
  }
}
