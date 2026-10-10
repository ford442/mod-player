// lib/fx_chassis.wgsl — FX rack chassis lights (#453), included by bezel_fx.wgsl.
//
// The inputs are the rack's *settings* (smoothed on the CPU,
// audio/fx/fxVisualState.ts), not audio analysis — the spectrum bars are
// still drawn from the dry GPU FFT. Expects WINDOW_CENTER / WINDOW_RADII /
// WINDOW_MEAN_RADIUS from the including bezel.
//
//   drive   0…1  amber glow hugging the window rim (tape drive)
//   tone    0…1  plate colour temperature, 0.5 = neutral (EQ tilt)
//   room    0…1  a soft halo growing out of the window (room mix)
//   mask    bits character 1 · eq 2 · comp 4 · room 8 → four module LEDs

// Bottom-left corner of the plate (the window spans x ≈ 0.37…0.63 at this
// height), mirroring the top-corner buttons.
const FX_LED_COUNT: u32 = 4u;
const FX_LED_Y: f32 = 0.085;
const FX_LED_X0: f32 = 0.080;
const FX_LED_STEP: f32 = 0.040;
const FX_LED_RADIUS: f32 = 0.010;

fn fxLedColor(i: u32) -> vec3<f32> {
  switch i {
    case 0u: { return vec3<f32>(1.00, 0.55, 0.15); } // character — amber
    case 1u: { return vec3<f32>(0.30, 0.85, 1.00); } // eq — cyan
    case 2u: { return vec3<f32>(0.45, 1.00, 0.45); } // comp — green
    default: { return vec3<f32>(0.75, 0.55, 1.00); } // room — violet
  }
}

/// `plate` masks the bright chassis plate (0 over the window / lettering).
fn fxChassis(
  color: vec3<f32>,
  uv: vec2<f32>,
  plate: f32,
  drive: f32,
  tone: f32,
  room: f32,
  mask: u32,
  dim: f32,
) -> vec3<f32> {
  var c = color;
  let q = (uv - WINDOW_CENTER) / WINDOW_RADII;
  let dOut = (length(q) - 1.0) * WINDOW_MEAN_RADIUS; // uv units outside the rim

  // Tone: warm (highs cut) ↔ cool (highs boosted) tilt of the plate.
  let tilt = clamp((tone - 0.5) * 2.0, -1.0, 1.0);
  let tint = select(vec3<f32>(1.0, 0.90, 0.80), vec3<f32>(0.82, 0.92, 1.0), tilt > 0.0);
  c = mix(c, c * tint, abs(tilt) * 0.45 * plate);

  // Room: a soft violet halo, wider with more mix.
  let haloReach = 0.015 + room * 0.06;
  let halo = exp(-max(dOut, 0.0) / haloReach) * step(0.0, dOut) * room;
  c = mix(c, vec3<f32>(0.62, 0.50, 0.95), clamp(halo * 0.55, 0.0, 1.0) * plate);

  // Drive: an amber glow hugging the rim, brighter with drive.
  let rim = exp(-abs(dOut) * (220.0 - drive * 120.0)) * drive;
  c = mix(c, vec3<f32>(1.0, 0.58, 0.18), clamp(rim * 0.9, 0.0, 1.0) * plate);

  // Module LEDs along the bottom edge of the plate.
  for (var i = 0u; i < FX_LED_COUNT; i++) {
    let centre = vec2<f32>(FX_LED_X0 + FX_LED_STEP * f32(i), FX_LED_Y);
    let d = length(uv - centre) - FX_LED_RADIUS;
    let on = f32((mask >> i) & 1u);
    let body = 1.0 - smoothstep(-0.002, 0.002, d);
    let glow = exp(-max(d, 0.0) * 160.0) * on;
    let led = mix(vec3<f32>(0.18, 0.18, 0.2), fxLedColor(i), on);
    c = mix(c, led, body);
    c += fxLedColor(i) * glow * 0.35 * dim;
  }
  return c;
}
