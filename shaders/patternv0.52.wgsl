// patternv0.52.wgsl
// "Night" — dim dusky circular three-emitter LED (v0.50 family).
// Combines v0.51's animated playhead-arc scan line with v0.56's
// per-instrument palette texture sampling.

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
  _r0: f32,
  _r1: f32,
  _r2: f32,
  _r3: f32,
  colorPalette: u32,
  innerRadius: f32,
  outerRadius: f32,
  vignetteStrength: f32,
  themeBlend: f32,
  filmGrain: f32,
  nightPreset: u32,
  invertMix: f32,
  paletteMode: u32,
};

//#include "lib/notes.wgsl"

// NIGHT-52 THEME — dim dusky night
const THEME_BG: vec3<f32> = vec3<f32>(0.025, 0.027, 0.032);
const THEME_LED_OFF: vec3<f32> = vec3<f32>(0.035, 0.037, 0.045);
const THEME_LED_ON: vec3<f32> = vec3<f32>(0.95, 0.50, 0.08);
const THEME_LIT_TINT: vec3<f32> = vec3<f32>(0.80, 0.82, 0.88);
const THEME_RIM: vec3<f32> = vec3<f32>(0.20, 0.30, 0.45);
const THEME_ARC: vec3<f32> = vec3<f32>(0.85, 0.75, 0.30);
const THEME_KICK: vec3<f32> = vec3<f32>(0.75, 0.15, 0.35);
const THEME_BLOOM_MULT: f32 = 0.90;

@group(0) @binding(0) var<storage, read> cells: array<u32>;
@group(0) @binding(1) var<uniform> uniforms: Uniforms;
@group(0) @binding(2) var<storage, read> rowFlags: array<u32>;

struct ChannelState { volume: f32, pan: f32, freq: f32, trigger: u32, noteAge: f32, activeEffect: u32, effectValue: f32, isMuted: u32 };
@group(0) @binding(3) var<storage, read> channels: array<ChannelState>;
@group(0) @binding(4) var buttonsSampler: sampler;
@group(0) @binding(5) var buttonsTexture: texture_2d<f32>;
@group(0) @binding(7) var instrumentPalette: texture_1d<f32>;

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
  let anglePerStep = 6.2831853 / totalSteps;
  let theta = -1.570796 + f32(row % uniforms.numRows) * anglePerStep;

  let circumference = 2.0 * 3.14159265 * radius;
  let arcLength = circumference / totalSteps;

  let btnW = arcLength * 0.95;
  let btnH = ringDepth * 0.95;

  let lp = quad[vertexIndex];
  let localPos = (lp - 0.5) * vec2<f32>(btnW, btnH);

  let rotAng = theta + 1.570796;
  let cA = cos(rotAng);
  let sA = sin(rotAng);

  let rotX = localPos.x * cA - localPos.y * sA;
  let rotY = localPos.x * sA + localPos.y * cA;

  let worldX = center.x + cos(theta) * radius + rotX;
  let worldY = center.y + sin(theta) * radius + rotY;

  let clipX = (worldX / uniforms.canvasW) * 2.0 - 1.0;
  let clipY = 1.0 - (worldY / uniforms.canvasH) * 2.0;

  let idx = instanceIndex * 2u;
  let a = cells[idx];
  let b = cells[idx + 1u];

  var out: VertexOut;
  out.position = vec4<f32>(clipX, clipY, 0.0, 1.0);
  out.row = row;
  out.channel = channel;
  out.uv = lp;
  out.packedA = a;
  out.packedB = b;
  return out;
}

//#include "lib/palette.wgsl"

//#include "lib/sdf.wgsl"

//#include "lib/tonemap.wgsl"

//#include "lib/color_preserve.wgsl"

//#include "lib/pitch.wgsl"

//#include "lib/dura.wgsl"

//#include "lib/top_emitter.wgsl"

