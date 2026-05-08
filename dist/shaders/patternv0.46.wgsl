// patternv0.46.wgsl
// Mode: "Frosted Glass Rings"
// Frosted translucent circular layout with dynamic glass caps

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
};

@group(0) @binding(0) var<storage, read> cells: array<u32>;
@group(0) @binding(1) var<uniform> uniforms: Uniforms;
@group(0) @binding(2) var<storage, read> rowFlags: array<u32>;

struct ChannelState {
  volume: f32,
  pan: f32,
  freq: f32,
  trigger: u32,
  noteAge: f32,
  activeEffect: u32,
  effectValue: f32,
  isMuted: u32
};
@group(0) @binding(3) var<storage, read> channels: array<ChannelState>;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) @interpolate(flat) row: u32,
  @location(1) @interpolate(flat) channel: u32,
  @location(2) @interpolate(linear) uv: vec2<f32>,
  @location(3) @interpolate(flat) packedA: u32,
  @location(4) @interpolate(flat) packedB: u32,
};

// ── Vertex Shader: Circular Ring Layout ──
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
  let btnW = arcLength * 0.95;
  let btnH = ringDepth * 0.95;

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

// ── Frosted Glass Cap (v0.46) ──
fn drawFrostedGlassCap(uv: vec2<f32>, size: vec2<f32>, color: vec3<f32>, isOn: bool, aa: f32, noteGlow: f32) -> vec4<f32> {
  let p = uv;
  let dBox = sdRoundedBox(p, size * 0.5, 0.08);
  if (dBox > 0.0) {
    return vec4<f32>(0.0);
  }

  let n = normalize(vec3<f32>(p.x * 2.0 / size.x, p.y * 2.0 / size.y, 0.35));
  let viewDir = vec3<f32>(0.0, 0.0, 1.0);
  let fresnel = pow(1.0 - abs(dot(n, viewDir)), 2.5);
  let radial = length(p / (size * 0.5));

  let thickness = 0.12;
  let subsurface = exp(-thickness * 3.5) * noteGlow * (1.0 - radial * 0.4);

  let bgColor = vec3<f32>(0.05, 0.05, 0.06);
  let glassColor = mix(bgColor * 0.2, color, 0.8);

  let edgeAlpha = smoothstep(0.0, aa * 2.0, -dBox);
  let alpha = edgeAlpha * (0.7 + 0.3 * fresnel);

  let light = vec3<f32>(0.5, -0.8, 1.0);
  let diff = max(0.0, dot(n, normalize(light)));
  let litGlassColor = glassColor * (0.55 + 0.45 * diff);

  var finalColor = mix(bgColor, litGlassColor, alpha);
  finalColor += subsurface * color * 3.5;

  if (isOn) {
    let innerGlow = (1.0 - radial) * noteGlow * 0.4;
    finalColor += color * innerGlow;
  }
  finalColor += fresnel * color * noteGlow * 0.3;

  return vec4<f32>(finalColor, edgeAlpha);
}

// ── Fragment Shader ──
@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let p = uv - 0.5;
  let aa = fwidth(p.y) * 0.33;

  if (in.channel >= uniforms.numChannels) {
    return vec4<f32>(0.0);
  }

  let bloom = uniforms.bloomIntensity;
  let kick = uniforms.kickTrigger;
  let beat = uniforms.beatPhase;

  // Smooth playhead
  let maxRows = f32(uniforms.numRows);
  let playheadStep = uniforms.playheadRow - floor(uniforms.playheadRow / maxRows) * maxRows;
  let rowDistRaw = abs(f32(in.row % uniforms.numRows) - playheadStep);
  let rowDist = min(rowDistRaw, maxRows - rowDistRaw);
  let playheadActivation = 1.0 - smoothstep(0.0, 1.5, rowDist);

  // Indicator ring (channel 0)
  if (in.channel == 0u) {
    let onPlayhead = playheadActivation > 0.5;
    let indSize = vec2<f32>(0.3, 0.3);
    let indColor = mix(vec3<f32>(0.15), vec3<f32>(1.0, 0.55, 0.1) * 1.3, playheadActivation);
    let indLed = drawFrostedGlassCap(p, indSize, indColor, onPlayhead, aa, playheadActivation * 1.5);

    var col = indLed.rgb;
    var alpha = indLed.a;

    if (playheadActivation > 0.0) {
      let beatPulse = 1.0 + kick * 0.6 + (0.5 + 0.5 * sin(beat * TAU)) * 0.2;
      let glow = vec3<f32>(1.0, 0.55, 0.1) * (bloom * 5.0) * exp(-length(p) * 3.5) * playheadActivation * beatPulse;
      col += glow;
      alpha = max(alpha, smoothstep(0.0, 0.25, length(glow)));
    }
    return vec4<f32>(col, clamp(alpha, 0.0, 1.0));
  }

  // Main cell
  let dHousing = sdRoundedBox(p, vec2<f32>(0.46), 0.06);
  let housingMask = 1.0 - smoothstep(0.0, aa * 1.5, dHousing);

  var finalColor = vec3<f32>(0.04, 0.04, 0.05);

  let btnScale = 1.05;
  let btnUV = (uv - 0.5) * btnScale + 0.5;
  var inButton = 0.0;
  if (btnUV.x > 0.0 && btnUV.x < 1.0 && btnUV.y > 0.0 && btnUV.y < 1.0) {
    inButton = 1.0;
  }

  if (inButton > 0.5) {
    let note = (in.packedA >> 24) & 255u;
    let inst = (in.packedA >> 16) & 255u;
    let ch = channels[in.channel];
    let isMuted = (ch.isMuted == 1u);

    var noteCol = vec3<f32>(0.15);
    var noteGlow = 0.0;

    if (note > 0u && note <= 120u) {
      let pitchHue = pitchClassFromIndex(note);
      noteCol = selectPalette(uniforms.colorPalette, pitchHue);
      let instBand = inst & 15u;
      let instBright = 0.85 + (select(0.0, f32(instBand) / 15.0, instBand > 0u)) * 0.15;
      noteCol *= instBright;

      let decay = exp(-ch.noteAge * 2.5);
      let flash = f32(ch.trigger);
      noteGlow = (decay + flash) * (1.0 + bloom * 3.0);
      if (isMuted) { noteGlow *= 0.25; }
    }

    let mainUV = btnUV - vec2<f32>(0.5, 0.5);
    let mainSz = vec2<f32>(0.55, 0.45);
    let mainLed = drawFrostedGlassCap(mainUV, mainSz, noteCol * max(0.35, noteGlow), noteGlow > 0.05, aa, noteGlow);

    finalColor = mix(finalColor, mainLed.rgb, mainLed.a);

    if (playheadActivation > 0.5 && noteGlow > 0.0) {
      let pulse = vec3<f32>(0.15, 0.5, 1.0) * playheadActivation * 0.12;
      finalColor += pulse;
    }
  }

  finalColor += kickReactiveGlow(p, kick, bloom);
  finalColor += ditherNoise(in.uv, uniforms.timeSec);

  if (housingMask < 0.5) {
    return vec4<f32>(vec3<f32>(0.0), 0.0);
  }

  return vec4<f32>(finalColor, 1.0);
}