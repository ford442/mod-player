// ============================================================
// patternv0.49.wgsl — Source file
// Three-Emitter LED System with drawThreeEmitterLens
//
// Assembled via build-shaders.mjs from:
//   #include "common.wgsl"
//   #include "sdf_primitives.wgsl"
//   #include "color_palettes.wgsl"
//   #include "bloom_effects.wgsl"
//   #include "led_drawing.wgsl"
//
// Note: Requires padTopChannel=true in PatternDisplay to shift music channels 1-32.
// ============================================================

#include "common.wgsl"
#include "sdf_primitives.wgsl"
#include "color_palettes.wgsl"
#include "bloom_effects.wgsl"
#include "led_drawing.wgsl"

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  // Compute derivatives in uniform control flow (before any early returns)
  let uv = in.uv;
  let p = uv - 0.5;
  let aa = fwidth(p.y) * 0.33;

  if (in.channel >= uniforms.numChannels) { return vec4<f32>(1.0, 0.0, 0.0, 1.0); }
  let fs = getFragmentConstants();
  let bloom = uniforms.bloomIntensity;
  let kick = uniforms.kickTrigger;
  let beat = uniforms.beatPhase;

  // Hardware Layering: Discard pixels over UI
  if (in.position.y > uniforms.canvasH * 0.88) {
    discard;
  }

  // Smooth playhead position
  let maxRows = f32(uniforms.numRows);
  let playheadStep = uniforms.playheadRow - floor(uniforms.playheadRow / maxRows) * maxRows;
  let rowDistRaw = abs(f32(in.row % uniforms.numRows) - playheadStep);
  let rowDist = min(rowDistRaw, maxRows - rowDistRaw);
  let playheadActivation = 1.0 - smoothstep(0.0, 1.5, rowDist);

  // CHANNEL 0 is the Indicator Ring (padTopChannel shifts music to 1-32)
  if (in.channel == 0u) {
    let onPlayhead = playheadActivation > 0.5;
    let indSize = vec2<f32>(0.3, 0.3);
    let indColor = mix(vec3<f32>(0.15), fs.ledOnColor * 1.3, playheadActivation);
    let dBox = sdRoundedBox(p, indSize * 0.5, 0.08);
    let edgeAlpha = smoothstep(0.0, aa * 2.0, -dBox);
    var col = mix(vec3<f32>(0.04), indColor, playheadActivation * 0.8);
    var alpha = edgeAlpha;
    if (playheadActivation > 0.0) {
      let beatPulse = 1.0 + kick * 0.6 + (0.5 + 0.5 * sin(beat * TAU)) * 0.2;
      let glow = fs.ledOnColor * (bloom * 5.0) * exp(-length(p) * 3.5) * playheadActivation * beatPulse;
      col += glow;
      alpha = max(alpha, smoothstep(0.0, 0.25, length(glow)));
    }
    return vec4<f32>(col, clamp(alpha, 0.0, 1.0));
  }

  // --- MUSIC CHANNELS (1-32) with THREE-EMITTER LED SYSTEM ---
  let dHousing = sdRoundedBox(p, fs.housingSize * 0.5, 0.06);
  let housingMask = 1.0 - smoothstep(0.0, aa * 1.5, dHousing);

  var finalColor = fs.bgColor;

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
    let volVal = in.packedA & 255u;

    let effCmd = (in.packedB >> 8) & 255u;
    let effVal = in.packedB & 255u;

    let hasNote = (note > 0u);
    let hasExpression = (volCmd > 0u) || (effCmd > 0u);

    let ch = channels[in.channel];
    let isMuted = (ch.isMuted == 1u);

    // --- THREE-EMITTER SYSTEM ---

    // EMITTER 1 (TOP): Blue Note-On Indicator
    let blueColor = vec3<f32>(0.15, 0.5, 1.0);
    var topIntensity = 0.0;
    if (!isMuted) {
      if (ch.trigger > 0u) {
        topIntensity = 1.0 + bloom;
      } else if (playheadActivation > 0.5) {
        topIntensity = playheadActivation * 0.6;
      }
    }

    // EMITTER 2 (MIDDLE): Steady Note Color
    var midColor = vec3<f32>(0.15);
    var midIntensity = 0.12;
    if (hasNote) {
      let pitchHue = pitchClassFromIndex(note);
      let baseColor = selectPalette(uniforms.colorPalette, pitchHue);
      let instBand = inst & 15u;
      let instBright = 0.85 + (select(0.0, f32(instBand) / 15.0, instBand > 0u)) * 0.15;
      midColor = baseColor * instBright;

      midIntensity = 0.6 + bloom * 2.0;
      if (isMuted) { midIntensity *= 0.3; }
    }

    // EMITTER 3 (BOTTOM): Amber Control Message Indicator
    let amberColor = vec3<f32>(1.0, 0.55, 0.1);
    var botIntensity = 0.0;
    if (!isMuted && hasExpression) {
      botIntensity = 0.8 + bloom;
    }

    // --- RENDER UNIFIED GLASS LENS ---
    let lensUV = btnUV - vec2<f32>(0.5, 0.5);
    let lensSize = vec2<f32>(0.55, 0.75);

    let lens = drawThreeEmitterLens(
      lensUV, lensSize,
      blueColor, topIntensity,
      midColor, midIntensity,
      amberColor, botIntensity,
      aa
    );

    finalColor = mix(finalColor, lens.rgb, lens.a);

    // Add external glow when active
    if (topIntensity > 0.0 || botIntensity > 0.0 || midIntensity > 0.5) {
      let totalActivity = topIntensity + botIntensity + (midIntensity - 0.12);
      let glowColor = mix(midColor, blueColor, topIntensity * 0.5);
      let glowColor2 = mix(glowColor, amberColor, botIntensity * 0.5);
      let externalGlow = glowColor2 * totalActivity * bloom * 2.0 * exp(-length(p) * 4.0);
      finalColor += externalGlow;
    }
  }

  // Kick reactive glow
  finalColor += kickReactiveGlow(p, kick, bloom);

  // Dithering for night mode
  finalColor += ditherNoise(in.uv, uniforms.timeSec);

  if (housingMask < 0.5) { return vec4<f32>(fs.borderColor, 0.0); }
  return vec4<f32>(finalColor, 1.0);
}