//#include "lib/lens_cap.wgsl"

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let p = uv - 0.5;
  let aa = fwidth(p.y) * 0.33;

  if (in.channel >= uniforms.numChannels) { return vec4<f32>(1.0, 0.0, 0.0, 1.0); }
  let fs = getFragmentConstants();
  let bloom = uniforms.bloomIntensity * THEME_BLOOM_MULT;
  let kick = uniforms.kickTrigger;
  let beat = uniforms.beatPhase;

  // Hardware Layering: Discard pixels over UI
  if (in.position.y > uniforms.canvasH * 0.88) { discard; }

  // --- PLAYHEAD ARC OVERLAY (ARC-001) ---
  let minDim = min(uniforms.canvasW, uniforms.canvasH);
  let rInner = minDim * 0.15;
  let rOuter = minDim * 0.45;

  let pixelPos = in.position.xy;
  let center = vec2<f32>(uniforms.canvasW * 0.5, uniforms.canvasH * 0.5);
  let delta = pixelPos - center;
  let fragAngle = atan2(delta.y, delta.x);
  let fragRadius = length(delta);

  let totalSteps = f32(uniforms.numRows);
  let rowAngle = -1.5707963 + (uniforms.playheadRow / totalSteps) * 6.2831853;

  var angleDelta = fragAngle - rowAngle;
  angleDelta = atan2(sin(angleDelta), cos(angleDelta));

  let angularMask = smoothstep(0.018, 0.002, abs(angleDelta));
  let radialMask = smoothstep(rInner - 4.0, rInner + 4.0, fragRadius) *
                   smoothstep(rOuter + 4.0, rOuter - 4.0, fragRadius);

  let pulse = 1.0 + 0.02 * sin(uniforms.timeSec * 6.0);
  let arcIntensity = 0.7 * pulse;
  let arcContrib = THEME_ARC * angularMask * radialMask * arcIntensity;

  // Smooth playhead position
  let maxRows = f32(uniforms.numRows);
  let playheadStep = uniforms.playheadRow - floor(uniforms.playheadRow / maxRows) * maxRows;
  let rowDistRaw = abs(f32(in.row % uniforms.numRows) - playheadStep);
  let rowDist = min(rowDistRaw, maxRows - rowDistRaw);
  let playheadActivation = 1.0 - smoothstep(0.0, 1.5, rowDist);

  // CHANNEL 0 is the Indicator Ring
  if (in.channel == 0u) {
    let onPlayhead = playheadActivation > 0.5;
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
      let beatPulse = 1.0 + kick * 0.6 + (0.5 + 0.5 * sin(beat * 6.2832)) * 0.2;
      let glow = fs.ledOnColor * (bloom * 5.0) * exp(-length(p) * 3.5) * playheadActivation * beatPulse;
      col += glow;
      alpha = max(alpha, smoothstep(0.0, 0.25, length(glow)));
    }
    col += arcContrib;
    return vec4<f32>(col, clamp(alpha, 0.0, 1.0));
  }

  // --- MUSIC CHANNELS (1-32) with THREE-EMITTER LED SYSTEM ---
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
    let note = (in.packedA >> 24) & 255u;
    let instRaw = (in.packedA >> 16) & 255u;
    let durationRaw = (in.packedA >> 8) & 255u;
    let volPacked = in.packedA & 255u;

    let effCmd = (in.packedB >> 24) & 255u;
    let effVal = (in.packedB >> 16) & 255u;
    let durationFlags = (in.packedB >> 8) & 0x7Fu;
    let volCmdFull = in.packedB & 255u;

    let isExpressionOnly = (instRaw & 128u) != 0u;
    let inst = instRaw & 127u;

    let volCmd = (volPacked >> 4) << 4;
    let volVal = (volPacked & 0x0Fu) << 4;

    var dInfo: NoteDurationInfo;
    dInfo.duration = durationRaw;
    if (dInfo.duration == 0u) { dInfo.duration = 1u; }
    dInfo.rowOffset = durationFlags >> 1u;
    dInfo.isNoteOff = (durationFlags & 1u) != 0u;

    let isNoteOn   = (note > 0u && note < NOTE_OFF_MIN && dInfo.isTrigger);
    let isNoteOff  = (note >= NOTE_OFF_MIN);
    let isExprOnly = (!isNoteOn && !isNoteOff && isExpressionOnly);
    let isSustain  = (note > 0u && note < NOTE_OFF_MIN && !dInfo.isTrigger && dInfo.duration > 0u && dInfo.rowOffset > 0u && !dInfo.isNoteOff);
    let isDead     = (!isNoteOn && !isExprOnly && !isSustain && !isNoteOff);

    let ch = channels[in.channel];
    let isMuted = (ch.isMuted == 1u);
    let hasExpression = (volCmd > 0u) || (effCmd > 0u) || (volCmdFull > 0u);

    // EMITTER 1 (TOP): Blue note-on, amber expression-only
    let blueColor  = vec3<f32>(0.05, 0.45, 1.0);
    let amberColor = vec3<f32>(1.0, 0.55, 0.0);
    var topColor = vec3<f32>(0.0);
    var topIntensity = calculateTopIntensity(isNoteOn, isExprOnly, isSustain, isMuted, ch.trigger, bloom, beat);
    if (isNoteOn) { topColor = blueColor; }
    else if (isExprOnly) { topColor = amberColor; }
    else if (isSustain) { topColor = blueColor; }

    // EMITTER 2 (MIDDLE): Note color (pitch-class or per-instrument palette)
    var noteColor = THEME_LED_OFF * 1.2;
    var midIntensity = 0.02;

    if (isNoteOn || isSustain) {
      var baseColor = vec3<f32>(0.0);
      var instBright = 1.0;
      if (uniforms.paletteMode == 1u) {
        let idx = inst % 64u;
        baseColor = textureLoad(instrumentPalette, i32(idx), 0).rgb;
      } else {
        let pitchHue = pitchHueForPalette(note, uniforms.colorPalette);
        baseColor = selectPalette(uniforms.colorPalette, pitchHue);
        let instBand = inst & 15u;
        instBright = 0.85 + (select(0.0, f32(instBand) / 15.0, instBand > 0u)) * 0.15;
      }
      let octBright = octaveBrightness(note);
      noteColor = baseColor * instBright * octBright;

      if (isNoteOn) {
        midIntensity = calculateSustainBrightness(dInfo, 1.1 + bloom * 2.5);
      } else {
        midIntensity = 0.32 + bloom * 0.35;
      }
      if (isMuted) { midIntensity *= 0.25; }
    } else if (isNoteOff) {
      noteColor = vec3<f32>(0.3, 0.3, 0.35);
      midIntensity = 0.2 + 0.1 * sin(uniforms.timeSec * 4.0);
    } else if (isExprOnly) {
      noteColor = THEME_LED_OFF * 1.2;
      midIntensity = 0.0;
    } else if (isDead) {
      noteColor = THEME_LED_OFF * 1.2;
      midIntensity = 0.02;
    }
    let midColor = noteColor;

    // EMITTER 3 (BOTTOM): Amber control indicator
    var botIntensity = 0.0;
    var botColor = vec3<f32>(0.0);
    if (!isMuted && !isExprOnly) {
      if (isNoteOn && hasExpression) {
        botIntensity = 1.0 + bloom * 2.0;
        botColor = amberColor;
      } else if (isSustain && hasExpression) {
        botIntensity = 0.6 + bloom * 1.0;
        botColor = amberColor;
      }
    }

    let lensUV = btnUV - vec2<f32>(0.5, 0.5);
    let triggerLens = vec2<f32>(0.72, 0.92);
    let sustainLens = vec2<f32>(0.44, 0.58);
    let lensSize = select(sustainLens, triggerLens, isNoteOn);

    let unifiedLens = drawUnifiedLensCap(
        lensUV, lensSize,
        vec4<f32>(topColor, topIntensity),
        vec4<f32>(midColor, midIntensity),
        vec4<f32>(botColor, botIntensity),
        aa
    );

    finalColor = mix(finalColor, unifiedLens.rgb, unifiedLens.a);

    if (playheadActivation > 0.5 && (isNoteOn || isSustain)) {
      let pulseColor = mix(blueColor, noteColor, 0.5 + 0.5 * sin(beat * 6.2832));
      let sustainBoost = select(1.0, 1.5, isSustain && !isNoteOn);
      finalColor += pulseColor * playheadActivation * 0.15 * sustainBoost;
    }
  }

  // Kick reactive glow
  let kickPulse = uniforms.kickTrigger * exp(-length(p) * 3.0) * 0.3;
  finalColor += THEME_KICK * kickPulse * uniforms.bloomIntensity;

  // Add playhead arc overlay
  finalColor += arcContrib;

  // Dithering for night mode
  let noise = fract(sin(dot(in.uv * uniforms.timeSec, vec2<f32>(12.9898, 78.233))) * 43758.5453);
  finalColor += (noise - 0.5) * 0.01;

  // Idle cells: thin outer stroke instead of invisible
  if (housingMask < 0.5) {
    if (dHousing < 0.02) {
      return vec4<f32>(fs.ledOffColor, 1.0);
    }
    return vec4<f32>(fs.borderColor, 0.0);
  }
  return vec4<f32>(finalColor, 1.0);
}
