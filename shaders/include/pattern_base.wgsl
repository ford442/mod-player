// ============================================================
// pattern_base.wgsl — Core pattern generation and LED logic.
//
// Include AFTER common.wgsl (and optionally bloom_utils.wgsl).
// Defines:
//   • Note duration unpacking (DURA)
//   • Cell-type classification helpers
//   • Three-emitter LED intensity calculations
//   • Fragment constants
//   • drawEmitterDiode & drawUnifiedLensCap
//
// The main shader only needs to supply its own @fragment fn fs().
// ============================================================

// ── Note Duration Info (DURA) ──

struct NoteDurationInfo {
  duration: u32,    // Total note duration in rows
  rowOffset: u32,   // Rows from note start (0 = note-on)
  isNoteOff: bool,  // Whether this cell is the note-off row
};

/// Unpack duration metadata from the high-precision packed cell format.
/// Duration lives in bits 8-15 of packedA.
/// rowOffset + isNoteOff live in bits 8-14 of packedB.
fn unpackDurationInfo(packedA: u32, packedB: u32) -> NoteDurationInfo {
  var info: NoteDurationInfo;

  info.duration = (packedA >> 8) & 0xFFu;
  if (info.duration == 0u) { info.duration = 1u; }

  let durationFlags = (packedB >> 8) & 0x7Fu;
  info.rowOffset = durationFlags >> 1u;
  info.isNoteOff = (durationFlags & 1u) != 0u;

  return info;
}

/// Compute sustain-tail brightness based on position within a note.
///   • Note-on row  → full baseIntensity
///   • Last 3 rows  → fade from 60% → 30%
///   • Middle       → 40–60% (slight decay toward the end)
fn calculateSustainBrightness(info: NoteDurationInfo, baseIntensity: f32) -> f32 {
  if (info.duration <= 1u) {
    return baseIntensity;
  }

  let progress = f32(info.rowOffset) / f32(info.duration);

  if (info.rowOffset == 0u) {
    return baseIntensity;
  }

  let remaining = info.duration - info.rowOffset;
  if (remaining <= 3u) {
    let fadeFactor = f32(remaining) / 3.0;
    return baseIntensity * (0.3 + 0.3 * fadeFactor);
  }

  return baseIntensity * (0.4 + 0.2 * (1.0 - progress));
}

// ── Three-Emitter Intensity Logic ──

/// Calculate the TOP emitter intensity (blue note-on / amber expression).
fn calculateTopIntensity(
  isNoteOn: bool,
  isExprOnly: bool,
  isSustain: bool,
  isMuted: bool,
  trigger: u32,
  bloom: f32,
  beat: f32
) -> f32 {
  var intensity = 0.0;
  if (isNoteOn) {
    intensity = 1.0 + bloom * 2.0;
    if (trigger > 0u) {
      intensity += beat * 0.3;
    }
  } else if (isExprOnly) {
    intensity = 1.0 + bloom * 2.0;
  } else if (isSustain) {
    intensity = 0.1 + bloom * 0.2;
  }
  if (isMuted) { intensity *= 0.2; }
  return intensity;
}

// ── Fragment Constants ──

struct FragmentConstants {
  bgColor: vec3<f32>,
  ledOnColor: vec3<f32>,
  ledOffColor: vec3<f32>,
  borderColor: vec3<f32>,
  housingSize: vec2<f32>,
};

/// Blue/Orange trap palette: primary indicator is warm orange.
fn getFragmentConstants() -> FragmentConstants {
  var c: FragmentConstants;
  c.bgColor = GLASS_BG;
  c.ledOnColor = vec3<f32>(1.0, 0.55, 0.1);
  c.ledOffColor = DIODE_HOUSING;
  c.borderColor = vec3<f32>(0.0, 0.0, 0.0);
  c.housingSize = vec2<f32>(0.92, 0.92);
  return c;
}

// ── Emitter Diode Shape ──

