// ============================================================
// patternv0.35_bloom.wgsl — Source file
// Night Mode with UV Purple Ring and Chrome Indicators
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
  let bloom = uniforms.bloomIntensity;

  // STUDIO DARKNESS: Dim everything significantly when playing
  let isPlaying = (uniforms.isPlaying == 1u);
  let dimFactor = uniforms.dimFactor;

  if (in.channel == 0u) {
    let onPlayhead = (in.row == u32(uniforms.playheadRow));
    let indSize = vec2<f32>(0.3, 0.3);

    let standardGray = vec3<f32>(0.2);
    let uvPurple = vec3<f32>(0.65, 0.0, 1.0);
    let activePurple = vec3<f32>(0.8, 0.4, 1.0);

    var indColor = standardGray;
    if (isPlaying) {
      indColor = select(uvPurple, activePurple, onPlayhead);
    } else if (onPlayhead) {
      indColor = fs.ledOnColor;
    }

    let isLit = isPlaying || onPlayhead;
    let indLed = drawChromeIndicator(p, indSize, indColor, isLit, aa, dimFactor);
    var col = indLed.rgb;
    var alpha = indLed.a;

    if (isPlaying) {
      col += uvPurple * 0.4 * bloom;
    }

    if (onPlayhead) {
      let flashColor = select(fs.ledOnColor, activePurple, isPlaying);
      let glow = flashColor * (bloom * 5.0) * exp(-length(p) * 4.0);
      col += glow;
      alpha = max(alpha, smoothstep(0.0, 0.2, length(glow)));
    }
    return vec4<f32>(col, clamp(alpha, 0.0, 1.0));
  }

  let dHousing = sdRoundedBox(p, fs.housingSize * 0.5, 0.06);
  let housingMask = 1.0 - smoothstep(0.0, aa * 1.5, dHousing);

  var finalColor = fs.bgColor * dimFactor;
  finalColor += vec3<f32>(0.04) * (0.5 - uv.y) * dimFactor;

  let btnScale = 1.05;
  let btnUV = (uv - 0.5) * btnScale + 0.5;
  var inButton = 0.0;
  if (btnUV.x > 0.0 && btnUV.x < 1.0 && btnUV.y > 0.0 && btnUV.y < 1.0) {
    let texColor = textureSampleLevel(buttonsTexture, buttonsSampler, btnUV, 0.0).rgb;
    finalColor = mix(finalColor, texColor * dimFactor, 0.7);
    inButton = 1.0;
  }

  if (in.channel >= uniforms.numChannels) {
    return vec4<f32>(1.0, 0.0, 0.0, 1.0);
  }

  if (inButton > 0.5) {
    let noteChar = (in.packedA >> 24) & 255u;
    let inst = in.packedA & 255u;
    let volCmd = (in.packedA >> 8) & 255u;
    let effCode = (in.packedB >> 8) & 255u;
    let effParam = in.packedB & 255u;

    let hasNote = (noteChar >= 65u && noteChar <= 122u);
    let hasExpression = (volCmd > 0u) || (effCode > 0u);
    let ch = channels[in.channel];
    let isMuted = (ch.isMuted == 1u);

    // COMPONENT 1: DATA LIGHT
    let topUV = btnUV - vec2<f32>(0.5, 0.16);
    let topSize = vec2<f32>(0.20, 0.20);
    let isDataPresent = hasExpression && !isMuted;
    let topColorBase = vec3<f32>(0.0, 0.9, 1.0);
    let topColor = topColorBase * select(0.0, 1.5 + bloom, isDataPresent);
    let topLed = drawChromeIndicator(topUV, topSize, topColor, isDataPresent, aa, dimFactor);
    finalColor = mix(finalColor, topLed.rgb, topLed.a);
    if (isDataPresent) { finalColor += topColor * topLed.a * 0.3; }

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

      let linger = exp(-ch.noteAge * 1.5);

      let onPlayhead = (in.row == u32(uniforms.playheadRow));
      let strike = select(0.0, 3.0, onPlayhead);

      let flash = f32(ch.trigger) * 1.0;
      let totalSteps = f32(uniforms.numRows);
      let d = fract((f32(in.row) + uniforms.tickOffset - uniforms.playheadRow) / totalSteps) * totalSteps;
      let coreDist = min(d, totalSteps - d);
      let energy = 0.02 / (coreDist + 0.001);
      let trail = exp(-10.0 * max(0.0, -d + totalSteps * 0.5));
      let activeVal = clamp(pow(energy, 1.5) + trail, 0.0, 1.0);

      lightAmount = (activeVal * 0.8 + flash + strike + (linger * 2.0)) * clamp(ch.volume, 0.0, 1.2);
      if (isMuted) { lightAmount *= 0.2; }
    }
    let displayColor = noteColor * max(lightAmount, 0.1) * (1.0 + bloom * 6.0);
    let isLit = (lightAmount > 0.05);
    let mainPad = drawChromeIndicator(mainUV, mainSize, displayColor, isLit, aa, dimFactor);
    finalColor = mix(finalColor, mainPad.rgb, mainPad.a);

    // COMPONENT 3: EFFECT LIGHT
    let botUV = btnUV - vec2<f32>(0.5, 0.85);
    let botSize = vec2<f32>(0.25, 0.12);
    var effColor = vec3<f32>(0.0);
    var isEffOn = false;
    if (effCode > 0u) {
      effColor = effectColorFromCode(effCode, vec3<f32>(0.9, 0.8, 0.2));
      let strength = clamp(f32(effParam) / 255.0, 0.2, 1.0);
      if (!isMuted) { effColor *= strength * (1.0 + bloom * 2.5); isEffOn = true; }
    }
    let botLed = drawChromeIndicator(botUV, botSize, effColor, isEffOn, aa, dimFactor);
    finalColor = mix(finalColor, botLed.rgb, botLed.a);
  }

  if (housingMask < 0.5) { return vec4<f32>(fs.borderColor, 0.0); }

  finalColor += kickReactiveGlow(p, uniforms.kickTrigger, uniforms.bloomIntensity);
  finalColor += ditherNoise(in.uv, uniforms.timeSec);

  return vec4<f32>(finalColor, 1.0);
}
