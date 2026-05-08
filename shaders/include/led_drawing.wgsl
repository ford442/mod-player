#pragma once
// ============================================================
// led_drawing.wgsl — LED emitter and lens-cap drawing primitives.
//
// Include AFTER sdf_primitives.wgsl and common.wgsl / bloom/core.wgsl.
// Defines FragmentConstants, multiple lens styles, and the chrome
// dome indicator shared across classic and bloom families.
// ============================================================

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

/// Cyan/Teal chrome palette from the v0.35 bloom family.
fn getBloomFragmentConstants() -> FragmentConstants {
  var c: FragmentConstants;
  c.bgColor = vec3<f32>(0.15, 0.16, 0.18);
  c.ledOnColor = vec3<f32>(0.0, 0.85, 0.95);
  c.ledOffColor = vec3<f32>(0.08, 0.08, 0.10);
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

// ── Frosted Glass Cap (single emitter) ──

/// Shows the diode shape underneath with proper translucency.
/// Used by v0.47 / v0.48 family shaders.
fn drawFrostedGlassCap(
    uv: vec2<f32>,
    size: vec2<f32>,
    color: vec3<f32>,
    isOn: bool,
    aa: f32,
    noteGlow: f32,
    diodeColor: vec3<f32>,
    diodeIntensity: f32
) -> vec4<f32> {
  let p = uv;
  let dBox = sdRoundedBox(p, size * 0.5, 0.08);

  if (dBox > 0.0) {
    return vec4<f32>(0.0);
  }

  // Draw the emitter diode underneath
  let diode = drawEmitterDiode(uv, diodeIntensity, diodeColor, isOn);

  // Glass surface normal for reflections
  let n = normalize(vec3<f32>(p.x * 2.0 / size.x, p.y * 2.0 / size.y, 0.4));
  let viewDir = vec3<f32>(0.0, 0.0, 1.0);
  let fresnel = pow(1.0 - abs(dot(n, viewDir)), 2.0);
  let radial = length(p / (size * 0.5));

  // Glass thickness varies - thicker at edges
  let edgeThickness = 0.15 + radial * 0.08;
  let centerThickness = 0.08;
  let thickness = mix(centerThickness, edgeThickness, radial);

  // Subsurface scattering - light travels through the glass
  let emitterPos = vec2<f32>(0.0, 0.22);
  let distFromEmitter = length(uv - emitterPos);
  let lightTravel = exp(-distFromEmitter * 4.0) * noteGlow;

  // Light concentrates upward from the emitter
  let upwardBias = smoothstep(0.0, -0.3, uv.y - emitterPos.y);
  let subsurface = lightTravel * upwardBias * (1.0 - radial * 0.3);

  // Glass tint varies with light passing through
  let litTint = mix(vec3<f32>(0.95, 0.95, 1.0), color, noteGlow * 0.3);
  let glassBaseColor = mix(GLASS_BG * 0.15, litTint, 0.85);

  // Edge alpha with anti-aliasing
  let edgeAlpha = smoothstep(0.0, aa * 2.0, -dBox);

  // Glass is more transparent where the diode is visible
  let diodeVisibility = diode.a * 0.6;
  let baseAlpha = 0.75 + 0.25 * fresnel;
  let alpha = mix(baseAlpha, 0.35, diodeVisibility) * edgeAlpha;

  // Directional lighting from top-left
  let lightDir = vec3<f32>(0.4, -0.7, 0.6);
  let diff = max(0.0, dot(n, normalize(lightDir)));
  let spec = pow(max(0.0, dot(reflect(-normalize(lightDir), n), viewDir)), 32.0);

  let litGlassColor = glassBaseColor * (0.5 + 0.5 * diff) + vec3<f32>(spec * 0.3);

  // Start with background
  var finalColor = GLASS_BG;

  // Layer the diode underneath
  let diodeBlend = diode.a * (1.0 - alpha * 0.7);
  finalColor = mix(finalColor, diode.rgb, diodeBlend);

  // Apply glass layer
  finalColor = mix(finalColor, litGlassColor, alpha);

  // Add subsurface glow from light passing through
  finalColor += subsurface * color * 2.5;

  // Inner glow when on - concentrated above the diode
  if (isOn) {
    let glowCenter = vec2<f32>(0.0, -0.1);
    let glowDist = length(uv - glowCenter);
    let innerGlow = (1.0 - smoothstep(0.0, 0.4, glowDist)) * noteGlow * 0.35;
    finalColor += color * innerGlow;
  }

  // Fresnel rim highlight
  finalColor += fresnel * vec3<f32>(0.9, 0.95, 1.0) * 0.15;

  return vec4<f32>(finalColor, edgeAlpha);
}

// ── Three-Emitter Lens (v0.49 style) ──

/// Three vertically-stacked emitters with a unified glass surface.
/// Slightly different optical model from drawUnifiedLensCap.
fn drawThreeEmitterLens(
  uv: vec2<f32>,
  size: vec2<f32>,
  topColor: vec3<f32>,
  topIntensity: f32,
  midColor: vec3<f32>,
  midIntensity: f32,
  botColor: vec3<f32>,
  botIntensity: f32,
  aa: f32
) -> vec4<f32> {
  let p = uv;
  let dBox = sdRoundedBox(p, size * 0.5, 0.08);

  if (dBox > 0.0) {
    return vec4<f32>(0.0);
  }

  // Emitter positions within the lens
  let topPos = vec2<f32>(0.0, -0.28);
  let midPos = vec2<f32>(0.0, 0.0);
  let botPos = vec2<f32>(0.0, 0.28);

  // Calculate distance to each emitter for light propagation
  let distTop = length(uv - topPos);
  let distMid = length(uv - midPos);
  let distBot = length(uv - botPos);

  // Glass surface normal for reflections
  let n = normalize(vec3<f32>(p.x * 2.0 / size.x, p.y * 2.0 / size.y, 0.4));
  let viewDir = vec3<f32>(0.0, 0.0, 1.0);
  let fresnel = pow(1.0 - abs(dot(n, viewDir)), 2.0);
  let radial = length(p / (size * 0.5));

  // Glass thickness varies - thicker at edges
  let edgeThickness = 0.15 + radial * 0.08;
  let centerThickness = 0.08;
  let thickness = mix(centerThickness, edgeThickness, radial);

  // Background
  let bgColor = GLASS_BG;

  // Calculate light contribution from each emitter
  let topGlow = exp(-distTop * 5.0) * topIntensity;
  let topDownwardBias = smoothstep(0.0, 0.4, uv.y - topPos.y);
  let topContribution = topGlow * topDownwardBias * topColor;

  let midGlow = exp(-distMid * 4.0) * midIntensity;
  let midContribution = midGlow * midColor;

  let botGlow = exp(-distBot * 5.0) * botIntensity;
  let botUpwardBias = smoothstep(0.0, 0.4, botPos.y - uv.y);
  let botContribution = botGlow * botUpwardBias * botColor;

  // Combine all light contributions
  var totalLight = vec3<f32>(0.0);
  totalLight += topContribution * 2.5;
  totalLight += midContribution * 3.0;
  totalLight += botContribution * 2.5;

  // Glass tint varies with light passing through
  var litTint = vec3<f32>(0.95, 0.95, 1.0);
  if (topIntensity > 0.0) { litTint = mix(litTint, topColor, topIntensity * 0.25); }
  if (midIntensity > 0.0) { litTint = mix(litTint, midColor, midIntensity * 0.3); }
  if (botIntensity > 0.0) { litTint = mix(litTint, botColor, botIntensity * 0.25); }

  let glassBaseColor = mix(bgColor * 0.15, litTint, 0.85);

  // Edge alpha with anti-aliasing
  let edgeAlpha = smoothstep(0.0, aa * 2.0, -dBox);

  // Glass alpha varies with emitter intensity (brighter = more transparent)
  let totalIntensity = topIntensity + midIntensity + botIntensity;
  let baseAlpha = 0.75 + 0.25 * fresnel;
  let alpha = mix(baseAlpha, 0.45, totalIntensity * 0.5) * edgeAlpha;

  // Directional lighting from top-left
  let lightDir = vec3<f32>(0.4, -0.7, 0.6);
  let diff = max(0.0, dot(n, normalize(lightDir)));
  let spec = pow(max(0.0, dot(reflect(-normalize(lightDir), n), viewDir)), 32.0);

  let litGlassColor = glassBaseColor * (0.5 + 0.5 * diff) + vec3<f32>(spec * 0.3);

  // Start with background
  var finalColor = bgColor;

  // Apply the combined light through the glass
  finalColor += totalLight * 0.8;

  // Apply glass layer
  finalColor = mix(finalColor, litGlassColor, alpha);

  // Add emitter hot spots where the actual LEDs are
  let topHotspot = exp(-distTop * 12.0) * topIntensity;
  let midHotspot = exp(-distMid * 10.0) * midIntensity;
  let botHotspot = exp(-distBot * 12.0) * botIntensity;

  finalColor += topColor * topHotspot * 1.5;
  finalColor += midColor * midHotspot * 1.2;
  finalColor += botColor * botHotspot * 1.5;

  // Fresnel rim highlight
  finalColor += fresnel * vec3<f32>(0.9, 0.95, 1.0) * 0.15;

  return vec4<f32>(finalColor, edgeAlpha);
}

// ── Chrome Dome Indicator ──

/// HDR chrome dome indicator with bezel, lens optics, and dimming support.
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
