// Brilliant LED Core + Halo split (v0.50 trap lens).
fn brilliantLEDCore(dist: f32, pitchColor: vec3<f32>, intensity: f32) -> vec3<f32> {
  let core = pow(dist, 16.0) * intensity * 1.8;
  let halo = pow(dist, 2.0)  * intensity * pitchColor;
  return vec3<f32>(core) + halo;
}
