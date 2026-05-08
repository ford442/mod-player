// ============================================================
// patternv0.47.wgsl — Source file
// Frosted Glass Cap with ASCII-Packed Note Parsing
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
  // Compute derivatives in uniform control flow (before any early returns)
  let uv = in.uv;
  let p = uv - 0.5;
  let aa = fwidth(p.y) * 0.33;

  if (in.channel >= uniforms.numChannels) { return vec4<f32>(1.0, 0.0, 0.0, 1.0); }
  let fs = getFragmentConstants();
  let bloom = uniforms.bloomIntensity;
  let kick = uniforms.kickTrigger;
  let beat = uniforms.beatPhase;

  // Smooth playhead position
  let maxRows = f32(uniforms.numRows);
  let playheadStep = uniforms.playheadRow - floor(uniforms.playheadRow / maxRows) * maxRows;
  let rowDistRaw = abs(f32(in.row % uniforms.numRows) - playheadStep);
  let rowDist = min(rowDistRaw, maxRows - rowDistRaw);
  let playheadActivation = 1.0 - smoothstep(0.0, 1.5, rowDist);

  // --- INDICATOR RING (Channel 0 / Outer Ring) ---
  if (in.channel == 0u) {
    let onPlayhead = playheadActivation > 0.5;
    let indSize = vec2<f32>(0.3, 0.3);
    let indColor = mix(vec3<f32>(0.15), fs.ledOnColor * 1.3, playheadActivation);
    let indLed = drawFrostedGlassCap(p, indSize, indColor, onPlayhead, aa, playheadActivation * 1.5, indColor, playheadActivation);

    var col = indLed.rgb;
    var alpha = indLed.a;
    if (playheadActivation > 0.0) {
      let beatPulse = 1.0 + kick * 0.6 + (0.5 + 0.5 * sin(beat * TAU)) * 0.2;
      let glow = fs.ledOnColor * (bloom * 5.0) * exp(-length(p) * 3.5) * playheadActivation * beatPulse;
      col += glow;
      alpha = max(alpha, smoothstep(0.0, 0.25, length(glow)));
    }
    return vec4<f32>(col, clamp(alpha, 0.0, 1.0));
  }

  // --- PATTERN ROWS ---
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
    let noteChar = (in.packedA >> 24) & 255u;
    let inst = (in.packedA >> 16) & 255u;
    let effCode = (in.packedB >> 8) & 255u;
    let effParam = in.packedB & 255u;

    let hasNote = (noteChar > 0u) && (noteChar <= 120u);
    let hasEffect = (effParam > 0u);

    var ch = ChannelState(0.0, 0.0, 0.0, 0u, 1000.0, 0u, 0.0, 0u);
    if (in.channel < arrayLength(&channels)) {
      ch = channels[in.channel];
    }
    let isMuted = (ch.isMuted == 1u);

    // COMPONENT 1: ACTIVITY LIGHT (Blue indicator)
    let topUV = btnUV - vec2<f32>(0.5, 0.16);
    let topSize = vec2<f32>(0.20, 0.20);

    let isActive = (step(0.3, exp(-ch.noteAge * 4.0)) > 0.5) && !isMuted;
    let topColor = vec3<f32>(0.15, 0.5, 1.0) * select(0.0, 1.5 + bloom, isActive);

    let topLed = drawFrostedGlassCap(topUV, topSize, topColor, isActive, aa, select(0.0, 1.0, isActive), topColor, select(0.0, 1.0, isActive));
    finalColor = mix(finalColor, topLed.rgb, topLed.a);

    // COMPONENT 2: MAIN NOTE LIGHT
    let mainUV = btnUV - vec2<f32>(0.5, 0.5);
    let mainSize = vec2<f32>(0.55, 0.45);

    var noteColor = vec3<f32>(0.15);
    var lightAmount = 0.0;
    var noteGlow = 0.0;

    if (hasNote) {
      let pitchHue = pitchClassFromPacked(in.packedA);
      let baseColor = selectPalette(uniforms.colorPalette, pitchHue);
      let instBand = inst & 15u;
      let instBright = 0.85 + (select(0.0, f32(instBand) / 15.0, instBand > 0u)) * 0.15;
      noteColor = baseColor * instBright;

      let linger = exp(-ch.noteAge * 1.2);
      let strike = playheadActivation * 3.5;
      let flash = f32(ch.trigger) * 1.2;

      let totalSteps = f32(uniforms.numRows);
      let d = fract((f32(in.row) + uniforms.tickOffset - uniforms.playheadRow) / totalSteps) * totalSteps;
      let coreDist = min(d, totalSteps - d);
      let energy = 0.03 / (coreDist + 0.001);
      let trail = exp(-7.0 * max(0.0, -d));
      let activeVal = clamp(pow(energy, 1.3) + trail, 0.0, 1.0);

      let beatBoost = 1.0 + kick * 0.5;
      lightAmount = (activeVal * 0.9 + flash + strike + (linger * 2.5)) * clamp(ch.volume, 0.0, 1.2) * beatBoost;
      if (isMuted) { lightAmount *= 0.2; }
      noteGlow = lightAmount;
    }

    let displayColor = noteColor * max(lightAmount, 0.12) * (1.0 + bloom * 8.0);
    let isLit = (lightAmount > 0.05);
    let mainPad = drawFrostedGlassCap(mainUV, mainSize, displayColor, isLit, aa, noteGlow, displayColor, noteGlow);
    finalColor = mix(finalColor, mainPad.rgb, mainPad.a);

    // Playhead pulse
    if (playheadActivation > 0.5 && hasNote) {
      let pulseColor = mix(vec3<f32>(0.15, 0.5, 1.0), vec3<f32>(1.0, 0.55, 0.1), 0.5 + 0.5 * sin(beat * TAU));
      finalColor += pulseColor * playheadActivation * 0.15;
    }

    // COMPONENT 3: EFFECT INDICATOR (Orange pill)
    let botUV = btnUV - vec2<f32>(0.5, 0.85);
    let botSize = vec2<f32>(0.25, 0.12);
    var effColor = vec3<f32>(0.0);
    var isEffOn = false;

    if (effCode > 0u && hasEffect) {
      effColor = effectColorFromCode(effCode, vec3<f32>(1.0, 0.55, 0.1));
      if (!isMuted) {
        effColor *= (1.0 + bloom * 3.5);
        isEffOn = true;
      }
    }

    let botLed = drawFrostedGlassCap(botUV, botSize, effColor, isEffOn, aa, select(0.0, 0.7, isEffOn), effColor, select(0.0, 0.7, isEffOn));
    finalColor = mix(finalColor, botLed.rgb, botLed.a);
  }

  // Kick reactive glow
  finalColor += kickReactiveGlow(p, kick, bloom);

  // Dithering for night mode
  finalColor += ditherNoise(in.uv, uniforms.timeSec);

  if (housingMask < 0.5) { return vec4<f32>(fs.borderColor, 0.0); }
  return vec4<f32>(finalColor, 1.0);
}
