//#include "lib/notes.wgsl"
fn pitchClassFromIndex(note: u32) -> f32 {
  if (note == 0u || note > NOTE_MAX) { return 0.0; }
  let semi = (note - 1u) % 12u;
  return f32(semi) / 12.0;
}

fn fifthsHue(note: u32) -> f32 {
  if (note == 0u || note > NOTE_MAX) { return 0.0; }
  let semi = (note - 1u) % 12u;
  let cof  = (semi * 7u) % 12u;
  return f32(cof) / 12.0;
}

fn octaveBrightness(note: u32) -> f32 {
  if (note == 0u || note > NOTE_MAX) { return 1.0; }
  let oct = (note - 1u) / 12u;
  return 0.65 + 0.35 * f32(oct) / 9.0;
}

fn pitchHueForPalette(note: u32, paletteId: u32) -> f32 {
  if (paletteId == 5u) { return fifthsHue(note); }
  return pitchClassFromIndex(note);
}

fn neonPalette(t: f32) -> vec3<f32> {
  let a = vec3<f32>(0.5, 0.5, 0.5);
  let b = vec3<f32>(0.5, 0.5, 0.5);
  let c = vec3<f32>(1.0, 1.0, 1.0);
  let d = vec3<f32>(0.0, 0.33, 0.67);
  return a + b * cos(6.28318 * (c * t + d));
}
