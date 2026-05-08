// ============================================================
// pattern_bloom.wgsl — Unified Bloom Pattern Shader
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
// Requires the following includes in order:
//   1. shaders/include/bloom/core.wgsl
//   2. shaders/include/bloom/math.wgsl
//   3. shaders/include/bloom/chrome.wgsl
//   4. shaders/include/bloom/utils.wgsl
// ============================================================

// ╔════════════════════════════════════════════════════════════╗
// ║  SECTION 1 — bloom/core.wgsl                               ║
// ╚════════════════════════════════════════════════════════════╝

const PI: f32 = 3.14159265;
const TAU: f32 = 6.2831853;
const PI_HALF: f32 = 1.570796;
const NOTE_MIN: u32 = 1u;
const NOTE_OFF_MIN: u32 = 120u;

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
  dimFactor: f32,
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
  _pad3: f32,
  bloomPreset: u32,
};

@group(0) @binding(0) var<storage, read> cells: array<u32>;
@group(0) @binding(1) var<uniform> uniforms: Uniforms;
@group(0) @binding(2) var<storage, read> rowFlags: array<u32>;

struct ChannelState {
  volume: f32, pan: f32, freq: f32, trigger: u32,
  noteAge: f32, activeEffect: u32, effectValue: f32, isMuted: u32
};
@group(0) @binding(3) var<storage, read> channels: array<ChannelState>;

@group(0) @binding(4) var buttonsSampler: sampler;
@group(0) @binding(5) var buttonsTexture: texture_2d<f32>;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) @interpolate(flat) row: u32,
  @location(1) @interpolate(flat) channel: u32,
  @location(2) @interpolate(linear) uv: vec2<f32>,
  @location(3) @interpolate(flat) packedA: u32,
  @location(4) @interpolate(flat) packedB: u32,
};

@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOut {
  var quad = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0),
    vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0)
  );
  let numChannels = uniforms.numChannels;
  let row = instanceIndex / numChannels;
  let channel = instanceIndex % numChannels;
  let invertedChannel = numChannels - 1u - channel;
  let ringIndex = select(invertedChannel, channel, (uniforms.invertChannels == 1u));
  let center = vec2<f32>(uniforms.canvasW * 0.5, uniforms.canvasH * 0.5);
  let minDim = min(uniforms.canvasW, uniforms.canvasH);
  let maxRadius = minDim * 0.45;
  let minRadius = minDim * 0.15;
  let ringDepth = (maxRadius - minRadius) / f32(numChannels);
  let radius = minRadius + f32(ringIndex) * ringDepth;
  let totalSteps = f32(uniforms.numRows);
  let anglePerStep = TAU / totalSteps;
  let theta = -PI_HALF + f32(row % uniforms.numRows) * anglePerStep;
  let circumference = 2.0 * PI * radius;
  let arcLength = circumference / totalSteps;
  let btnW = arcLength * 0.92;
  let btnH = ringDepth * 0.92;
  let lp = quad[vertexIndex];
  let localPos = (lp - 0.5) * vec2<f32>(btnW, btnH);
  let rotAng = theta + PI_HALF;
  let cA = cos(rotAng);
  let sA = sin(rotAng);
  let rotX = localPos.x * cA - localPos.y * sA;
  let rotY = localPos.x * sA + localPos.y * cA;
  let worldX = center.x + cos(theta) * radius + rotX;
  let worldY = center.y + sin(theta) * radius + rotY;
  let clipX = (worldX / uniforms.canvasW) * 2.0 - 1.0;
  let clipY = 1.0 - (worldY / uniforms.canvasH) * 2.0;
  let idx = instanceIndex * 2u;
  var out: VertexOut;
  out.position = vec4<f32>(clipX, clipY, 0.0, 1.0);
  out.row = row;
  out.channel = channel;
  out.uv = lp;
  out.packedA = cells[idx];
  out.packedB = cells[idx + 1u];
  return out;
}

// ╔════════════════════════════════════════════════════════════╗
// ║  SECTION 2 — bloom/math.wgsl                               ║
// ╚════════════════════════════════════════════════════════════╝

