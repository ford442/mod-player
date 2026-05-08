// ============================================================
// pattern_bloom.wgsl — Source file
// Unified Bloom Pattern Shader
//
// Replaces: patternv0.30_bloom, v0.32_bloom, v0.33_bloom,
//           v0.34_bloom, v0.35_bloom
//
// This single shader covers the entire bloom variant family via
// the bloomPreset uniform (offset 96 in the extended layout):
//   0 — Classic HDR   (v0.30 style, channel-activity top light)
//   1 — Linger        (v0.32 style, slower decay, brighter flash)
//   2 — Expression Strike (v0.33 style, expression data + strike)
//   3 — Night Mode    (v0.35 style, dimming + UV ring + kick)
//
// Data format: Modern high-precision packing (same as v0.51).
//
// Assembled via build-shaders.mjs from:
//   #include "bloom/core.wgsl"
//   #include "bloom/math.wgsl"
//   #include "bloom/chrome.wgsl"
//   #include "bloom/utils.wgsl"
// ============================================================

#include "bloom/core.wgsl"
#include "bloom/math.wgsl"
#include "bloom/chrome.wgsl"
#include "bloom/utils.wgsl"

// --- MAIN ENTRY POINT (Preset-driven bloom) ---

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let fs = getFragmentConstants();
  let uv = in.uv;
  let p = uv - 0.5;
  let aa = fwidth(p.y) * 0.5;
  let bloom = uniforms.bloomIntensity;
  let preset = uniforms.bloomPreset;
  let isPlaying = (uniforms.isPlaying == 1u);

  // ── Preset Configuration ──
  // All flags are uniform across the draw call — zero branch divergence.
  var useExpressionTop = false;
  var useLinger = false;
  var useStrike = false;
  var useNightMode = false;
  var useKickDither = false;
  var topDecayRate = 4.0;
  var topBloomScale = 3.0;
  var displayBloomScale = 4.0;
  var topAdditiveScale = 2.0;

  switch (preset) {
    case 1u: {                    // Linger
      topDecayRate = 1.5;
      topBloomScale = 8.0;
      useLinger = true;
      displayBloomScale = 6.0;
      topAdditiveScale = 0.5;
    }
    case 2u: {                    // Expression Strike
      useExpressionTop = true;
      useLinger = true;
      useStrike = true;
      displayBloomScale = 6.0;
      topAdditiveScale = 0.3;
    }
    case 3u: {                    // Night Mode
      useExpressionTop = true;
      useLinger = true;
      useStrike = true;
      useNightMode = true;
      useKickDither = true;
      displayBloomScale = 6.0;
      topAdditiveScale = 0.3;
    }
    default: {                    // Classic HDR (preset 0)
      // defaults already set above
    }
  }

  let dimFactor = select(1.0, uniforms.dimFactor, useNightMode);
  let playheadRowU = u32(uniforms.playheadRow);
  let onPlayhead = (in.row == playheadRowU);

  // ═══════════════════════════════════════════════════════════
  // CHANNEL 0 — Indicator Ring
  // ═══════════════════════════════════════════════════════════
  if (in.channel == 0u) {
    let indSize = vec2<f32>(0.3, 0.3);
    var col = vec3<f32>(0.0);
    var alpha = 0.0;

    if (useNightMode) {
      // UV Purple ring when playing, standard cyan when stopped
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
      col = indLed.rgb;
      alpha = indLed.a;

      // Bezel cast illumination
      if (isPlaying) {
        col += uvPurple * 0.4 * bloom;
      }
      if (onPlayhead) {
        let flashColor = select(fs.ledOnColor, activePurple, isPlaying);
        let glow = flashColor * (bloom * 5.0) * exp(-length(p) * 4.0);
        col += glow;
        alpha = max(alpha, smoothstep(0.0, 0.2, length(glow)));
      }
    } else {
      // Classic / Linger / Strike indicator ring
      let indColor = select(vec3<f32>(0.2), fs.ledOnColor, onPlayhead);
      let indLed = drawChromeIndicator(p, indSize, indColor, onPlayhead, aa, 1.0);
      col = indLed.rgb;
      alpha = indLed.a;
      if (onPlayhead) {
        let glow = fs.ledOnColor * (bloom * 4.0) * exp(-length(p) * 4.0);
        col += glow;
        alpha = max(alpha, smoothstep(0.0, 0.2, length(glow)));
      }
    }
    return vec4<f32>(col, clamp(alpha, 0.0, 1.0));
  }

  // ═══════════════════════════════════════════════════════════
  // MUSIC CHANNELS 1–32
  // ═══════════════════════════════════════════════════════════
  let dHousing = sdRoundedBox(p, fs.housingSize * 0.5, 0.06);
  let housingMask = 1.0 - smoothstep(0.0, aa * 1.5, dHousing);

  var finalColor = fs.bgColor * dimFactor;
  finalColor += vec3<f32>(0.04) * (0.5 - uv.y) * dimFactor;

  // Texture overlay
  let btnScale = 1.05;
  let btnUV = (uv - 0.5) * btnScale + 0.5;
  var inButton = 0.0;
  if (btnUV.x > 0.0 && btnUV.x < 1.0 && btnUV.y > 0.0 && btnUV.y < 1.0) {
    let texColor = textureSampleLevel(buttonsTexture, buttonsSampler, btnUV, 0.0).rgb;
    finalColor = mix(finalColor, texColor * dimFactor, 0.7);
    inButton = 1.0;
  }

  if (inButton > 0.5) {
    // Unpack modern high-precision cell data
    let note = (in.packedA >> 24) & 255u;
    let inst = (in.packedA >> 16) & 255u;
    let effCmd = (in.packedB >> 24) & 255u;
    let effVal = (in.packedB >> 16) & 255u;
    let volCmd = in.packedB & 255u;

    let hasNote = (note > 0u && note < NOTE_OFF_MIN);
    let hasExpression = (volCmd > 0u) || (effCmd > 0u);

    let ch = channels[in.channel];
    let isMuted = (ch.isMuted == 1u);

    // ── COMPONENT 1: TOP LIGHT ──
    let topUV = btnUV - vec2<f32>(0.5, 0.16);
    let topSize = vec2<f32>(0.20, 0.20);
    let topColorBase = vec3<f32>(0.0, 0.9, 1.0);
    var topColor = vec3<f32>(0.0);
    var isTopOn = false;

    if (useExpressionTop) {
      // v0.33+ style: light up if THIS STEP has expression data
      let isDataPresent = hasExpression && !isMuted;
      topColor = topColorBase * select(0.0, 1.5 + bloom, isDataPresent);
      isTopOn = isDataPresent;
    } else {
      // v0.30/0.32 style: light up based on channel activity decay
      let decay = exp(-ch.noteAge * topDecayRate);
      let isActive = (decay > select(0.3, 0.05, preset == 1u)) && !isMuted;
      topColor = topColorBase * (bloom * topBloomScale) * select(1.0, decay, preset == 1u);
      isTopOn = isActive;
    }

    let topLed = drawChromeIndicator(topUV, topSize, topColor, isTopOn, aa, dimFactor);
    finalColor = mix(finalColor, topLed.rgb, topLed.a);
    if (isTopOn) {
      finalColor += topColor * topLed.a * topAdditiveScale;
    }

    // ── COMPONENT 2: MAIN NOTE LIGHT ──
    let mainUV = btnUV - vec2<f32>(0.5, 0.5);
    let mainSize = vec2<f32>(0.55, 0.45);
    var noteColor = vec3<f32>(0.2);
    var lightAmount = 0.0;

    if (hasNote) {
      let pitchHue = pitchClassFromIndex(note);
      let baseColor = neonPalette(pitchHue);
      let instBand = inst & 15u;
      let instBright = 0.8 + (select(0.0, f32(instBand) / 15.0, instBand > 0u)) * 0.2;
      noteColor = baseColor * instBright;

      // Spatial distance glow from playhead
      let totalSteps = f32(uniforms.numRows);
      var d = f32(in.row) + uniforms.tickOffset - uniforms.playheadRow;
      if (d > totalSteps * 0.5) { d = d - totalSteps; }
      if (d < -totalSteps * 0.5) { d = d + totalSteps; }
      let coreDist = abs(d);
      let energy = 0.02 / (coreDist + 0.001);
      let trail = exp(-10.0 * max(0.0, -d));
      let activeVal = clamp(pow(energy, 1.5) + trail, 0.0, 1.0);

      let flash = f32(ch.trigger) * select(0.8, 1.0, preset >= 1u);

      var lingerTerm = 0.0;
      if (useLinger) {
        lingerTerm = exp(-ch.noteAge * 1.5) * 2.0;
      }

      var strikeTerm = 0.0;
      if (useStrike && onPlayhead) {
        strikeTerm = 3.0;
      }

      lightAmount = (activeVal * 0.8 + flash + strikeTerm + lingerTerm)
                    * clamp(ch.volume, 0.0, 1.2);
      if (isMuted) { lightAmount *= 0.2; }
    }

    let displayColor = noteColor * max(lightAmount, 0.1)
                       * (1.0 + bloom * displayBloomScale);
    let isLit = (lightAmount > 0.05);
    let mainPad = drawChromeIndicator(mainUV, mainSize, displayColor, isLit, aa, dimFactor);
    finalColor = mix(finalColor, mainPad.rgb, mainPad.a);

    // ── COMPONENT 3: EFFECT LIGHT ──
    let botUV = btnUV - vec2<f32>(0.5, 0.85);
    let botSize = vec2<f32>(0.25, 0.12);
    var effColor = vec3<f32>(0.0);
    var isEffOn = false;

    if (effCmd > 0u) {
      effColor = effectColorFromCode(effCmd, vec3<f32>(0.9, 0.8, 0.2));
      let strength = clamp(f32(effVal) / 255.0, 0.2, 1.0);
      if (!isMuted) {
        effColor *= strength * (1.0 + bloom * 2.5);
        isEffOn = true;
      }
    }

    let botLed = drawChromeIndicator(botUV, botSize, effColor, isEffOn, aa, dimFactor);
    finalColor = mix(finalColor, botLed.rgb, botLed.a);
  }

  // Night-mode post-processing
  if (useKickDither) {
    finalColor += kickReactiveGlow(p, uniforms.kickTrigger, bloom);
    finalColor += ditherNoise(in.uv, uniforms.timeSec);
  }

  // Idle cells: thin outer stroke
  if (housingMask < 0.5) {
    if (dHousing < 0.02) {
      return vec4<f32>(fs.ledOffColor, 1.0);
    }
    return vec4<f32>(fs.borderColor, 0.0);
  }
  return vec4<f32>(finalColor, 1.0);
}
