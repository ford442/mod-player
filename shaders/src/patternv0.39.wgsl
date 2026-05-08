// ============================================================
// patternv0.39.wgsl — Source file
// Classic circular pattern with ASCII-packed note parsing
//
// Assembled via build-shaders.mjs from:
//   #include "common.wgsl"
//   #include "sdf_primitives.wgsl"
//   #include "color_palettes.wgsl"
//   #include "note_parsing.wgsl"
//   #include "bloom_effects.wgsl"
// ============================================================

#include "common.wgsl"
#include "sdf_primitives.wgsl"
#include "color_palettes.wgsl"
#include "note_parsing.wgsl"
#include "bloom_effects.wgsl"

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

  // ── INDICATOR RING ──
  if (in.channel == 0u) {
    let onPlayhead = (f32(in.row) == uniforms.playheadRow);
    let indSize = vec2<f32>(0.3, 0.3);
    let indColor = mix(vec3<f32>(0.15), vec3<f32>(1.0, 0.55, 0.1) * 1.3, playheadActivation);
    let dBox = sdRoundedBox(p, indSize * 0.5, 0.08);
    let edgeAlpha = smoothstep(0.0, aa * 2.0, -dBox);
    var col = mix(vec3<f32>(0.04), indColor, playheadActivation * 0.8);
    var alpha = edgeAlpha;
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
    let noteChar = (in.packedA >> 24) & 255u;
    let inst = (in.packedA >> 16) & 255u;
    let volCmd = (in.packedA >> 8) & 255u;
    let volVal = in.packedA & 255u;

    let effCmd = (in.packedB >> 8) & 255u;
    let effVal = in.packedB & 255u;

    let hasNote = (noteChar >= 65u && noteChar <= 71u);
    let hasExpression = (volCmd > 0u) || (effCmd > 0u);

    let ch = channels[in.channel];
    let isMuted = (ch.isMuted == 1u);

    var noteCol = vec3<f32>(0.15);
    var noteGlow = 0.0;

    if (hasNote) {
      let pitchHue = pitchClassFromPacked(in.packedA);
      noteCol = selectPalette(uniforms.colorPalette, pitchHue);
      let instBand = inst & 15u;
      let instBright = 0.85 + (select(0.0, f32(instBand) / 15.0, instBand > 0u)) * 0.15;
      noteCol *= instBright;

      let decay = exp(-ch.noteAge * 2.5);
      let flash = f32(ch.trigger);
      noteGlow = (decay + flash) * (1.0 + bloom * 3.0);
      if (isMuted) { noteGlow *= 0.25; }
    }

    // Main cap
    let mainUV = btnUV - vec2<f32>(0.5, 0.5);
    let mainSz = vec2<f32>(0.55, 0.45);
    let dBox = sdRoundedBox(mainUV, mainSz * 0.5, 0.08);
    let edgeAlpha = smoothstep(0.0, aa * 2.0, -dBox);

    let n = normalize(vec3<f32>(mainUV.x * 2.0 / mainSz.x, mainUV.y * 2.0 / mainSz.y, 0.35));
    let light = normalize(vec3<f32>(0.5, -0.8, 1.0));
    let diff = max(0.0, dot(n, light));
    let fresnel = pow(1.0 - max(0.0, dot(n, vec3<f32>(0.0, 0.0, 1.0))), 2.5);

    var capColor = mix(vec3<f32>(0.05, 0.05, 0.06), noteCol, 0.8);
    capColor *= (0.55 + 0.45 * diff);
    capColor += fresnel * 0.15;
    capColor += noteGlow * noteCol * 0.5;

    finalColor = mix(finalColor, capColor, edgeAlpha);

    // Playhead pulse
    if (playheadActivation > 0.5 && noteGlow > 0.0) {
      finalColor += noteCol * playheadActivation * 0.12;
    }

    // Expression indicator
    if (hasExpression && !isMuted) {
      let exprCenter = vec2<f32>(0.0, -0.32);
      let exprDist = length(mainUV - exprCenter);
      let exprMask = 1.0 - smoothstep(0.04, 0.07, exprDist);
      let exprCol = vec3<f32>(0.0, 0.75, 1.0) * (0.8 + bloom * 0.5);
      finalColor = mix(finalColor, exprCol, exprMask * 0.85);
    }
  }

  finalColor += kickReactiveGlow(p, kick, bloom);
  finalColor += ditherNoise(in.uv, uniforms.timeSec);

  if (housingMask < 0.5) { return vec4<f32>(vec3<f32>(0.0), 0.0); }
  return vec4<f32>(finalColor, 1.0);
}
