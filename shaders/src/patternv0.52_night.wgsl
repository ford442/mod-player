// ============================================================
// patternv0.52_night.wgsl — Source file
// Premium Night Mode — Cinematic Studio Visualization
//
// Evolves v0.35_bloom into a moody, high-end night-studio aesthetic.
// Key features:
//   • Multi-layer pulsing UV indicator ring with cast illumination
//   • Cinematic radial vignette (adaptive Deep Night)
//   • Animated film-grain atmosphere layer
//   • Per-ring color temperature shift for inverted channels
//   • Deep Night mode triggered by dimFactor < 0.35
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

// ═══════════════════════════════════════════════════════════
// NIGHT MODE PALETTE & CONSTANTS
// ═══════════════════════════════════════════════════════════

/// Studio-black background — deeper than the standard glass bg.
const STUDIO_BLACK: vec3<f32> = vec3<f32>(0.012, 0.013, 0.018);

/// UV accent family used for the indicator ring and ambient cast.
const UV_CORE:   vec3<f32> = vec3<f32>(0.60, 0.05, 1.00);
const UV_HALO:   vec3<f32> = vec3<f32>(0.85, 0.20, 1.00);
const UV_CAST:   vec3<f32> = vec3<f32>(0.35, 0.00, 0.65);
const UV_DEEP:   vec3<f32> = vec3<f32>(0.20, 0.00, 0.40);

/// Cyan expression accent (cooler than classic amber for night mode).
const NIGHT_CYAN: vec3<f32> = vec3<f32>(0.10, 0.75, 0.95);

/// Warm note-on indicator for contrast against cool background.
const NIGHT_AMBER: vec3<f32> = vec3<f32>(1.00, 0.55, 0.08);

// ═══════════════════════════════════════════════════════════
// NIGHT MODE ATMOSPHERE FUNCTIONS
// ═══════════════════════════════════════════════════════════

/// Slow breathing pulse for the indicator ring glow.
/// Returns 0.75 – 1.0 sinusoid at ~0.4 Hz.
fn breathe(time: f32) -> f32 {
  return 0.82 + 0.18 * sin(time * 2.4);
}

/// Cinematic radial vignette. Strength is scaled by dimFactor so
/// the user slider directly controls edge darkness.
fn vignetteFactor(p: vec2<f32>, dimFactor: f32) -> f32 {
  let r = length(p);
  // Normal night: moderate vignette. Deep night: heavy vignette.
  let strength = mix(0.50, 0.90, 1.0 - dimFactor);
  return 1.0 - smoothstep(0.35, 1.05, r) * strength;
}

/// Multi-octave animated film grain. Very subtle (~±1% luminance).
fn filmGrain(uv: vec2<f32>, time: f32) -> vec3<f32> {
  let t = time * 0.06;
  let h1 = fract(sin(dot(uv * 1.40 + t, vec2<f32>(127.13, 311.77))) * 43758.5453);
  let h2 = fract(sin(dot(uv * 2.10 - t * 0.7, vec2<f32>(269.55, 183.31))) * 43758.5453);
  let h3 = fract(sin(dot(uv * 3.70 + t * 1.3, vec2<f32>(419.21, 103.93))) * 43758.5453);
  let grain = (h1 - 0.5) * 0.008 + (h2 - 0.5) * 0.005 + (h3 - 0.5) * 0.003;
  return vec3<f32>(grain);
}

/// Ring-index color temperature shift for inverted layouts.
/// Outer rings pick up a cool blue shift; inner rings stay neutral.
fn ringTint(channel: u32, numChannels: u32, invert: bool) -> vec3<f32> {
  if (!invert) { return vec3<f32>(1.0); }
  let ringNorm = f32(channel) / f32(numChannels);
  let coolShift = smoothstep(0.0, 0.6, ringNorm) * 0.12;
  return mix(vec3<f32>(1.0), vec3<f32>(0.75, 0.82, 1.0), coolShift);
}

