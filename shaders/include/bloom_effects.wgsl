#pragma once
// ============================================================
// bloom_effects.wgsl — Bloom intensity curves, glow kernels,
// kick-reactive flash, and film-grain dither.
//
// Include AFTER common.wgsl or bloom/core.wgsl.
// ============================================================

/// High-intensity boost: base + bloom * 2.0
fn bloomBoost(base: f32, bloom: f32) -> f32 {
  return base + bloom * 2.0;
}

/// Medium boost: base + bloom * 1.0
fn bloomBoostMedium(base: f32, bloom: f32) -> f32 {
  return base + bloom * 1.0;
}

/// Soft ambient boost: base + bloom * 0.2
fn bloomSoft(base: f32, bloom: f32) -> f32 {
  return base + bloom * 0.2;
}

/// Exponential radial glow kernel.
fn pointGlow(p: vec2<f32>, color: vec3<f32>, intensity: f32, falloff: f32) -> vec3<f32> {
  return color * intensity * exp(-length(p) * falloff);
}

/// Kick-reactive magenta bloom flash.
fn kickReactiveGlow(p: vec2<f32>, kick: f32, bloom: f32) -> vec3<f32> {
  let kickPulse = kick * exp(-length(p) * 3.0) * 0.3;
  return vec3<f32>(0.9, 0.2, 0.4) * kickPulse * bloom;
}

/// Film-grain dither to reduce banding in dark regions.
fn ditherNoise(uv: vec2<f32>, time: f32) -> f32 {
  let noise = fract(sin(dot(uv * time, vec2<f32>(12.9898, 78.233))) * 43758.5453);
  return (noise - 0.5) * 0.01;
}
