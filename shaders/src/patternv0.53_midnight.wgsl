// ============================================================
// patternv0.53_midnight.wgsl — Source file
// Midnight Mode — Extreme Darkness with Isolated Note Glow
//
// Evolves v0.52_night into an even more austere aesthetic:
//   • Background is near-pitch-black (studio lights off)
//   • Only active notes, triggers, and the playhead emit light
//   • Everything else fades to black — no texture, no ambient housing
//   • Ghost-echo decay trails for recently played notes
//   • Starfield dust layer for spatial depth
//   • High bloom bleed so bright notes illuminate neighbouring cells
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
// MIDNIGHT PALETTE & CONSTANTS
// ═══════════════════════════════════════════════════════════

/// Pitch-black studio — only 0.3% luminance.
const MIDNIGHT_BLACK: vec3<f32> = vec3<f32>(0.003, 0.003, 0.005);

/// Electric blue accent for the playhead / indicator.
const ELECTRIC_BLUE: vec3<f32> = vec3<f32>(0.15, 0.55, 1.00);
const ELECTRIC_CORE: vec3<f32> = vec3<f32>(0.60, 0.85, 1.00);

/// Ghost-trail colour — desaturated version of the note colour.
const GHOST_TINT: vec3<f32> = vec3<f32>(0.25, 0.30, 0.40);

// ═══════════════════════════════════════════════════════════
// MIDNIGHT ATMOSPHERE FUNCTIONS
// ═══════════════════════════════════════════════════════════

/// Ultra-slow breathing for the playhead indicator.
fn midnightBreathe(time: f32) -> f32 {
  return 0.90 + 0.10 * sin(time * 1.8);
}

/// Starfield dust — sparse, very faint points of light.
/// Uses a grid-based hash so stars are static (no animation).
fn starfieldDust(uv: vec2<f32>) -> vec3<f32> {
  let grid = floor(uv * vec2<f32>(80.0, 60.0));
  let h = fract(sin(dot(grid, vec2<f32>(127.1, 311.7))) * 43758.5453);
  let h2 = fract(sin(dot(grid + 1.0, vec2<f32>(269.5, 183.3))) * 43758.5453);

  // Only 3% of grid cells get a star
  if (h > 0.97) {
    let brightness = h2 * 0.015;
    let temp = mix(vec3<f32>(0.8, 0.9, 1.0), vec3<f32>(1.0, 0.85, 0.6), h2);
    return temp * brightness;
  }
  return vec3<f32>(0.0);
}

/// Ghost echo — a fading trail for notes that were recently active.
/// Returns 0.0–1.0 based on channel noteAge and a radial falloff.
fn ghostEcho(p: vec2<f32>, noteAge: f32, bloom: f32) -> f32 {
  if (noteAge > 4.0 || noteAge < 0.0) { return 0.0; }
  let ageFade = exp(-noteAge * 1.2);
  let spatialFade = exp(-length(p) * 2.5);
  return ageFade * spatialFade * bloom * 0.4;
}

