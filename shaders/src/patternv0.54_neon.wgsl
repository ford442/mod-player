// ============================================================
// patternv0.54_neon.wgsl — Source file
// Neon Night — Dark background with cyan & magenta neon accents
//
// Evolves v0.53_midnight by adding:
//   • Subtle neon grid lines (cyan vertical, magenta horizontal)
//   • Neon rim light on housing borders
//   • Cyan/magenta alternating expression lights
//   • Neon-tinted bloom bleed (colour varies by channel position)
//   • Soft neon scanline overlay
//   • Electric playhead ring with dual-colour pulse
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
// NEON PALETTE & CONSTANTS
// ═══════════════════════════════════════════════════════════

/// Pitch-black studio base.
const NEON_BLACK: vec3<f32> = vec3<f32>(0.004, 0.004, 0.007);

/// Core neon accent colours.
const NEON_CYAN: vec3<f32>    = vec3<f32>(0.00, 0.90, 1.00);
const NEON_MAGENTA: vec3<f32> = vec3<f32>(1.00, 0.20, 0.75);
const NEON_AMBER: vec3<f32>   = vec3<f32>(1.00, 0.75, 0.05);

/// Desaturated neon for subtle ambient touches.
const CYAN_DIM: vec3<f32>    = vec3<f32>(0.02, 0.25, 0.30);
const MAGENTA_DIM: vec3<f32> = vec3<f32>(0.30, 0.05, 0.20);

// ═══════════════════════════════════════════════════════════
// NEON ATMOSPHERE FUNCTIONS
// ═══════════════════════════════════════════════════════════

/// Slow dual-phase breathing for neon pulse.
fn neonBreathe(time: f32) -> vec2<f32> {
  let t1 = sin(time * 1.6);
  let t2 = sin(time * 2.1 + 1.047);
  return vec2<f32>(0.88 + 0.12 * t1, 0.88 + 0.12 * t2);
}

/// Sparse starfield — even sparser than midnight so neon pops.
fn neonStarfield(uv: vec2<f32>) -> vec3<f32> {
  let grid = floor(uv * vec2<f32>(100.0, 75.0));
  let h = fract(sin(dot(grid, vec2<f32>(127.1, 311.7))) * 43758.5453);
  let h2 = fract(sin(dot(grid + 1.0, vec2<f32>(269.5, 183.3))) * 43758.5453);

  if (h > 0.985) {
    let brightness = h2 * 0.012;
    return vec3<f32>(0.85, 0.90, 1.0) * brightness;
  }
  return vec3<f32>(0.0);
}

/// Neon grid lines — faint cyan on vertical edges, magenta on horizontal.
fn neonGrid(uv: vec2<f32>, p: vec2<f32>, isPlaying: bool) -> vec3<f32> {
  let edgeX = abs(p.x - 0.0);  // vertical cell edge
  let edgeY = abs(p.y - 0.0);  // horizontal cell edge

  let vertLine = exp(-edgeX * edgeX * 180.0) * 0.035;
  let horzLine = exp(-edgeY * edgeY * 180.0) * 0.025;

  var col = vec3<f32>(0.0);
  if (isPlaying) {
    col += NEON_CYAN    * vertLine;
    col += NEON_MAGENTA * horzLine;
  } else {
    col += CYAN_DIM    * vertLine;
    col += MAGENTA_DIM * horzLine;
  }
  return col;
}

/// Neon rim glow on housing border.
fn neonRim(dHousing: f32, aa: f32, isPlaying: bool) -> vec3<f32> {
  let rim = smoothstep(aa * 3.0, 0.0, dHousing) * smoothstep(0.0, aa * 2.0, dHousing + aa * 2.5);
  if (!isPlaying) { return CYAN_DIM * rim * 0.3; }
  return mix(NEON_CYAN, NEON_MAGENTA, 0.5) * rim * 0.45;
}

/// Neon scanline overlay — subtle horizontal bands.
fn neonScanlines(uv: vec2<f32>, time: f32) -> vec3<f32> {
  let band = sin(uv.y * 120.0 + time * 0.5) * 0.5 + 0.5;
  let intensity = band * 0.008;
  return NEON_CYAN * intensity;
}

/// Ghost echo with neon tint based on channel parity.
fn neonGhostEcho(p: vec2<f32>, noteAge: f32, bloom: f32, channel: u32) -> vec3<f32> {
  if (noteAge > 4.0 || noteAge < 0.0) { return vec3<f32>(0.0); }
  let ageFade = exp(-noteAge * 1.2);
  let spatialFade = exp(-length(p) * 2.5);
  let echo = ageFade * spatialFade * bloom * 0.4;
  let tint = select(NEON_CYAN * 0.15, NEON_MAGENTA * 0.15, (channel % 2u) == 0u);
  return tint * echo;
}

