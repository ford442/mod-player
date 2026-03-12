// patternv0.50.wgsl
// Frosted Glass Circular – Vibrant Note Colours + Blue LED Indicator + Full-Height Caps
//
// Hybrid composition combining v0.48 (vibrant note-data colours from neonPalette)
// and v0.49 (blue LED indicator ring, solid housing, frosted glass caps).
//
// Per-step layering:
//   1. HOUSING (BEHINDS) — Solid dark-metallic body lit with vibrant neonPalette
//                          colours driven by real note pitch (purple, teal, green,
//                          orange, red, cyan).  Activity from v0.48's distance-based
//                          energy sweep + trail + noteAge + tickOffset sub-step.
//   2. CAP — Full-height frosted acrylic glass (0.88 × 0.88) in the same vibrant
//            hue as the housing.  LED-under-glass model with white bevel rim.
//   3. DEPRESSION — On playhead hit: cap scales 4 % smaller + top inner-shadow.
//
// Channel 0: Blue LED indicator ring shows playhead proximity (from v0.49).
//
// Background: bezel.wgsl (hardware photo with dark centre + white frame).
// Transparent gaps + centre circle allow bezel to show through.

struct Uniforms {
  numRows: u32,
  numChannels: u32,
  playheadRow: f32,
  isPlaying: u32,
  cellW: f32,
  cellH: f32,
  canvasW: f32,
  canvasH: f32,
  tickOffset: f32,
  bpm: f32,
  timeSec: f32,
  beatPhase: f32,
  groove: f32,
  kickTrigger: f32,
  activeChannels: u32,
  isModuleLoaded: u32,
  bloomIntensity: f32,
  bloomThreshold: f32,
  invertChannels: u32,
};

@group(0) @binding(0) var<storage, read> cells: array<u32>;
@group(0) @binding(1) var<uniform> uniforms: Uniforms;
@group(0) @binding(2) var<storage, read> rowFlags: array<u32>;

struct ChannelState { volume: f32, pan: f32, freq: f32, trigger: u32, noteAge: f32, activeEffect: u32, effectValue: f32, isMuted: u32 };
@group(0) @binding(3) var<storage, read> channels: array<ChannelState>;
@group(0) @binding(4) var buttonsSampler: sampler;
@group(0) @binding(5) var buttonsTexture: texture_2d<f32>;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) @interpolate(flat)   row:     u32,
  @location(1) @interpolate(flat)   channel: u32,
  @location(2) @interpolate(linear) uv:      vec2<f32>,
  @location(3) @interpolate(flat)   packedA: u32,
  @location(4) @interpolate(flat)   packedB: u32,
};