/// Draw a single LED emitter (rounded box die + housing).
/// Returns RGBA where alpha is the diode mask.
fn drawEmitterDiode(uv: vec2<f32>, intensity: f32, color: vec3<f32>, isOn: bool) -> vec4<f32> {
  let diodeSize = vec2<f32>(0.28, 0.14);

  let p = uv;
  let dDiode = sdRoundedBox(p, diodeSize * 0.5, 0.06);

  // Smaller "die" inside the diode for a distinct dot appearance
  let dieSize = vec2<f32>(0.10, 0.05);
  let dDie = sdRoundedBox(p, dieSize * 0.5, 0.02);

  let diodeMask = 1.0 - smoothstep(0.0, 0.015, dDiode);
  let dieMask = 1.0 - smoothstep(0.0, 0.008, dDie);

  var diodeColor = DIODE_HOUSING;

  if (isOn) {
    let dieGlow = color * (1.0 + intensity * 4.0);
    let housingGlow = color * 0.12 * intensity;
    diodeColor = mix(housingGlow, dieGlow, dieMask);
    let hotspot = exp(-length(p / vec2<f32>(0.06, 0.03)) * 2.5) * intensity;
    diodeColor += color * hotspot * 0.6;
  }

  return vec4<f32>(diodeColor, diodeMask);
}

// ── Unified Three-Emitter Lens Cap ──