fn sdRoundedBox(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
  let q = abs(p) - b + r;
  return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

fn neonPalette(t: f32) -> vec3<f32> {
  let a = vec3<f32>(0.5, 0.5, 0.5);
  let b = vec3<f32>(0.5, 0.5, 0.5);
  let c = vec3<f32>(1.0, 1.0, 1.0);
  let d = vec3<f32>(0.0, 0.33, 0.67);
  return a + b * cos(TAU * (c * t + d));
}

fn pitchClassFromIndex(note: u32) -> f32 {
  if (note == 0u || note >= NOTE_OFF_MIN) { return 0.0; }
  let semi = (note - 1u) % 12u;
  return f32(semi) / 12.0;
}

fn effectColorFromCode(code: u32, fallback: vec3<f32>) -> vec3<f32> {
  switch (code & 255u) {
    case 49u: { return mix(fallback, vec3<f32>(0.2, 0.85, 0.4), 0.75); }
    case 50u: { return mix(fallback, vec3<f32>(0.85, 0.3, 0.3), 0.75); }
    case 52u: { return mix(fallback, vec3<f32>(0.4, 0.7, 1.0), 0.6); }
    case 55u: { return mix(fallback, vec3<f32>(0.9, 0.6, 0.2), 0.6); }
    case 65u: { return mix(fallback, vec3<f32>(0.95, 0.9, 0.25), 0.7); }
    default:  { return fallback; }
  }
}

// ╔════════════════════════════════════════════════════════════╗
// ║  SECTION 3 — bloom/chrome.wgsl                             ║
// ╚════════════════════════════════════════════════════════════╝

struct FragmentConstants {
  bgColor: vec3<f32>,
  ledOnColor: vec3<f32>,
  ledOffColor: vec3<f32>,
  borderColor: vec3<f32>,
  housingSize: vec2<f32>,
};

fn getFragmentConstants() -> FragmentConstants {
  var c: FragmentConstants;
  c.bgColor = vec3<f32>(0.15, 0.16, 0.18);
  c.ledOnColor = vec3<f32>(0.0, 0.85, 0.95);
  c.ledOffColor = vec3<f32>(0.08, 0.08, 0.10);
  c.borderColor = vec3<f32>(0.0, 0.0, 0.0);
  c.housingSize = vec2<f32>(0.92, 0.92);
  return c;
}

fn drawChromeIndicator(
    uv: vec2<f32>, size: vec2<f32>, color: vec3<f32>,
    isOn: bool, aa: f32, dimFactor: f32
) -> vec4<f32> {
  if (abs(uv.x) > size.x * 0.6 || abs(uv.y) > size.y * 0.6) {
    return vec4<f32>(0.0);
  }
  let uv01 = (uv / size) + vec2<f32>(0.5);
  let lensR = 0.7;
  let bezelR = 0.9;
  let center = vec2<f32>(0.5, 0.5);
  let dist = length(uv01 - center) * 2.0;
  var col = vec3<f32>(0.0);
  var alpha = 0.0;
  if (dist < bezelR) {
    if (dist > lensR) {
      let angle = atan2(uv01.y - center.y, uv01.x - center.x);
      let rim = 0.2 + 0.8 * abs(sin(angle * 10.0));
      col = vec3<f32>(0.25, 0.28, 0.30) * rim * dimFactor;
      alpha = 1.0;
    } else {
      let lensNormR = dist / lensR;
      let z = sqrt(max(0.0, 1.0 - lensNormR * lensNormR));
      let localXY = (uv01 - center) / lensR;
      let normal = normalize(vec3<f32>(localXY.x, localXY.y, z));
      let lightDir = normalize(vec3<f32>(-0.5, 0.5, 1.0));
      let diffuse = max(0.0, dot(normal, lightDir));
      let reflectDir = reflect(-lightDir, normal);
      let specular = pow(max(0.0, dot(reflectDir, vec3<f32>(0.0, 0.0, 1.0))), 10.0);
      let baseColor = color * dimFactor;
      col = baseColor * (0.5 + 0.8 * diffuse);
      col += vec3<f32>(1.0) * specular * 0.5 * dimFactor;
      let rimGlow = exp(-pow(lensNormR, 2.0) * 6.0);
      col += baseColor * rimGlow * 0.25;
      alpha = 1.0;
    }
  } else {
    return vec4<f32>(vec3<f32>(0.0), 0.0);
  }
  let vignette = smoothstep(bezelR * 0.95, bezelR, dist);
  col = mix(col * (1.0 - 0.08 * vignette), vec3<f32>(0.02) * dimFactor, vignette);
  return vec4<f32>(col, alpha);
}

// ╔════════════════════════════════════════════════════════════╗
// ║  SECTION 4 — bloom/utils.wgsl                              ║
// ╚════════════════════════════════════════════════════════════╝

fn bloomBoost(base: f32, bloom: f32) -> f32 {
  return base + bloom * 2.0;
}

fn bloomBoostMedium(base: f32, bloom: f32) -> f32 {
  return base + bloom * 1.0;
}

fn bloomSoft(base: f32, bloom: f32) -> f32 {
  return base + bloom * 0.2;
}

fn pointGlow(p: vec2<f32>, color: vec3<f32>, intensity: f32, falloff: f32) -> vec3<f32> {
  return color * intensity * exp(-length(p) * falloff);
}

fn kickReactiveGlow(p: vec2<f32>, kick: f32, bloom: f32) -> vec3<f32> {
  let kickPulse = kick * exp(-length(p) * 3.0) * 0.3;
  return vec3<f32>(0.9, 0.2, 0.4) * kickPulse * bloom;
}

fn ditherNoise(uv: vec2<f32>, time: f32) -> f32 {
  let noise = fract(sin(dot(uv * time, vec2<f32>(12.9898, 78.233))) * 43758.5453);
  return (noise - 0.5) * 0.01;
}

// ╔════════════════════════════════════════════════════════════╗
// ║  SECTION 5 — MAIN ENTRY POINT (Preset-driven bloom)        ║
// ╚════════════════════════════════════════════════════════════╝

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