/// Ultra-subtle film grain — barely perceptible.
fn midnightGrain(uv: vec2<f32>, time: f32) -> vec3<f32> {
  let t = time * 0.04;
  let h = fract(sin(dot(uv * 2.3 + t, vec2<f32>(127.1, 311.7))) * 43758.5453);
  return vec3<f32>((h - 0.5) * 0.004);
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
  let time = uniforms.timeSec;

  let isPlaying = (uniforms.isPlaying == 1u);
  let dimFactor = uniforms.dimFactor;

  // ═══════════════════════════════════════════════════════════
  // CHANNEL 0 — MINIMAL PLAYHEAD INDICATOR
  // ═══════════════════════════════════════════════════════════
  if (in.channel == 0u) {
    let onPlayhead = (in.row == u32(uniforms.playheadRow));
    let pulse = midnightBreathe(time);

    // Tiny sharp core when on playhead, otherwise invisible
    var col = MIDNIGHT_BLACK;
    var alpha = 0.0;

    if (onPlayhead) {
      let core = exp(-length(p) * 8.0);
      col = ELECTRIC_CORE * core * pulse;
      alpha = core * 0.9;

      // Sharp bloom ring
      let ring = exp(-length(p) * 3.5) * 0.4;
      col += ELECTRIC_BLUE * ring * bloom * pulse;
      alpha = max(alpha, ring * 0.3);
    }

    return vec4<f32>(col, clamp(alpha, 0.0, 1.0));
  }

  // ═══════════════════════════════════════════════════════════
  // MUSIC CHANNELS (1–32)
  // ═══════════════════════════════════════════════════════════

  // Housing is reduced to a hairline — almost invisible
  let dHousing = sdRoundedBox(p, fs.housingSize * 0.5, 0.06);
  let housingMask = 1.0 - smoothstep(0.0, aa * 1.5, dHousing);

  var finalColor = MIDNIGHT_BLACK;

  // Starfield dust (only visible in the gaps between cells)
  finalColor += starfieldDust(in.uv);

  let btnScale = 1.05;
  let btnUV = (uv - 0.5) * btnScale + 0.5;
  var inButton = 0.0;
  if (btnUV.x > 0.0 && btnUV.x < 1.0 && btnUV.y > 0.0 && btnUV.y < 1.0) {
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

    // Playhead proximity
    let maxRows = f32(uniforms.numRows);
    let playheadStep = uniforms.playheadRow - floor(uniforms.playheadRow / maxRows) * maxRows;
    let rowDistRaw = abs(f32(in.row % uniforms.numRows) - playheadStep);
    let rowDist = min(rowDistRaw, maxRows - rowDistRaw);
    let onPlayhead = rowDist < 1.5;

    // ── GHOST ECHO (fading trail from recent notes) ──
    if (!isMuted && ch.noteAge < 4.0 && ch.noteAge >= 0.0) {
      let ghost = ghostEcho(p, ch.noteAge, bloom);
      finalColor += GHOST_TINT * ghost;
    }

    // ── MAIN NOTE LIGHT ──
    var noteColor = vec3<f32>(0.0);
    var lightAmount = 0.0;

    if (hasNote && !isMuted) {
      let pitchHue = pitchClassFromPacked(in.packedA);
      let baseColor = neonPalette(pitchHue);
      // Boost saturation and brightness for midnight pop
      let saturated = pow(baseColor, vec3<f32>(0.75));
      let instBand = inst & 15u;
      let instBright = 0.9 + (select(0.0, f32(instBand) / 15.0, instBand > 0u)) * 0.2;
      noteColor = saturated * instBright;

      let linger = exp(-ch.noteAge * 1.5);
      let strike = select(0.0, 4.0, onPlayhead);
      let flash = f32(ch.trigger) * 1.5;

      let totalSteps = f32(uniforms.numRows);
      let d = fract((f32(in.row) + uniforms.tickOffset - uniforms.playheadRow) / totalSteps) * totalSteps;
      let coreDist = min(d, totalSteps - d);
      let energy = 0.02 / (coreDist + 0.001);
      let trail = exp(-10.0 * max(0.0, -d + totalSteps * 0.5));
      let activeVal = clamp(pow(energy, 1.5) + trail, 0.0, 1.0);

      lightAmount = (activeVal * 0.8 + flash + strike + (linger * 2.0)) * clamp(ch.volume, 0.0, 1.2);
    }

    // Draw only if there's actual light — inactive cells stay black
    if (lightAmount > 0.01) {
      let mainUV = btnUV - vec2<f32>(0.5, 0.5);
      let mainSize = vec2<f32>(0.55, 0.45);

      // High bloom multiplier for dramatic bleed
      let displayColor = noteColor * max(lightAmount, 0.1) * (1.0 + bloom * 10.0);
      let isLit = (lightAmount > 0.05);
      let mainPad = drawChromeIndicator(mainUV, mainSize, displayColor, isLit, aa, dimFactor);
      finalColor = mix(finalColor, mainPad.rgb, mainPad.a);

      // Bloom bleed into surrounding darkness
      let bleedRadius = length(mainUV) / 0.7;
      let bleed = exp(-bleedRadius * bleedRadius * 4.0) * lightAmount * bloom * 0.6;
      finalColor += noteColor * bleed;
    }

    // ── EXPRESSION LIGHT ──
    // Only visible when actively present AND on playhead or triggered
    if (hasExpression && !isMuted && (onPlayhead || ch.trigger > 0u)) {
      let exprUV = btnUV - vec2<f32>(0.5, 0.82);
      let exprSz = vec2<f32>(0.25, 0.12);
      let exprCol = ELECTRIC_BLUE * (0.6 + bloom);
      let exprLed = drawChromeIndicator(exprUV, exprSz, exprCol, true, aa, dimFactor);
      finalColor = mix(finalColor, exprLed.rgb, exprLed.a * 0.7);
    }

    // ── PLAYHEAD ROW HIGHLIGHT ──
    // A razor-thin electric blue line on the playhead row
    if (onPlayhead && !isMuted) {
      let lineIntensity = (1.0 - smoothstep(0.0, 0.25, rowDist)) * 0.15;
      finalColor += ELECTRIC_BLUE * lineIntensity * bloom;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // POST-PROCESSING
  // ═══════════════════════════════════════════════════════════

  if (housingMask < 0.5) { return vec4<f32>(fs.borderColor, 0.0); }

  // Kick reactive glow — deeper, more saturated magenta
  let kickPulse = uniforms.kickTrigger * exp(-length(p) * 3.0) * 0.25;
  finalColor += vec3<f32>(0.85, 0.15, 0.50) * kickPulse * uniforms.bloomIntensity;

  // Ultra-subtle grain
  finalColor += midnightGrain(in.uv, time);

  // Dither for banding
  finalColor += ditherNoise(in.uv, time);

  return vec4<f32>(finalColor, 1.0);
}
