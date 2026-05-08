// ============================================================
// bloom_utils.wgsl — Bloom intensity curves and glow kernels.
//
// Include AFTER common.wgsl. Provides reusable helpers for
// applying the global bloomIntensity uniform to emitter
// brightness and for radial glow falloff.
// ============================================================

/// High-intensity boost curve used for active LED emitters.
/// Equivalent to: base + bloom * 2.0
fn bloomBoost(base: f32, bloom: f32) -> f32 {
  return base + bloom * 2.0;
}

/// Medium boost for sustain states or secondary emitters.
/// Equivalent to: base + bloom * 1.0
fn bloomBoostMedium(base: f32, bloom: f32) -> f32 {
  return base + bloom * 1.0;
}

/// Soft ambient boost for dim / idle states.
/// Equivalent to: base + bloom * 0.2
fn bloomSoft(base: f32, bloom: f32) -> f32 {
  return base + bloom * 0.2;
}

/// Exponential radial glow kernel.
/// Returns color * intensity * exp(-distance * falloff).
fn pointGlow(p: vec2<f32>, color: vec3<f32>, intensity: f32, falloff: f32) -> vec3<f32> {
  return color * intensity * exp(-length(p) * falloff);
}

/// Kick-reactive bloom flash.
/// Returns a magenta-tinged pulse centred at the origin
/// that scales with both kick strength and bloom intensity.
fn kickReactiveGlow(p: vec2<f32>, kick: f32, bloom: f32) -> vec3<f32> {
  let kickPulse = kick * exp(-length(p) * 3.0) * 0.3;
  return vec3<f32>(0.9, 0.2, 0.4) * kickPulse * bloom;
}

/// Simple film-grain dither to reduce banding in dark regions.
fn ditherNoise(uv: vec2<f32>, time: f32) -> f32 {
  let noise = fract(sin(dot(uv * time, vec2<f32>(12.9898, 78.233))) * 43758.5453);
  return (noise - 0.5) * 0.01;
}
