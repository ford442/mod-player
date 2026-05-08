// ============================================================
// patternv0.30.wgsl — Source file
// Chrome dome indicator with ASCII-packed notes
//
// Assembled via build-shaders.mjs from:
//   #include "common.wgsl"
//   #include "sdf_primitives.wgsl"
//   #include "color_palettes.wgsl"
//   #include "note_parsing.wgsl"
//   #include "bloom_effects.wgsl"
//   #include "led_drawing.wgsl"
// ============================================================

#include "common.wgsl"
#include "sdf_primitives.wgsl"
#include "color_palettes.wgsl"
#include "note_parsing.wgsl"
#include "bloom_effects.wgsl"
#include "led_drawing.wgsl"

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let fs = getFragmentConstants();
  let uv = in.uv;
  let p = uv - 0.5;
  let aa = fwidth(p.y) * 0.5;

  // --- INDICATOR RING (Channel 0 / Outer Ring) ---
  if (in.channel == 0u) {
    let onPlayhead = (in.row == u32(uniforms.playheadRow));
    let indSize = vec2<f32>(0.3, 0.3);
    let indColor = select(vec3<f32>(0.2), fs.ledOnColor, onPlayhead);
    let indLed = drawChromeIndicator(p, indSize, indColor, onPlayhead, aa, 1.0);

    var col = indLed.rgb;
    var alpha = indLed.a;
    if (onPlayhead) {
      let glow = fs.ledOnColor * 0.5 * exp(-length(p) * 5.0);
      col += glow;
      alpha = max(alpha, smoothstep(0.0, 0.1, length(glow)));
    }
    return vec4<f32>(col, clamp(alpha, 0.0, 1.0));
  }

  // --- PATTERN ROWS ---
  let dHousing = sdRoundedBox(p, fs.housingSize * 0.5, 0.06);
  let housingMask = 1.0 - smoothstep(0.0, aa * 1.5, dHousing);

  var finalColor = fs.bgColor;
  finalColor += vec3<f32>(0.04) * (0.5 - uv.y);

  // --- TEXTURE OVERLAY ---
  let btnScale = 1.05;
  let btnUV = (uv - 0.5) * btnScale + 0.5;
  var inButton = 0.0;
  if (btnUV.x > 0.0 && btnUV.x < 1.0 && btnUV.y > 0.0 && btnUV.y < 1.0) {
    let texColor = textureSampleLevel(buttonsTexture, buttonsSampler, btnUV, 0.0).rgb;
    finalColor = mix(finalColor, texColor, 0.7);
    inButton = 1.0;
  }

  // --- CHROME HARDWARE INDICATORS ---
  if (inButton > 0.5) {
    let noteChar = (in.packedA >> 24) & 255u;
    let inst = in.packedA & 255u;
    let effCode = (in.packedB >> 8) & 255u;
    let effParam = in.packedB & 255u;

    let hasNote = (noteChar >= 65u && noteChar <= 71u);
    let hasEffect = (effParam > 0u);
    let ch = channels[in.channel];
    let isMuted = (ch.isMuted == 1u);

    // COMPONENT 1: ACTIVITY LIGHT (Cyan Square)
    let topUV = btnUV - vec2<f32>(0.5, 0.16);
    let topSize = vec2<f32>(0.20, 0.20);

    let isActive = (step(0.3, exp(-ch.noteAge * 4.0)) > 0.5) && !isMuted;
    let topColor = vec3<f32>(0.0, 0.9, 1.0);

    let topLed = drawChromeIndicator(topUV, topSize, topColor, isActive, aa, 1.0);
    finalColor = mix(finalColor, topLed.rgb, topLed.a);
    if (isActive) {
      finalColor += topColor * topLed.a * 0.5;
    }

    // COMPONENT 2: MAIN NOTE LIGHT
    let mainUV = btnUV - vec2<f32>(0.5, 0.5);
    let mainSize = vec2<f32>(0.55, 0.45);

    var noteColor = vec3<f32>(0.2);
    var lightAmount = 0.0;

    if (hasNote) {
      let pitchHue = pitchClassFromPacked(in.packedA);
      let baseColor = neonPalette(pitchHue);
      let instBand = inst & 15u;
      let instBright = 0.8 + (select(0.0, f32(instBand) / 15.0, instBand > 0u)) * 0.2;
      noteColor = baseColor * instBright;

      let flash = f32(ch.trigger) * 0.8;
      var d = f32(in.row) + uniforms.tickOffset - uniforms.playheadRow;
      let totalSteps = f32(uniforms.numRows);
      if (d > totalSteps * 0.5) { d = d - totalSteps; }
      if (d < -totalSteps * 0.5) { d = d + totalSteps; }

      let coreDist = abs(d);
      let energy = 0.02 / (coreDist + 0.001);
      let trail = exp(-10.0 * max(0.0, -d));
      let activeVal = clamp(pow(energy, 1.5) + trail, 0.0, 1.0);

      lightAmount = (activeVal * 0.8 + flash) * clamp(ch.volume, 0.0, 1.2);
      if (isMuted) { lightAmount *= 0.2; }
    }

    let displayColor = noteColor * max(lightAmount, 0.1);
    let isLit = (lightAmount > 0.05);
    let mainPad = drawChromeIndicator(mainUV, mainSize, displayColor, isLit, aa, 1.0);
    finalColor = mix(finalColor, mainPad.rgb, mainPad.a);

    // COMPONENT 3: EFFECT LIGHT (Yellow Pill)
    let botUV = btnUV - vec2<f32>(0.5, 0.85);
    let botSize = vec2<f32>(0.25, 0.12);

    var effColor = vec3<f32>(0.0);
    var isEffOn = false;

    if (hasEffect) {
      effColor = effectColorFromCode(effCode, vec3<f32>(0.9, 0.8, 0.2));
      let strength = clamp(f32(effParam) / 255.0, 0.2, 1.0);
      if (!isMuted) {
        effColor *= strength;
        isEffOn = true;
      }
    }

    let botLed = drawChromeIndicator(botUV, botSize, effColor, isEffOn, aa, 1.0);
    finalColor = mix(finalColor, botLed.rgb, botLed.a);

    // COMPONENT 4: PLAYHEAD GLANCE
    let rA = i32(in.row);
    let rB = i32(uniforms.playheadRow);
    let distDirect = abs(rA - rB);
    let distWrap = 128 - distDirect;
    let rowDist = min(distDirect, distWrap);

    if (rowDist == 0) {
      finalColor += vec3<f32>(0.15, 0.2, 0.25) * housingMask * 0.4;
    }
  }

  if (housingMask < 0.5) {
    return vec4<f32>(fs.borderColor, 0.0);
  }

  return vec4<f32>(finalColor, 1.0);
}
