// ============================================================
// patternv0.38.wgsl — Source file
// Chrome dome indicator with circular layout
//
// Assembled via build-shaders.mjs from:
//   #include "common.wgsl"
//   #include "sdf_primitives.wgsl"
//   #include "color_palettes.wgsl"
//   #include "bloom_effects.wgsl"
//   #include "led_drawing.wgsl"
// ============================================================

#include "common.wgsl"
#include "sdf_primitives.wgsl"
#include "color_palettes.wgsl"
#include "bloom_effects.wgsl"
#include "led_drawing.wgsl"

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let fs = getFragmentConstants();
  let uv = in.uv;
  let p = uv - 0.5;
  let aa = fwidth(p.y) * 0.33;
  let bloom = uniforms.bloomIntensity;

  // Hardware Layering: Discard pixels over UI
  if (in.position.y > uniforms.canvasH * 0.88) {
    discard;
  }

  // CHANNEL 0 is the Indicator Ring (because padTopChannel shifts music to 1-32)
  if (in.channel == 0u) {
    let onPlayhead = (in.row == u32(uniforms.playheadRow));
    let indSize = vec2<f32>(0.3, 0.3);
    let indColor = select(vec3<f32>(0.2), fs.ledOnColor, onPlayhead);
    let indLed = drawChromeIndicator(p, indSize, indColor, onPlayhead, aa, 1.0);
    var col = indLed.rgb;
    var alpha = indLed.a;
    if (onPlayhead) {
      let glow = fs.ledOnColor * (bloom * 4.0) * exp(-length(p) * 4.0);
      col += glow;
      alpha = max(alpha, smoothstep(0.0, 0.2, length(glow)));
    }
    return vec4<f32>(col, clamp(alpha, 0.0, 1.0));
  }

  // --- MUSIC CHANNELS (1-32) ---
  let dHousing = sdRoundedBox(p, fs.housingSize * 0.5, 0.06);
  let housingMask = 1.0 - smoothstep(0.0, aa * 1.5, dHousing);

  var finalColor = fs.bgColor;
  finalColor += vec3<f32>(0.04) * (0.5 - uv.y);

  let btnScale = 1.05;
  let btnUV = (uv - 0.5) * btnScale + 0.5;
  var inButton = 0.0;
  if (btnUV.x > 0.0 && btnUV.x < 1.0 && btnUV.y > 0.0 && btnUV.y < 1.0) {
    let texColor = textureSampleLevel(buttonsTexture, buttonsSampler, btnUV, -0.5).rgb;
    finalColor = mix(finalColor, texColor, 0.7);
    inButton = 1.0;
  }

  if (inButton > 0.5) {
    let note   = (in.packedA >> 24) & 255u;
    let inst   = (in.packedA >> 16) & 255u;
    let volCmd = (in.packedA >>  8) & 255u;
    let effCmd = (in.packedB >>  8) & 255u;
    let hasNote       = (note > 0u) && (note <= 120u);
    let hasExpression = (volCmd > 0u) || (effCmd > 0u);

    let ch      = channels[in.channel];
    let isMuted = (ch.isMuted == 1u);

    // Playhead proximity (wrap-safe, 64-step page)
    let maxRows = f32(uniforms.numRows);
    let playheadStep   = uniforms.playheadRow - floor(uniforms.playheadRow / maxRows) * maxRows;
    let rowDistRaw     = abs(f32(in.row % uniforms.numRows) - playheadStep);
    let rowDist        = min(rowDistRaw, maxRows - rowDistRaw);
    let playheadActivation = 1.0 - smoothstep(0.0, 1.5, rowDist);

    if (!isMuted) {
      if (hasNote) {
        let pitchHue = pitchClassFromIndex(note);
        let noteCol  = neonPalette(pitchHue);
        var noteGlow = playheadActivation;
        if (ch.trigger > 0u && playheadActivation > 0.5) { noteGlow += 1.0; }

        let mainUV  = btnUV - vec2<f32>(0.5, 0.5);
        let mainSz  = vec2<f32>(0.60, 0.60);
        let mainLed = drawChromeIndicator(mainUV, mainSz, noteCol * max(0.4, noteGlow), noteGlow > 0.05, aa, 1.0);
        finalColor  = mix(finalColor, mainLed.rgb, mainLed.a);
        if (noteGlow > 0.05) { finalColor += noteCol * noteGlow * bloom * 0.3; }
      } else {
        finalColor = mix(finalColor, vec3<f32>(0.08, 0.09, 0.11), 0.5);
      }

      if (hasExpression) {
        let exprUV  = btnUV - vec2<f32>(0.5, 0.82);
        let exprSz  = vec2<f32>(0.30, 0.12);
        let exprCol = vec3<f32>(0.0, 0.7, 1.0) * (1.0 + bloom * 0.5);
        let exprLed = drawChromeIndicator(exprUV, exprSz, exprCol, true, aa, 1.0);
        finalColor  = mix(finalColor, exprLed.rgb, exprLed.a);
      }

      // Playhead row ambient tint
      if (playheadActivation > 0.0) {
        finalColor += vec3<f32>(0.05, 0.05, 0.10) * playheadActivation;
      }
    } else {
      finalColor *= 0.3;
    }
  }

  if (housingMask < 0.5) { return vec4<f32>(fs.borderColor, 0.0); }
  return vec4<f32>(finalColor, 1.0);
}