/// Ultra-subtle grain.
fn neonGrain(uv: vec2<f32>, time: f32) -> vec3<f32> {
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
  // CHANNEL 0 — DUAL-COLOUR PLAYHEAD INDICATOR
  // ═══════════════════════════════════════════════════════════
  if (in.channel == 0u) {
    let onPlayhead = (in.row == u32(uniforms.playheadRow));
    let breathe = neonBreathe(time);

    var col = NEON_BLACK;
    var alpha = 0.0;

    if (onPlayhead) {
      let core = exp(-length(p) * 9.0);
      col = NEON_CYAN * core * breathe.x + NEON_MAGENTA * core * breathe.y * 0.5;
      alpha = core * 0.9;

      let ring = exp(-length(p) * 3.8) * 0.45;
      col += mix(NEON_CYAN, NEON_MAGENTA, sin(time * 2.0) * 0.5 + 0.5) * ring * bloom;
      alpha = max(alpha, ring * 0.35);
    }

    return vec4<f32>(col, clamp(alpha, 0.0, 1.0));
  }

  // ═══════════════════════════════════════════════════════════
  // MUSIC CHANNELS (1–32)
  // ═══════════════════════════════════════════════════════════

  let dHousing = sdRoundedBox(p, fs.housingSize * 0.5, 0.06);
  let housingMask = 1.0 - smoothstep(0.0, aa * 1.5, dHousing);

  var finalColor = NEON_BLACK;

  // Starfield dust
  finalColor += neonStarfield(in.uv);

  // Neon grid lines (subtle, behind everything)
  finalColor += neonGrid(in.uv, p, isPlaying);

  // Neon rim on housing
  finalColor += neonRim(dHousing, aa, isPlaying);

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

    let maxRows = f32(uniforms.numRows);
    let playheadStep = uniforms.playheadRow - floor(uniforms.playheadRow / maxRows) * maxRows;
    let rowDistRaw = abs(f32(in.row % uniforms.numRows) - playheadStep);
    let rowDist = min(rowDistRaw, maxRows - rowDistRaw);
    let onPlayhead = rowDist < 1.5;

    // ── NEON GHOST ECHO ──
    if (!isMuted && ch.noteAge < 4.0 && ch.noteAge >= 0.0) {
      finalColor += neonGhostEcho(p, ch.noteAge, bloom, in.channel);
    }

    // ── MAIN NOTE LIGHT ──
    var noteColor = vec3<f32>(0.0);
    var lightAmount = 0.0;

    if (hasNote && !isMuted) {
      let pitchHue = pitchClassFromPacked(in.packedA);
      let baseColor = neonPalette(pitchHue);
      let saturated = pow(baseColor, vec3<f32>(0.70));
      let instBand = inst & 15u;
      let instBright = 0.9 + (select(0.0, f32(instBand) / 15.0, instBand > 0u)) * 0.2;
      noteColor = saturated * instBright;

      // Boost cyan/magenta notes for neon consistency
      let dominant = max(noteColor.r, max(noteColor.g, noteColor.b));
      if (noteColor.g > 0.5 && noteColor.b > 0.5 && noteColor.r < 0.3) {
        noteColor = mix(noteColor, NEON_CYAN, 0.25);
      } else if (noteColor.r > 0.5 && noteColor.b > 0.3 && noteColor.g < 0.4) {
        noteColor = mix(noteColor, NEON_MAGENTA, 0.25);
      }

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

    if (lightAmount > 0.01) {
      let mainUV = btnUV - vec2<f32>(0.5, 0.5);
      let mainSize = vec2<f32>(0.55, 0.45);

      let displayColor = noteColor * max(lightAmount, 0.1) * (1.0 + bloom * 10.0);
      let isLit = (lightAmount > 0.05);
      let mainPad = drawChromeIndicator(mainUV, mainSize, displayColor, isLit, aa, dimFactor);
      finalColor = mix(finalColor, mainPad.rgb, mainPad.a);

      // Neon-tinted bloom bleed — colour depends on channel parity
      let bleedRadius = length(mainUV) / 0.7;
      let bleed = exp(-bleedRadius * bleedRadius * 4.0) * lightAmount * bloom * 0.6;
      let bleedTint = select(NEON_CYAN * 0.4, NEON_MAGENTA * 0.4, (in.channel % 2u) == 0u);
      finalColor += mix(noteColor, bleedTint, 0.35) * bleed;
    }

    // ── NEON EXPRESSION LIGHT ──
    // Cyan for even channels, magenta for odd — only when active
    if (hasExpression && !isMuted && (onPlayhead || ch.trigger > 0u)) {
      let exprUV = btnUV - vec2<f32>(0.5, 0.82);
      let exprSz = vec2<f32>(0.25, 0.12);
      let exprCol = select(NEON_CYAN, NEON_MAGENTA, (in.channel % 2u) == 0u) * (0.6 + bloom);
      let exprLed = drawChromeIndicator(exprUV, exprSz, exprCol, true, aa, dimFactor);
      finalColor = mix(finalColor, exprLed.rgb, exprLed.a * 0.7);
    }

    // ── PLAYHEAD ROW HIGHLIGHT ──
    if (onPlayhead && !isMuted) {
      let lineIntensity = (1.0 - smoothstep(0.0, 0.25, rowDist)) * 0.15;
      let lineCol = mix(NEON_CYAN, NEON_MAGENTA, sin(f32(in.channel) * 0.5) * 0.5 + 0.5);
      finalColor += lineCol * lineIntensity * bloom;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // POST-PROCESSING
  // ═══════════════════════════════════════════════════════════

  if (housingMask < 0.5) { return vec4<f32>(fs.borderColor, 0.0); }

  // Kick reactive — neon amber flash
  let kickPulse = uniforms.kickTrigger * exp(-length(p) * 3.0) * 0.25;
  finalColor += NEON_AMBER * kickPulse * uniforms.bloomIntensity;

  // Neon scanlines
  finalColor += neonScanlines(in.uv, time);

  // Grain + dither
  finalColor += neonGrain(in.uv, time);
  finalColor += ditherNoise(in.uv, time);

  return vec4<f32>(finalColor, 1.0);
}