@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOut {
  var quad = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0),
    vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0)
  );

  let numChannels = uniforms.numChannels;
  let row         = instanceIndex / numChannels;
  let channel     = instanceIndex % numChannels;

  let invertedChannel = numChannels - 1u - channel;
  let ringIndex = select(invertedChannel, channel, uniforms.invertChannels == 1u);

  let center    = vec2<f32>(uniforms.canvasW * 0.5, uniforms.canvasH * 0.5);
  let minDim    = min(uniforms.canvasW, uniforms.canvasH);
  let maxRadius = minDim * 0.45;
  let minRadius = minDim * 0.15;
  let ringDepth = (maxRadius - minRadius) / f32(numChannels);
  let radius    = minRadius + f32(ringIndex) * ringDepth;

  let totalSteps   = 64.0;
  let anglePerStep = 6.2831853 / totalSteps;
  let theta        = -1.570796 + f32(row % 64u) * anglePerStep;

  let circumference = 2.0 * 3.14159265 * radius;
  let arcLength     = circumference / totalSteps;
  let btnW          = arcLength * 0.95;
  let btnH          = ringDepth * 0.95;

  let lp       = quad[vertexIndex];
  let localPos = (lp - 0.5) * vec2<f32>(btnW, btnH);

  let rotAng = theta + 1.570796;
  let cA = cos(rotAng); let sA = sin(rotAng);
  let rotX = localPos.x * cA - localPos.y * sA;
  let rotY = localPos.x * sA + localPos.y * cA;

  let worldX = center.x + cos(theta) * radius + rotX;
  let worldY = center.y + sin(theta) * radius + rotY;

  let clipX = (worldX / uniforms.canvasW) * 2.0 - 1.0;
  let clipY = 1.0 - (worldY / uniforms.canvasH) * 2.0;

  let idx = instanceIndex * 2u;
  let a   = cells[idx];
  let b   = cells[idx + 1u];

  var out: VertexOut;
  out.position = vec4<f32>(clipX, clipY, 0.0, 1.0);
  out.row      = row;
  out.channel  = channel;
  out.uv       = lp;
  out.packedA  = a;
  out.packedB  = b;
  return out;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn neonPalette(t: f32) -> vec3<f32> {
  let a = vec3<f32>(0.5, 0.5, 0.5);
  let b = vec3<f32>(0.5, 0.5, 0.5);
  let c = vec3<f32>(1.0, 1.0, 1.0);
  let d = vec3<f32>(0.0, 0.33, 0.67);
  let beatDrift = uniforms.beatPhase * 0.08;
  return a + b * cos(6.28318 * (c * (t + beatDrift) + d));
}