/// Single glass surface covering three vertical emitters (top, mid, bot).
/// Creates optical effects: refraction, fresnel reflection, subsurface
/// scattering, and per-emitter fringe glow.
fn drawUnifiedLensCap(
    uv: vec2<f32>,
    lensSize: vec2<f32>,
    topEmitter: vec4<f32>,    // rgb=color, a=intensity (Blue note-on)
    midEmitter: vec4<f32>,    // rgb=color, a=intensity (Note color)
    botEmitter: vec4<f32>,    // rgb=color, a=intensity (Amber control)
    aa: f32
) -> vec4<f32> {
  let p = uv;
  let dBox = sdRoundedBox(p, lensSize * 0.5, 0.12);

  if (dBox > 0.0) {
    return vec4<f32>(0.0);
  }

  // Emitter positions under the lens (vertical arrangement)
  let topPos = vec2<f32>(0.0, -0.28);
  let midPos = vec2<f32>(0.0, 0.0);
  let botPos = vec2<f32>(0.0, 0.28);

  // Glass surface properties
  let radial = length(p / (lensSize * 0.5));
  let edgeThickness = 0.18 + radial * 0.12;
  let centerThickness = 0.06;
  let thickness = mix(centerThickness, edgeThickness, radial * radial);

  let n = normalize(vec3<f32>(p.x * 2.5 / lensSize.x, p.y * 2.5 / lensSize.y, 0.35));
  let viewDir = vec3<f32>(0.0, 0.0, 1.0);
  let fresnel = pow(1.0 - abs(dot(n, viewDir)), 2.5);

  // Draw individual emitters under the lens
  let topDiode = drawEmitterDiode(uv - topPos, topEmitter.a, topEmitter.rgb, topEmitter.a > 0.05);
  let midDiode = drawEmitterDiode(uv - midPos, midEmitter.a, midEmitter.rgb, midEmitter.a > 0.05);
  let botDiode = drawEmitterDiode(uv - botPos, botEmitter.a, botEmitter.rgb, botEmitter.a > 0.05);

  // Composite emitters back-to-front
  var combinedDiode = DIODE_HOUSING;
  if (botDiode.a > 0.0) {
    combinedDiode = mix(combinedDiode, botDiode.rgb, botDiode.a);
  }
  if (midDiode.a > 0.0) {
    combinedDiode = mix(combinedDiode, midDiode.rgb, midDiode.a);
  }
  if (topDiode.a > 0.0) {
    combinedDiode = mix(combinedDiode, topDiode.rgb, topDiode.a);
  }
  let diodeMask = max(max(topDiode.a, midDiode.a), botDiode.a);

  // Refraction offset
  let refractionStrength = (1.0 - radial * 0.6) * 0.04;
  let refractOffset = p * refractionStrength;

  // Subsurface scattering — per-emitter with tightened falloffs
  var subsurfaceGlow = vec3<f32>(0.0);

  let distTop = length(uv - topPos - refractOffset * 0.3);
  let scatterTop = exp(-distTop * 9.0) * topEmitter.a;
  subsurfaceGlow += topEmitter.rgb * scatterTop * 2.2;

  let distMid = length(uv - midPos - refractOffset * 0.5);
  let scatterMid = exp(-distMid * 7.5) * midEmitter.a;
  subsurfaceGlow += midEmitter.rgb * scatterMid * 3.0;

  let distBot = length(uv - botPos - refractOffset * 0.3);
  let scatterBot = exp(-distBot * 9.0) * botEmitter.a;
  subsurfaceGlow += botEmitter.rgb * scatterBot * 2.2;

  // Per-emitter fringe glow (replaces shared diffusion that smeared all three)
  subsurfaceGlow += topEmitter.rgb * exp(-distTop * 6.0) * topEmitter.a * 0.15;
  subsurfaceGlow += midEmitter.rgb * exp(-distMid * 6.0) * midEmitter.a * 0.15;
  subsurfaceGlow += botEmitter.rgb * exp(-distBot * 6.0) * botEmitter.a * 0.15;

  // Active color tint for the glass body
  var activeColor = midEmitter.rgb * midEmitter.a;
  activeColor = mix(activeColor, topEmitter.rgb, topEmitter.a * 0.5);
  activeColor = mix(activeColor, botEmitter.rgb, botEmitter.a * 0.5);

  let totalGlow = topEmitter.a + midEmitter.a + botEmitter.a;
  let litTint = mix(vec3<f32>(0.92, 0.93, 0.98), activeColor, min(totalGlow * 0.4, 0.4));
  let glassBaseColor = mix(GLASS_BG * 0.12, litTint, 0.88);

  // Edge alpha
  let edgeAlpha = smoothstep(0.0, aa * 2.0, -dBox);

  // Glass transparency
  let diodeVisibility = diodeMask * 0.55;
  let baseAlpha = 0.72 + 0.28 * fresnel;
  let alpha = mix(baseAlpha, 0.32, diodeVisibility) * edgeAlpha;

  // Directional lighting
  let lightDir = vec3<f32>(0.4, -0.7, 0.6);
  let diff = max(0.0, dot(n, normalize(lightDir)));
  let spec = pow(max(0.0, dot(reflect(-normalize(lightDir), n), viewDir)), 40.0);

  let litGlassColor = glassBaseColor * (0.45 + 0.55 * diff) + vec3<f32>(spec * 0.25);

  // Final composition
  var finalColor = GLASS_BG;

  let diodeBlend = diodeMask * (1.0 - alpha * 0.65);
  finalColor = mix(finalColor, combinedDiode, diodeBlend);
  finalColor = mix(finalColor, litGlassColor, alpha);
  finalColor += subsurfaceGlow * 1.8;

  // Concentrated glow halos around active emitters
  if (midEmitter.a > 0.05) {
    let midGlowDist = length(uv - midPos - refractOffset * 0.5);
    let midGlow = (1.0 - smoothstep(0.0, 0.18, midGlowDist)) * midEmitter.a * 0.5;
    finalColor += midEmitter.rgb * midGlow;
  }
  if (topEmitter.a > 0.05) {
    let topGlowDist = length(uv - topPos - refractOffset * 0.3);
    let topGlow = (1.0 - smoothstep(0.0, 0.14, topGlowDist)) * topEmitter.a * 0.3;
    finalColor += topEmitter.rgb * topGlow;
  }
  if (botEmitter.a > 0.05) {
    let botGlowDist = length(uv - botPos - refractOffset * 0.3);
    let botGlow = (1.0 - smoothstep(0.0, 0.14, botGlowDist)) * botEmitter.a * 0.3;
    finalColor += botEmitter.rgb * botGlow;
  }

  finalColor += fresnel * vec3<f32>(0.9, 0.95, 1.0) * 0.18 * (1.0 + radial * 0.5);

  // Horizontal separator shadows between emitter zones
  let sepShadowTop = (1.0 - smoothstep(0.0, 0.015, abs(p.y - (-0.14)))) * 0.35;
  let sepShadowBot = (1.0 - smoothstep(0.0, 0.015, abs(p.y - 0.14))) * 0.35;
  finalColor -= finalColor * (sepShadowTop + sepShadowBot);

  let vignette = 1.0 - radial * radial * 0.25;
  finalColor *= vignette;

  return vec4<f32>(finalColor, edgeAlpha);
}
