// ============================================================
// patternv0.51.wgsl — Source file
// Three-Emitter LED Indicator System with Unified Lens Cap + Playhead Arc
//
// Assembled via build-shaders.mjs from:
//   #include "common.wgsl"
//   #include "bloom_utils.wgsl"
//   #include "pattern_base.wgsl"
//
// Note: Requires padTopChannel=true in PatternDisplay to shift music channels 1-32.
// DURA UPDATE: Added note duration visualization with sustain tails
// ARC-001: Added animated playhead scan-line arc at current row
// ============================================================

#include "common.wgsl"
#include "bloom_utils.wgsl"
#include "pattern_base.wgsl"

// --- MAIN ENTRY POINT (v0.51-specific logic) ---
// This is the ONLY part that changes between versions.
// Everything above is shared with v0.50, v0.49, etc.

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
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

  // ── PLAYHEAD ARC OVERLAY (ARC-001) ──
  // Unique to v0.51: animated scan-line arc at the current playhead row.
  let minDim = min(uniforms.canvasW, uniforms.canvasH);
  let rInner = minDim * 0.15;
  let rOuter = minDim * 0.45;

  let pixelPos = in.position.xy;
  let center = vec2<f32>(uniforms.canvasW * 0.5, uniforms.canvasH * 0.5);
  let delta = pixelPos - center;
  let fragAngle = atan2(delta.y, delta.x);
  let fragRadius = length(delta);

  let totalSteps = f32(uniforms.numRows);
  let rowAngle = -PI_HALF + (uniforms.playheadRow / totalSteps) * TAU;

  var angleDelta = fragAngle - rowAngle;
  angleDelta = atan2(sin(angleDelta), cos(angleDelta));

  let angularMask = smoothstep(0.018, 0.002, abs(angleDelta));
  let radialMask = smoothstep(rInner - 4.0, rInner + 4.0, fragRadius) *
                   smoothstep(rOuter + 4.0, rOuter - 4.0, fragRadius);

  let pulse = 1.0 + 0.02 * sin(uniforms.timeSec * 6.0);
  let arcIntensity = 0.7 * pulse;
  let arcColor = vec3<f32>(1.0, 0.85, 0.3);
  let arcContrib = arcColor * angularMask * radialMask * arcIntensity;

  // Smooth playhead position for per-cell activation
  let maxRows = f32(uniforms.numRows);
  let playheadStep = uniforms.playheadRow - floor(uniforms.playheadRow / maxRows) * maxRows;
  let rowDistRaw = abs(f32(in.row % uniforms.numRows) - playheadStep);
  let rowDist = min(rowDistRaw, maxRows - rowDistRaw);
  let playheadActivation = 1.0 - smoothstep(0.0, 1.5, rowDist);

  // ═══════════════════════════════════════════════════════════
  // CHANNEL 0 — Indicator Ring
  // ═══════════════════════════════════════════════════════════
  if (in.channel == 0u) {
    let indSize = vec2<f32>(0.3, 0.3);
    let indColor = mix(vec3<f32>(0.15), fs.ledOnColor * 1.3, playheadActivation);
    let indLed = drawUnifiedLensCap(
        p, indSize,
        vec4<f32>(indColor, playheadActivation),
        vec4<f32>(indColor, playheadActivation),
        vec4<f32>(indColor, playheadActivation),
        aa
    );
    var col = indLed.rgb;
    var alpha = indLed.a;
    if (playheadActivation > 0.0) {
      let beatPulse = 1.0 + kick * 0.6 + (0.5 + 0.5 * sin(beat * TAU)) * 0.2;
      let glow = fs.ledOnColor * (bloom * 5.0) * exp(-length(p) * 3.5) * playheadActivation * beatPulse;
      col += glow;
      alpha = max(alpha, smoothstep(0.0, 0.25, length(glow)));
    }
    col += arcContrib;
    return vec4<f32>(col, clamp(alpha, 0.0, 1.0));
  }

  // ═══════════════════════════════════════════════════════════
  // CHANNELS 1–32 — Music channels with Three-Emitter LED System
  // ═══════════════════════════════════════════════════════════
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
    // Unpack cell data
    let note = (in.packedA >> 24) & 255u;
    let instRaw = (in.packedA >> 16) & 255u;
    let volPacked = in.packedA & 255u;

    let effCmd = (in.packedB >> 24) & 255u;
    let effVal = (in.packedB >> 16) & 255u;
    let volCmdFull = in.packedB & 255u;

    // Expression-only flag from bit 7 of instrument field
    let isExpressionOnly = (instRaw & 128u) != 0u;
    let inst = instRaw & 127u;

    // Reconstruct volume command from packed nibble
    let volCmd = (volPacked >> 4) << 4;

    // DURA: use shared unpack helper for duration metadata
    let dInfo = unpackDurationInfo(in.packedA, in.packedB);

    // AMBER-BLUE: Cell-type classification
    let isNoteOn   = (note > 0u && note < NOTE_OFF_MIN && dInfo.rowOffset == 0u);
    let isNoteOff  = (note >= NOTE_OFF_MIN);
    let isExprOnly = (!isNoteOn && !isNoteOff && isExpressionOnly);
    let isSustain  = (note > 0u && note < NOTE_OFF_MIN && dInfo.duration > 1u && dInfo.rowOffset > 0u && !dInfo.isNoteOff);
    let isDead     = (!isNoteOn && !isExprOnly && !isSustain && !isNoteOff);

    let ch = channels[in.channel];
    let isMuted = (ch.isMuted == 1u);
    let hasExpression = (volCmd > 0u) || (effCmd > 0u) || (volCmdFull > 0u);

    // ── EMITTER 1 (TOP): Semantic indicator ──
    let blueColor  = vec3<f32>(0.05, 0.45, 1.0);
    let amberColor = vec3<f32>(1.0, 0.55, 0.0);
    var topColor = vec3<f32>(0.0);
    var topIntensity = calculateTopIntensity(isNoteOn, isExprOnly, isSustain, isMuted, ch.trigger, bloom, beat);
    if (isNoteOn) {
      topColor = blueColor;
    } else if (isExprOnly) {
      topColor = amberColor;
    } else if (isSustain) {
      topColor = blueColor;
    }

    // ── EMITTER 2 (MIDDLE): Note color (pitch-class) or dark ──
    var noteColor = DEAD_COLOR;
    var midIntensity = 0.02;

    if (isNoteOn || isSustain) {
      let pitchHue = pitchClassFromIndex(note);
      let baseColor = neonPalette(pitchHue);
      let instBand = inst & 15u;
      let instBright = 0.85 + (select(0.0, f32(instBand) / 15.0, instBand > 0u)) * 0.15;
      noteColor = baseColor * instBright;

      if (isNoteOn) {
        midIntensity = calculateSustainBrightness(dInfo, bloomBoost(0.8, bloom));
      } else {
        midIntensity = 0.45 + bloom * 0.5;
      }
      if (isMuted) { midIntensity *= 0.25; }
    } else if (isNoteOff) {
      noteColor = vec3<f32>(0.3, 0.3, 0.35);
      midIntensity = 0.2 + 0.1 * sin(uniforms.timeSec * 4.0);
    } else if (isExprOnly) {
      noteColor = DEAD_COLOR;
      midIntensity = 0.0;
    } else if (isDead) {
      noteColor = DEAD_COLOR;
      midIntensity = 0.02;
    }
    let midColor = noteColor;

    // ── EMITTER 3 (BOTTOM): Control indicator ──
    var botIntensity = 0.0;
    var botColor = vec3<f32>(0.0);
    if (!isMuted && !isExprOnly) {
      if (isNoteOn && hasExpression) {
        botIntensity = bloomBoost(1.0, bloom);
        botColor = amberColor;
      } else if (isSustain && hasExpression) {
        botIntensity = bloomBoostMedium(0.6, bloom);
        botColor = amberColor;
      }
    }

    // ── Draw unified lens cap ──
    let lensUV = btnUV - vec2<f32>(0.5, 0.5);
    let lensSize = vec2<f32>(0.6, 0.82);

    let unifiedLens = drawUnifiedLensCap(
        lensUV, lensSize,
        vec4<f32>(topColor, topIntensity),
        vec4<f32>(midColor, midIntensity),
        vec4<f32>(botColor, botIntensity),
        aa
    );

    finalColor = mix(finalColor, unifiedLens.rgb, unifiedLens.a);

    // Enhanced external glow for active notes under the playhead
    if (playheadActivation > 0.5 && (isNoteOn || isSustain)) {
      let pulseColor = mix(blueColor, noteColor, 0.5 + 0.5 * sin(beat * TAU));
      let sustainBoost = select(1.0, 1.5, isSustain && !isNoteOn);
      finalColor += pulseColor * playheadActivation * 0.15 * sustainBoost;
    }
  }

  // Kick reactive bloom flash
  finalColor += kickReactiveGlow(p, kick, bloom);

  // Playhead arc overlay
  finalColor += arcContrib;

  // Dithering for night mode
  finalColor += ditherNoise(in.uv, uniforms.timeSec);

  // Idle cells: thin outer stroke instead of invisible
  if (housingMask < 0.5) {
    if (dHousing < 0.02) {
      return vec4<f32>(fs.ledOffColor, 1.0);
    }
    return vec4<f32>(fs.borderColor, 0.0);
  }
  return vec4<f32>(finalColor, 1.0);
}
