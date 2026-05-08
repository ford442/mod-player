// ============================================================
// patternv0.46.wgsl — Source file
// Frosted Glass - Circular Layout with Translucent Glass Caps
//
// Assembled via build-shaders.mjs from:
//   #include "common.wgsl"
//   #include "sdf_primitives.wgsl"
//   #include "color_palettes.wgsl"
//   #include "bloom_effects.wgsl"
// ============================================================

#include "common.wgsl"
#include "sdf_primitives.wgsl"
#include "color_palettes.wgsl"
#include "bloom_effects.wgsl"

// v0.46-specific simplified frosted glass cap (6-parameter variant)
fn drawFrostedGlassCap(uv: vec2<f32>, size: vec2<f32>, color: vec3<f32>, isOn: bool, aa: f32, noteGlow: f32) -> vec4<f32> {
  let p = uv;
  let dBox = sdRoundedBox(p, size * 0.5, 0.08);

  if (dBox > 0.0) {
    return vec4<f32>(0.0, 0.0, 0.0, 0.0);
  }

  let n = normalize(vec3<f32>(p.x * 2.0 / size.x, p.y * 2.0 / size.y, 0.35));
  let viewDir = vec3<f32>(0.0, 0.0, 1.0);

  let fresnel = pow(1.0 - abs(dot(n, viewDir)), 2.5);
  let radial = length(p / (size * 0.5));
  let thickness = 0.12;
  let subsurface = exp(-thickness * 3.5) * noteGlow * (1.0 - radial * 0.4);

  let bgColor = vec3<f32>(0.05, 0.05, 0.06);
  let glassColor = mix(bgColor * 0.2, color, 0.8);

  let edgeAlpha = smoothstep(0.0, aa * 2.0, -dBox);
  let alpha = edgeAlpha * (0.7 + 0.3 * fresnel);

  let light = vec3<f32>(0.5, -0.8, 1.0);
  let diff = max(0.0, dot(n, normalize(light)));
  let litGlassColor = glassColor * (0.55 + 0.45 * diff);

  var finalColor = mix(bgColor, litGlassColor, alpha);
  finalColor += subsurface * color * 3.5;

  if (isOn) {
    let innerGlow = (1.0 - radial) * noteGlow * 0.4;
    finalColor += color * innerGlow;
  }

  finalColor += fresnel * color * noteGlow * 0.3;
  return vec4<f32>(finalColor, edgeAlpha);
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let p = uv - 0.5;
  let aa = fwidth(p.y) * 0.33;

  if (in.channel >= uniforms.numChannels) { return vec4<f32>(1.0, 0.0, 0.0, 1.0); }
  let bloom = uniforms.bloomIntensity;
  let kick = uniforms.kickTrigger;
  let beat = uniforms.beatPhase;

  // Smooth playhead position
  let maxRows = f32(uniforms.numRows);
  let playheadStep = uniforms.playheadRow - floor(uniforms.playheadRow / maxRows) * maxRows;
  let rowDistRaw = abs(f32(in.row % uniforms.numRows) - playheadStep);
  let rowDist = min(rowDistRaw, maxRows - rowDistRaw);
  let playheadActivation = 1.0 - smoothstep(0.0, 1.5, rowDist);

  // --- INDICATOR RING ---
  if (in.channel == 0u) {
    let onPlayhead = playheadActivation > 0.5;
    let indSize = vec2<f32>(0.3, 0.3);
    let indColor = mix(vec3<f32>(0.15), vec3<f32>(1.0, 0.55, 0.1) * 1.3, playheadActivation);
    let indLed = drawFrostedGlassCap(p, indSize, indColor, onPlayhead, aa, playheadActivation * 1.5);

    var col = indLed.rgb;
    var alpha = indLed.a;
    if (playheadActivation > 0.0) {
      let beatPulse = 1.0 + kick * 0.6 + (0.5 + 0.5 * sin(beat * TAU)) * 0.2;
      let glow = vec3<f32>(1.0, 0.55, 0.1) * (bloom * 5.0) * exp(-length(p) * 3.5) * playheadActivation * beatPulse;
      col += glow;
      alpha = max(alpha, smoothstep(0.0, 0.25, length(glow)));
    }
    return vec4<f32>(col, clamp(alpha, 0.0, 1.0));
  }

  let dHousing = sdRoundedBox(p, vec2<f32>(0.46), 0.06);
  let housingMask = 1.0 - smoothstep(0.0, aa * 1.5, dHousing);

  var finalColor = vec3<f32>(0.04, 0.04, 0.05);

  let btnScale = 1.05;
  let btnUV = (uv - 0.5) * btnScale + 0.5;
  var inButton = 0.0;
  if (btnUV.x > 0.0 && btnUV.x < 1.0 && btnUV.y > 0.0 && btnUV.y < 1.0) {
    inButton = 1.0;
  }

  if (inButton > 0.5) {
    let note = (in.packedA >> 24) & 255u;
    let inst = (in.packedA >> 16) & 255u;
    let volCmd = (in.packedA >> 8) & 255u;

    let ch = channels[in.channel];
    let isMuted = (ch.isMuted == 1u);

    var noteCol = vec3<f32>(0.15);
    var noteGlow = 0.0;

    if (note > 0u && note <= 120u) {
      let pitchHue = pitchClassFromIndex(note);
      noteCol = selectPalette(uniforms.colorPalette, pitchHue);
      let instBand = inst & 15u;
      let instBright = 0.85 + (select(0.0, f32(instBand) / 15.0, instBand > 0u)) * 0.15;
      noteCol *= instBright;

      let decay = exp(-ch.noteAge * 2.5);
      let flash = f32(ch.trigger);
      noteGlow = (decay + flash) * (1.0 + bloom * 3.0);
      if (isMuted) { noteGlow *= 0.25; }
    }

    let mainUV = btnUV - vec2<f32>(0.5, 0.5);
    let mainSz = vec2<f32>(0.55, 0.45);
    let mainLed = drawFrostedGlassCap(mainUV, mainSz, noteCol * max(0.35, noteGlow), noteGlow > 0.05, aa, noteGlow);
    finalColor = mix(finalColor, mainLed.rgb, mainLed.a);

    if (playheadActivation > 0.5 && noteGlow > 0.0) {
      let pulse = vec3<f32>(0.15, 0.5, 1.0) * playheadActivation * 0.12;
      finalColor += pulse;
    }
  }

  finalColor += kickReactiveGlow(p, kick, bloom);
  finalColor += ditherNoise(in.uv, uniforms.timeSec);

  if (housingMask < 0.5) { return vec4<f32>(vec3<f32>(0.0), 0.0); }
  return vec4<f32>(finalColor, 1.0);
}