// ═══════════════════════════════════════════════════════════
// FRAGMENT SHADER
// ═══════════════════════════════════════════════════════════

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let p = uv - 0.5;
  let aa = fwidth(p.y) * 0.5;
  let bloom = uniforms.bloomIntensity;
  let time  = uniforms.timeSec;

  let isPlaying = (uniforms.isPlaying == 1u);
  let dimFactor = uniforms.dimFactor;
  let deepNight = dimFactor < 0.35;

  // ═══════════════════════════════════════════════════════════
  // CHANNEL 0 — UV INDICATOR RING
  // ═══════════════════════════════════════════════════════════
  if (in.channel == 0u) {
    let onPlayhead = (in.row == u32(uniforms.playheadRow));
    let indSize = vec2<f32>(0.3, 0.3);

    // Base color logic: gray when stopped, UV purple when playing,
    // bright flash on playhead.
    var indColor = vec3<f32>(0.12);
    if (isPlaying) {
      indColor = select(UV_CAST, UV_HALO, onPlayhead);
    } else if (onPlayhead) {
      indColor = NIGHT_AMBER;
    }

    // Core chrome dome (small, sharp)
    let indLed = drawChromeIndicator(p, indSize, indColor, isPlaying || onPlayhead, aa, dimFactor);
    var col = indLed.rgb;
    var alpha = indLed.a;

    // Pulsing UV halo layer (medium radius, soft)
    if (isPlaying) {
      let pulse = breathe(time);
      let haloRadius = 0.55 * pulse;
      let haloDist = length(p) / haloRadius;
      let haloMask = exp(-haloDist * haloDist * 3.0);
      let haloCol = mix(UV_CAST, UV_CORE, pulse * 0.5);
      col += haloCol * haloMask * bloom * 2.5 * dimFactor;
      alpha = max(alpha, haloMask * 0.35);

      // Outer cast — very faint purple wash on the bezel
      let castDist = length(p) / 0.9;
      let castMask = exp(-castDist * castDist * 2.0);
      col += UV_DEEP * castMask * bloom * 0.6 * dimFactor;
    }

    // Playhead flash: bright white-hot core + radial bloom
    if (onPlayhead) {
      let flashCol = select(NIGHT_AMBER, UV_HALO, isPlaying);
      let beatPulse = 1.0 + uniforms.kickTrigger * 0.5 + sin(uniforms.beatPhase * TAU) * 0.15;
      let glow = flashCol * (bloom * 6.0) * exp(-length(p) * 4.0) * beatPulse;
      col += glow;
      alpha = max(alpha, smoothstep(0.0, 0.15, length(glow)));
    }

    return vec4<f32>(col, clamp(alpha, 0.0, 1.0));
  }

  // ═══════════════════════════════════════════════════════════
  // MUSIC CHANNELS (1–32)
  // ═══════════════════════════════════════════════════════════

  // Housing with deeper night colour
  let dHousing = sdRoundedBox(p, fs.housingSize * 0.5, 0.06);
  let housingMask = 1.0 - smoothstep(0.0, aa * 1.5, dHousing);

  // Start from studio black, not the standard glass bg
  var finalColor = STUDIO_BLACK;

  // Subtle vertical gradient for depth
  finalColor += vec3<f32>(0.008, 0.008, 0.012) * (0.5 - uv.y);

  // Texture overlay (muted at night)
  let btnScale = 1.05;
  let btnUV = (uv - 0.5) * btnScale + 0.5;
  var inButton = 0.0;
  if (btnUV.x > 0.0 && btnUV.x < 1.0 && btnUV.y > 0.0 && btnUV.y < 1.0) {
    let texColor = textureSampleLevel(buttonsTexture, buttonsSampler, btnUV, 0.0).rgb;
    finalColor = mix(finalColor, texColor * dimFactor * 0.6, 0.5);
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

    // Per-ring cool tint when channels are inverted
    let rt = ringTint(in.channel, uniforms.numChannels, uniforms.invertChannels == 1u);

    // ── COMPONENT 1: DATA LIGHT (top cyan square) ──
    let topUV = btnUV - vec2<f32>(0.5, 0.16);
    let topSize = vec2<f32>(0.20, 0.20);
    let isDataPresent = hasExpression && !isMuted;
    let topColorBase = NIGHT_CYAN;
    let topColor = topColorBase * select(0.0, 1.5 + bloom, isDataPresent);
    let topLed = drawChromeIndicator(topUV, topSize, topColor, isDataPresent, aa, dimFactor);
    finalColor = mix(finalColor, topLed.rgb * rt, topLed.a);
    if (isDataPresent) { finalColor += topColor * topLed.a * 0.25 * rt; }

    // ── COMPONENT 2: MAIN NOTE LIGHT ──
    let mainUV = btnUV - vec2<f32>(0.5, 0.5);
    let mainSize = vec2<f32>(0.55, 0.45);
    var noteColor = vec3<f32>(0.08, 0.09, 0.11);
    var lightAmount = 0.0;

    if (hasNote) {
      let pitchHue = pitchClassFromPacked(in.packedA);
      let baseColor = neonPalette(pitchHue);
      // Boost saturation for night mode so notes pop against dark bg
      let saturated = pow(baseColor, vec3<f32>(0.85));
      let instBand = inst & 15u;
      let instBright = 0.8 + (select(0.0, f32(instBand) / 15.0, instBand > 0u)) * 0.2;
      noteColor = saturated * instBright;

      let linger = exp(-ch.noteAge * 1.5);
      let onPlayhead = (in.row == u32(uniforms.playheadRow));
      let strike = select(0.0, 3.5, onPlayhead);
      let flash = f32(ch.trigger) * 1.2;

      let totalSteps = f32(uniforms.numRows);
      let d = fract((f32(in.row) + uniforms.tickOffset - uniforms.playheadRow) / totalSteps) * totalSteps;
      let coreDist = min(d, totalSteps - d);
      let energy = 0.02 / (coreDist + 0.001);
      let trail = exp(-10.0 * max(0.0, -d + totalSteps * 0.5));
      let activeVal = clamp(pow(energy, 1.5) + trail, 0.0, 1.0);

      lightAmount = (activeVal * 0.8 + flash + strike + (linger * 2.0)) * clamp(ch.volume, 0.0, 1.2);
      if (isMuted) { lightAmount *= 0.15; } // Muted notes almost vanish at night
    }

    // Higher bloom multiplier for dramatic note glow
    let displayColor = noteColor * max(lightAmount, 0.1) * (1.0 + bloom * 8.0);
    let isLit = (lightAmount > 0.05);
    let mainPad = drawChromeIndicator(mainUV, mainSize, displayColor, isLit, aa, dimFactor);
    finalColor = mix(finalColor, mainPad.rgb * rt, mainPad.a);

    // ── COMPONENT 3: EFFECT LIGHT (cyan pill) ──
    let botUV = btnUV - vec2<f32>(0.5, 0.85);
    let botSize = vec2<f32>(0.25, 0.12);
    var effColor = vec3<f32>(0.0);
    var isEffOn = false;
    if (effCode > 0u) {
      effColor = effectColorFromCode(effCode, vec3<f32>(0.9, 0.8, 0.2));
      let strength = clamp(f32(effParam) / 255.0, 0.2, 1.0);
      if (!isMuted) {
        effColor *= strength * (1.0 + bloom * 2.5);
        isEffOn = true;
      }
    }
    let botLed = drawChromeIndicator(botUV, botSize, effColor, isEffOn, aa, dimFactor);
    finalColor = mix(finalColor, botLed.rgb * rt, botLed.a);
  }

  // ═══════════════════════════════════════════════════════════
  // POST-PROCESSING: Vignette, Grain, Kick, Dither
  // ═══════════════════════════════════════════════════════════

  if (housingMask < 0.5) { return vec4<f32>(fs.borderColor, 0.0); }

  // Cinematic radial vignette (scales with dimFactor)
  let vig = vignetteFactor(p, dimFactor);
  finalColor *= vig;

  // Kick reactive glow — deep magenta pulse
  finalColor += kickReactiveGlow(p, uniforms.kickTrigger, uniforms.bloomIntensity);

  // Animated film-grain atmosphere layer
  finalColor += filmGrain(in.uv, time);

  // Standard dither for banding reduction
  finalColor += ditherNoise(in.uv, time);

  // Deep Night: crush shadows slightly for more contrast
  if (deepNight) {
    finalColor = pow(finalColor, vec3<f32>(1.08));
  }

  return vec4<f32>(finalColor, 1.0);
}
