// ============================================================
// bloom/chrome.wgsl — Chrome dome indicator with bezel,
// lens optics, and dimming support.
//
// This is the evolved v0.35 drawChromeIndicator (with early-out
// bounding-box and dimFactor) shared across all bloom presets.
// Requires bloom/core.wgsl and bloom/math.wgsl before this file.
// ============================================================

struct FragmentConstants {
  bgColor: vec3<f32>,
  ledOnColor: vec3<f32>,
  ledOffColor: vec3<f32>,
  borderColor: vec3<f32>,
  housingSize: vec2<f32>,
};

/// Cyan/Teal chrome palette from the v0.35 bloom family.
fn getFragmentConstants() -> FragmentConstants {
  var c: FragmentConstants;
  c.bgColor = vec3<f32>(0.15, 0.16, 0.18);
  c.ledOnColor = vec3<f32>(0.0, 0.85, 0.95);
  c.ledOffColor = vec3<f32>(0.08, 0.08, 0.10);
  c.borderColor = vec3<f32>(0.0, 0.0, 0.0);
  c.housingSize = vec2<f32>(0.92, 0.92);
  return c;
}

/// Chrome dome + bezel indicator. Supports dimming via dimFactor.
/// dimFactor=1.0 leaves chrome at full brightness;
/// dimFactor<1.0 darkens housing and off-state lens.
fn drawChromeIndicator(
    uv: vec2<f32>,
    size: vec2<f32>,
    color: vec3<f32>,
    isOn: bool,
    aa: f32,
    dimFactor: f32
) -> vec4<f32> {
  // Early-out bounding box for performance
  if (abs(uv.x) > size.x * 0.6 || abs(uv.y) > size.y * 0.6) {
    return vec4<f32>(0.0);
  }

  let uv01 = (uv / size) + vec2<f32>(0.5);
  let lensR = 0.7;
  let bezelR = 0.9;
  let center = vec2<f32>(0.5, 0.5);
  let dist = length(uv01 - center) * 2.0;

  var col = vec3<f32>(0.0);
  var alpha = 0.0;

  if (dist < bezelR) {
    if (dist > lensR) {
      // Bezel ring
      let angle = atan2(uv01.y - center.y, uv01.x - center.x);
      let rim = 0.2 + 0.8 * abs(sin(angle * 10.0));
      col = vec3<f32>(0.25, 0.28, 0.30) * rim * dimFactor;
      alpha = 1.0;
    } else {
      // Glass lens
      let lensNormR = dist / lensR;
      let z = sqrt(max(0.0, 1.0 - lensNormR * lensNormR));
      let localXY = (uv01 - center) / lensR;
      let normal = normalize(vec3<f32>(localXY.x, localXY.y, z));
      let lightDir = normalize(vec3<f32>(-0.5, 0.5, 1.0));
      let diffuse = max(0.0, dot(normal, lightDir));
      let reflectDir = reflect(-lightDir, normal);
      let specular = pow(max(0.0, dot(reflectDir, vec3<f32>(0.0, 0.0, 1.0))), 10.0);

      let baseColor = color * dimFactor;
      col = baseColor * (0.5 + 0.8 * diffuse);
      col += vec3<f32>(1.0) * specular * 0.5 * dimFactor;

      // Inner bloom rim glow
      let rimGlow = exp(-pow(lensNormR, 2.0) * 6.0);
      col += baseColor * rimGlow * 0.25;
      alpha = 1.0;
    }
  } else {
    return vec4<f32>(vec3<f32>(0.0), 0.0);
  }

  let vignette = smoothstep(bezelR * 0.95, bezelR, dist);
  col = mix(col * (1.0 - 0.08 * vignette), vec3<f32>(0.02) * dimFactor, vignette);

  return vec4<f32>(col, alpha);
}
