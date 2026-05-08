#pragma once
// ============================================================
// sdf_primitives.wgsl — Signed-distance field primitives.
//
// Include AFTER common.wgsl or bloom/core.wgsl.
// No bindings or uniforms are declared here.
// ============================================================

/// Signed distance to a rounded rectangle.
fn sdRoundedBox(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
  let q = abs(p) - b + r;
  return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

/// Signed distance to a circle.
fn sdCircle(p: vec2<f32>, r: f32) -> f32 {
  return length(p) - r;
}

/// Signed distance to an ellipse.
fn sdEllipse(p: vec2<f32>, ab: vec2<f32>) -> f32 {
  let k = length(p / ab);
  return (k - 1.0) * min(ab.x, ab.y);
}

/// Signed distance to an axis-aligned box.
fn sdBox(p: vec2<f32>, b: vec2<f32>) -> f32 {
  let d = abs(p) - b;
  return length(max(d, vec2<f32>(0.0))) + min(max(d.x, d.y), 0.0);
}

/// Signed distance to an equilateral triangle (pointing up).
fn sdTriangle(p: vec2<f32>, r: f32) -> f32 {
  let k = sqrt(3.0);
  var p2 = p;
  p2.x = abs(p2.x) - r;
  p2.y = p2.y + r / k;
  if (p2.x + k * p2.y > 0.0) { p2 = vec2<f32>(p2.x - k * p2.y, -k * p2.x - p2.y) / 2.0; }
  p2.x = p2.x - clamp(p2.x, -2.0 * r, 0.0);
  return -length(p2) * sign(p2.y);
}
