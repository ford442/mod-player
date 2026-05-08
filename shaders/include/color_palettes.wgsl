#pragma once
// ============================================================
// color_palettes.wgsl — Color palette and pitch-class helpers.
//
// Include AFTER common.wgsl or bloom/core.wgsl (needs TAU).
// ============================================================

/// Select a color palette by ID (0–4). All palettes use the same
/// cosine gradient basis with different phase offsets.
fn selectPalette(id: u32, t: f32) -> vec3<f32> {
  let a = vec3<f32>(0.5, 0.5, 0.5);
  let b = vec3<f32>(0.5, 0.5, 0.5);
  let c = vec3<f32>(1.0, 1.0, 1.0);
  if (id == 1u) {
    // Warm: reds, oranges, yellows
    return a + b * cos(TAU * (c * t + vec3<f32>(0.0, 0.1, 0.2)));
  } else if (id == 2u) {
    // Cool: blues, cyans, purples
    return a + b * cos(TAU * (c * t + vec3<f32>(0.5, 0.7, 0.9)));
  } else if (id == 3u) {
    // Neon: pink, cyan, green
    return a + b * cos(TAU * (c * t + vec3<f32>(0.0, 0.5, 1.0)));
  } else if (id == 4u) {
    // Acid: green, yellow, chartreuse
    return a + b * cos(TAU * (c * t + vec3<f32>(0.3, 0.0, 0.7)));
  }
  // Default palette 0: Rainbow
  return a + b * cos(TAU * (c * t + vec3<f32>(0.0, 0.33, 0.67)));
}

/// Classic rainbow cosine gradient. Equivalent to selectPalette(0u, t).
fn neonPalette(t: f32) -> vec3<f32> {
  return selectPalette(0u, t);
}

/// Map a tracker note index (1–119) to a pitch-class hue [0,1).
fn pitchClassFromIndex(note: u32) -> f32 {
  if (note == 0u || note >= NOTE_OFF_MIN) { return 0.0; }
  let semi = (note - 1u) % 12u;
  return f32(semi) / 12.0;
}
