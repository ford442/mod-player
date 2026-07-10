fn selectPalette(id: u32, t: f32) -> vec3<f32> {
  let a = vec3<f32>(0.5, 0.5, 0.5);
  let b = vec3<f32>(0.5, 0.5, 0.5);
  let c = vec3<f32>(1.0, 1.0, 1.0);
  if (id == 1u) {
    // Warm: reds, oranges, yellows
    return a + b * cos(6.28318 * (c * t + vec3<f32>(0.0, 0.1, 0.2)));
  } else if (id == 2u) {
    // Cool: blues, cyans, purples
    return a + b * cos(6.28318 * (c * t + vec3<f32>(0.5, 0.7, 0.9)));
  } else if (id == 3u) {
    // Neon: pink, cyan, green
    return a + b * cos(6.28318 * (c * t + vec3<f32>(0.0, 0.5, 1.0)));
  } else if (id == 4u) {
    // Acid: green, yellow, chartreuse
    return a + b * cos(6.28318 * (c * t + vec3<f32>(0.3, 0.0, 0.7)));
  } else if (id == 5u) {
    // Circle of Fifths: fully-saturated HSV wheel — t is used directly as hue.
    let h6  = t * 6.0;
    let hi  = u32(h6) % 6u;
    let f   = h6 - floor(h6);
    let q   = 1.0 - f;
    if      (hi == 0u) { return vec3<f32>(1.0, f,   0.0); }
    else if (hi == 1u) { return vec3<f32>(q,   1.0, 0.0); }
    else if (hi == 2u) { return vec3<f32>(0.0, 1.0, f  ); }
    else if (hi == 3u) { return vec3<f32>(0.0, q,   1.0); }
    else if (hi == 4u) { return vec3<f32>(f,   0.0, 1.0); }
    else               { return vec3<f32>(1.0, 0.0, q  ); }
  }
  // Default palette 0: Rainbow
  return a + b * cos(6.28318 * (c * t + vec3<f32>(0.0, 0.33, 0.67)));
}