fn sdRoundedBox(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
  let q = abs(p) - b + r;
  return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

fn pitchClassFromIndex(note: u32) -> f32 {
  if (note == 0u) { return 0.0; }
  return f32((note - 1u) % 12u) / 12.0;
}

// ── Frosted Glass Cap (LED-Under-Glass) ──────────────────────────────────────
fn drawGlassCap(p: vec2<f32>, size: vec2<f32>, ledColor: vec3<f32>, ledIntensity: f32, aa: f32) -> vec4<f32> {
  let dBox = sdRoundedBox(p, size * 0.5, 0.07);
  if (dBox > 0.0) { return vec4<f32>(0.0); }

  let radial  = length(p / (size * 0.5));
  let n       = normalize(vec3<f32>(p.x * 2.0 / size.x, p.y * 2.0 / size.y, 0.4));
  let viewDir = vec3<f32>(0.0, 0.0, 1.0);
  let fresnel = pow(1.0 - abs(dot(n, viewDir)), 2.5);

  // LED hotspot & scatter through frosted glass
  let hotspot = exp(-radial * radial * 3.2) * ledIntensity;
  let scatter = exp(-radial * 2.2)          * ledIntensity * 0.55;

  // Frosted glass base
  let glassDark  = vec3<f32>(0.14, 0.15, 0.18);
  let glassLight = mix(glassDark, ledColor * 0.85, clamp(ledIntensity * 0.5, 0.0, 0.7));

  // Directional lighting
  let light = normalize(vec3<f32>(0.4, -0.7, 1.0));
  let diff  = max(0.0, dot(n, light));
  let litGlass = glassLight * (0.55 + 0.45 * diff);

  // White bevel rim
  let rimMask = smoothstep(0.0, aa * 3.0, -dBox) * (1.0 - smoothstep(aa * 3.0, aa * 6.0, -dBox));
  let rimLight = vec3<f32>(0.9, 0.92, 0.95) * rimMask * 0.45;

  var col = litGlass;
  col    += ledColor * hotspot * 2.0;
  col    += ledColor * scatter * 0.55;
  col    += ledColor * fresnel * ledIntensity * 0.40;
  col    += rimLight;

  let edgeAlpha  = smoothstep(0.0, aa * 2.0, -dBox);
  let glassAlpha = edgeAlpha * (0.68 + 0.22 * fresnel + ledIntensity * 0.10);

  return vec4<f32>(col, clamp(glassAlpha, 0.0, 0.92));
}

// ── Fragment ──────────────────────────────────────────────────────────────────
@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let p  = uv - 0.5;
  let aa = fwidth(p.y) * 0.33;

  if (in.channel >= uniforms.numChannels) { return vec4<f32>(0.0); }

  let bloom = uniforms.bloomIntensity;
  let kick  = uniforms.kickTrigger;
  let beat  = uniforms.beatPhase;

  if (in.position.y > uniforms.canvasH * 0.88) { discard; }

  // ── Playhead proximity ────────────────────────────────────────────────────
  let totalSteps   = 64.0;
  let playheadStep = uniforms.playheadRow - floor(uniforms.playheadRow / totalSteps) * totalSteps;
  let rowDistRaw   = abs(f32(in.row % 64u) - playheadStep);
  let rowDist      = min(rowDistRaw, totalSteps - rowDistRaw);
  let playheadHit  = 1.0 - smoothstep(0.0, 1.5, rowDist);

  // ── CHANNEL 0 — Blue LED Indicator Ring ───────────────────────────────────
  if (in.channel == 0u) {
    let ledOnColor   = vec3<f32>(0.0, 0.7, 1.0);  // Bright cyan blue
    let indSize      = vec2<f32>(0.30, 0.30);
    let indIntensity = playheadHit * 1.8;
    let indColor     = mix(vec3<f32>(0.08, 0.12, 0.20), ledOnColor, playheadHit);
    let indCap       = drawGlassCap(p, indSize, indColor, indIntensity, aa);

    var col   = indCap.rgb;
    var alpha = indCap.a;
    if (playheadHit > 0.01) {
      let beatPulse = 1.0 + kick * 0.7 + (0.5 + 0.5 * sin(beat * 6.2832)) * 0.2;
      let glow = ledOnColor * (bloom * 4.5) * exp(-length(p) * 3.5) * playheadHit * beatPulse;
      col  += glow;
      alpha = max(alpha, smoothstep(0.0, 0.25, length(glow)));
    }
    return vec4<f32>(col, clamp(alpha, 0.0, 1.0));
  }

  // ── MUSIC CHANNELS — Vibrant Note Colours ────────────────────────────────

  // Extract pattern data
  let note   = (in.packedA >> 24) & 255u;
  let inst   = (in.packedA >> 16) & 255u;
  let effCmd = (in.packedB >>  8) & 255u;
  let hasNote = note > 0u;

  let ch      = channels[in.channel];
  let isMuted = ch.isMuted == 1u;

  // ── 1. HOUSING (BEHINDS) ──────────────────────────────────────────────────
  // Solid dark-metallic body filled with vibrant neonPalette colours
  let housingSize = vec2<f32>(0.92, 0.92);
  let dHousing    = sdRoundedBox(p, housingSize * 0.5, 0.07);
  let housingMask = 1.0 - smoothstep(0.0, aa * 1.5, dHousing);

  let metalDark = vec3<f32>(0.07, 0.08, 0.11);
  var housingColor = metalDark;
  var noteHue      = vec3<f32>(0.0);
  var actGlow      = 0.0;

  if (hasNote && !isMuted) {
    // Get vibrant colour from pitch class (purple, teal, green, orange, red, cyan)
    let pitchHue = pitchClassFromIndex(note);
    let baseColor = neonPalette(pitchHue);
    // Instrument brightness variation (from v0.48)
    let instBand   = inst & 15u;
    let instBright = 0.85 + select(0.0, f32(instBand) / 15.0, instBand > 0u) * 0.15;
    noteHue = baseColor * instBright;

    // ── Distance-based energy sweep (from v0.48) ──────────────────────────
    // Uses tickOffset for sub-step smooth animation
    let d        = fract((f32(in.row) + uniforms.tickOffset - uniforms.playheadRow) / totalSteps) * totalSteps;
    let coreDist = min(d, totalSteps - d);
    let energy   = 0.03 / (coreDist + 0.001);
    let trail    = exp(-7.0 * max(0.0, -d));
    let activeVal = clamp(pow(energy, 1.3) + trail, 0.0, 1.0);

    // Note lingering + trigger flash
    let linger   = exp(-ch.noteAge * 1.2);
    let flash    = f32(ch.trigger) * 1.2;
    let strike   = playheadHit * 3.5;
    let beatBoost = 1.0 + kick * 0.5;
    let volScale = clamp(ch.volume, 0.0, 1.2);

    // Combined glow: distance energy + lingering + flash + strike (from v0.48)
    actGlow = clamp((activeVal * 0.9 + flash + strike + linger * 2.5) * volScale * beatBoost, 0.0, 3.0);
    let totalGlow = max(actGlow, playheadHit * 3.0);

    // Housing tint: metallic dark → vibrant note hue, minimum 10% when note present
    housingColor = mix(metalDark, noteHue, clamp(totalGlow + 0.10, 0.0, 1.0));
  }

  var finalColor = vec3<f32>(0.0);  // Transparent start
  finalColor = mix(finalColor, housingColor, housingMask);

  // ── 2. CAP — Full-height frosted glass with same vibrant hue ──────────────
  var ledColor:     vec3<f32>;
  var ledIntensity: f32;

  if (!hasNote || isMuted) {
    // No note: very dim
    ledColor     = vec3<f32>(0.04, 0.04, 0.06);
    ledIntensity = 0.05;
  } else {
    // Note present: vibrant neonPalette colour boosted by bloom (from v0.48)
    ledColor     = noteHue * max(actGlow, 0.12) * (1.0 + bloom * 8.0);
    // Intensity: minimum 0.38 so cap always visible + activity boost
    ledIntensity = max(0.38 + clamp(actGlow, 0.0, 1.0) * 0.65, playheadHit * 1.7 + clamp(actGlow, 0.0, 1.0));
  }

  // ── 3. DEPRESSION — Cap scales smaller on playhead hit ─────────────────────
  let capBaseScale = 0.88;
  let capScale     = capBaseScale - playheadHit * 0.04;  // 0.88 → 0.84 on hit
  let capSize      = vec2<f32>(capScale, capScale);

  let cap      = drawGlassCap(p, capSize, ledColor, ledIntensity, aa);
  finalColor   = mix(finalColor, cap.rgb, cap.a);

  // Blue→orange beat-sync pulse on active steps with notes (from v0.48)
  if (playheadHit > 0.5 && hasNote && !isMuted) {
    let pulseColor = mix(vec3<f32>(0.15, 0.5, 1.0), vec3<f32>(1.0, 0.55, 0.1), 0.5 + 0.5 * sin(beat * 6.2832));
    finalColor += pulseColor * playheadHit * 0.15;
  }

  // Top inner-shadow when actively pressed
  if (playheadHit > 0.2) {
    let shadowY    = p.y + capSize.y * 0.38;
    let innerShadow = smoothstep(0.06, 0.0, shadowY) * playheadHit * 0.30;
    finalColor    -= vec3<f32>(innerShadow);
  }

  // ── Kick-reactive pulse ───────────────────────────────────────────────────
  let kickPulse = kick * exp(-length(p) * 3.0) * 0.15;
  finalColor   += vec3<f32>(0.9, 0.2, 0.4) * kickPulse * bloom;

  // ── Noise / dither ────────────────────────────────────────────────────────
  let noise = fract(sin(dot(in.uv * uniforms.timeSec, vec2<f32>(12.9898, 78.233))) * 43758.5453);
  finalColor += (noise - 0.5) * 0.007;

  // Return opaque in housing area, transparent elsewhere (bezel shows through)
  return vec4<f32>(clamp(finalColor, vec3<f32>(0.0), vec3<f32>(3.0)), housingMask);
}
