// patternv0.48.wgsl
// Three-Emitter LED Indicator System - Blue Note-On, Steady Note Color, Amber Control
// Circular Layout with Unified Glass Cap Lens
// Based on v0.36 (disc layout with direct Note/Instr/Vol/Effect integer data)
// PackedA: [Note(8) | Instr(8) | VolCmd(8) | VolVal(8)]
// PackedB: [Unused(16) | EffCmd(8) | EffVal(8)]

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

struct ChannelState { volume: f32, pan: f32, freq: f32, trigger: u32, noteAge: f32, activeEffect: u32, effectValue: f32, isMuted: u32 };
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

  let totalSteps = 64.0;
  let anglePerStep = 6.2831853 / totalSteps;
  let theta = -1.570796 + f32(row % 64u) * anglePerStep;

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

fn selectPalette(id: u32, t: f32) -> vec3<f32> {
  let a = vec3<f32>(0.5, 0.5, 0.5);
  let b = vec3<f32>(0.5, 0.5, 0.5);
  let c = vec3<f32>(1.0, 1.0, 1.0);
  if (id == 1u) {
    // Warm: reds, oranges, yellows
    return a + b * cos(6.28318 * (c * t + vec3<f32>(0.0, 0.1, 0.2)));
  } else if (id == 2u) {
    // Cool: blues, cyans, purples
    return a + b * cos(6.28318 * (c * t + vec3<f32>(0.5, 0.7, 0.9)));
  } else if (id == 3u) {
    // Neon: pink, cyan, green
    return a + b * cos(6.28318 * (c * t + vec3<f32>(0.0, 0.5, 1.0)));
  } else if (id == 4u) {
    // Acid: green, yellow, chartreuse
    return a + b * cos(6.28318 * (c * t + vec3<f32>(0.3, 0.0, 0.7)));
  }
  // Default palette 0: Rainbow
  return a + b * cos(6.28318 * (c * t + vec3<f32>(0.0, 0.33, 0.67)));
}

fn sdRoundedBox(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
  let q = abs(p) - b + r;
  return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

fn sdCircle(p: vec2<f32>, r: f32) -> f32 {
  return length(p) - r;
}

fn pitchClassFromIndex(note: u32) -> f32 {
  if (note == 0u) { return 0.0; }
  let semi = (note - 1u) % 12u;
  return f32(semi) / 12.0;
}

struct FragmentConstants {
  bgColor: vec3<f32>,
  ledOnColor: vec3<f32>,
  ledOffColor: vec3<f32>,
  borderColor: vec3<f32>,
  housingSize: vec2<f32>,
};

fn getFragmentConstants() -> FragmentConstants {
  var c: FragmentConstants;
  c.bgColor = vec3<f32>(0.04, 0.04, 0.05);
  // Blue/Orange trap palette: primary indicator is warm orange
  c.ledOnColor = vec3<f32>(1.0, 0.55, 0.1);
  c.ledOffColor = vec3<f32>(0.06, 0.06, 0.08);
  c.borderColor = vec3<f32>(0.0, 0.0, 0.0);
  c.housingSize = vec2<f32>(0.92, 0.92);
  return c;
}

// --- UNIFIED THREE-EMITTER GLASS LENS ---
// Draws a glass cap that covers all three emitters (blue, note, amber)
// The lens refracts and diffuses light from the three sources below
fn drawThreeEmitterLens(
  uv: vec2<f32>,
  size: vec2<f32>,
  topColor: vec3<f32>,
  topIntensity: f32,
  midColor: vec3<f32>,
  midIntensity: f32,
  botColor: vec3<f32>,
  botIntensity: f32,
  aa: f32
) -> vec4<f32> {
  let p = uv;
  let dBox = sdRoundedBox(p, size * 0.5, 0.08);

  if (dBox > 0.0) {
    return vec4<f32>(0.0);
  }

  // Emitter positions within the lens
  let topPos = vec2<f32>(0.0, -0.28);   // Top: Blue note-on
  let midPos = vec2<f32>(0.0, 0.0);      // Middle: Note color
  let botPos = vec2<f32>(0.0, 0.28);     // Bottom: Amber control

  // Calculate distance to each emitter for light propagation
  let distTop = length(uv - topPos);
  let distMid = length(uv - midPos);
  let distBot = length(uv - botPos);

  // Glass surface normal for reflections
  let n = normalize(vec3<f32>(p.x * 2.0 / size.x, p.y * 2.0 / size.y, 0.4));
  let viewDir = vec3<f32>(0.0, 0.0, 1.0);
  let fresnel = pow(1.0 - abs(dot(n, viewDir)), 2.0);
  let radial = length(p / (size * 0.5));

  // Glass thickness varies - thicker at edges
  let edgeThickness = 0.15 + radial * 0.08;
  let centerThickness = 0.08;
  let thickness = mix(centerThickness, edgeThickness, radial);

  // Background
  let bgColor = vec3<f32>(0.04, 0.04, 0.05);

  // Calculate light contribution from each emitter
  // Light diffuses outward from each emitter position

  // Top emitter (Blue) - diffuses downward
  let topGlow = exp(-distTop * 5.0) * topIntensity;
  let topDownwardBias = smoothstep(0.0, 0.4, uv.y - topPos.y);
  let topContribution = topGlow * topDownwardBias * topColor;

  // Middle emitter (Note color) - diffuses uniformly
  let midGlow = exp(-distMid * 4.0) * midIntensity;
  let midContribution = midGlow * midColor;

  // Bottom emitter (Amber) - diffuses upward
  let botGlow = exp(-distBot * 5.0) * botIntensity;
  let botUpwardBias = smoothstep(0.0, 0.4, botPos.y - uv.y);
  let botContribution = botGlow * botUpwardBias * botColor;

  // Combine all light contributions
  var totalLight = vec3<f32>(0.0);
  totalLight += topContribution * 2.5;
  totalLight += midContribution * 3.0;
  totalLight += botContribution * 2.5;

  // Glass tint varies with light passing through
  var litTint = vec3<f32>(0.95, 0.95, 1.0);
  if (topIntensity > 0.0) { litTint = mix(litTint, topColor, topIntensity * 0.25); }
  if (midIntensity > 0.0) { litTint = mix(litTint, midColor, midIntensity * 0.3); }
  if (botIntensity > 0.0) { litTint = mix(litTint, botColor, botIntensity * 0.25); }

  let glassBaseColor = mix(bgColor * 0.15, litTint, 0.85);

  // Edge alpha with anti-aliasing
  let edgeAlpha = smoothstep(0.0, aa * 2.0, -dBox);

  // Glass alpha varies with emitter intensity (brighter = more transparent)
  let totalIntensity = topIntensity + midIntensity + botIntensity;
  let baseAlpha = 0.75 + 0.25 * fresnel;
  let alpha = mix(baseAlpha, 0.45, totalIntensity * 0.5) * edgeAlpha;

  // Directional lighting from top-left
  let lightDir = vec3<f32>(0.4, -0.7, 0.6);
  let diff = max(0.0, dot(n, normalize(lightDir)));
  let spec = pow(max(0.0, dot(reflect(-normalize(lightDir), n), viewDir)), 32.0);

  let litGlassColor = glassBaseColor * (0.5 + 0.5 * diff) + vec3<f32>(spec * 0.3);

  // Start with background
  var finalColor = bgColor;

  // Apply the combined light through the glass
  finalColor += totalLight * 0.8;

  // Apply glass layer
  finalColor = mix(finalColor, litGlassColor, alpha);

  // Add emitter hot spots where the actual LEDs are
  let topHotspot = exp(-distTop * 12.0) * topIntensity;
  let midHotspot = exp(-distMid * 10.0) * midIntensity;
  let botHotspot = exp(-distBot * 12.0) * botIntensity;

  finalColor += topColor * topHotspot * 1.5;
  finalColor += midColor * midHotspot * 1.2;
  finalColor += botColor * botHotspot * 1.5;

  // Fresnel rim highlight
  finalColor += fresnel * vec3<f32>(0.9, 0.95, 1.0) * 0.15;

  return vec4<f32>(finalColor, edgeAlpha);
}

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
  let playheadStep = uniforms.playheadRow - floor(uniforms.playheadRow / 64.0) * 64.0;
  let rowDistRaw = abs(f32(in.row % 64u) - playheadStep);
  let rowDist = min(rowDistRaw, 64.0 - rowDistRaw);
  let playheadActivation = 1.0 - smoothstep(0.0, 1.5, rowDist);

  // --- INDICATOR RING ---
  if (in.channel == 0u) {
    let onPlayhead = playheadActivation > 0.5;
    let indSize = vec2<f32>(0.3, 0.3);
    // Simple indicator - no three-emitter here, just status
    let indColor = mix(vec3<f32>(0.15), fs.ledOnColor * 1.3, playheadActivation);
    // Use basic glass cap for indicator
    let dBox = sdRoundedBox(p, indSize * 0.5, 0.08);
    let edgeAlpha = smoothstep(0.0, aa * 2.0, -dBox);
    var col = mix(vec3<f32>(0.04), indColor, playheadActivation * 0.8);
    var alpha = edgeAlpha;
    if (playheadActivation > 0.0) {
      let beatPulse = 1.0 + kick * 0.6 + (0.5 + 0.5 * sin(beat * 6.2832)) * 0.2;
      let glow = fs.ledOnColor * (bloom * 5.0) * exp(-length(p) * 3.5) * playheadActivation * beatPulse;
      col += glow;
      alpha = max(alpha, smoothstep(0.0, 0.25, length(glow)));
    }
    return vec4<f32>(col, clamp(alpha, 0.0, 1.0));
  }

  let dHousing = sdRoundedBox(p, fs.housingSize * 0.5, 0.06);
  let housingMask = 1.0 - smoothstep(0.0, aa * 1.5, dHousing);

  var finalColor = fs.bgColor;

  let btnScale = 1.05;
  let btnUV = (uv - 0.5) * btnScale + 0.5;
  var inButton = 0.0;
  if (btnUV.x > 0.0 && btnUV.x < 1.0 && btnUV.y > 0.0 && btnUV.y < 1.0) {
    inButton = 1.0;
  }

  // --- DECODE PACKED DATA ---
  if (inButton > 0.5) {
    let note = (in.packedA >> 24) & 255u;
    let inst = (in.packedA >> 16) & 255u;
    let volCmd = (in.packedA >> 8) & 255u;
    let volVal = in.packedA & 255u;

    let effCmd = (in.packedB >> 8) & 255u;
    let effVal = in.packedB & 255u;

    let hasNote = (note > 0u);
    let hasExpression = (volCmd > 0u) || (effCmd > 0u);

    // Bounds check for channel state array access
    var ch = ChannelState(0.0, 0.0, 0.0, 0u, 1000.0, 0u, 0.0, 0u);
    if (in.channel < arrayLength(&channels)) {
      ch = channels[in.channel];
    }
    let isMuted = (ch.isMuted == 1u);

    // --- THREE-EMITTER SYSTEM ---

    // EMITTER 1 (TOP): Blue Note-On Indicator
    // Lights up when note is triggered or playhead is on this step
    let blueColor = vec3<f32>(0.15, 0.5, 1.0);
    var topIntensity = 0.0;
    if (!isMuted) {
      if (ch.trigger > 0u) {
        topIntensity = 1.0 + bloom;
      } else if (playheadActivation > 0.5) {
        topIntensity = playheadActivation * 0.6;
      }
    }

    // EMITTER 2 (MIDDLE): Steady Note Color
    // Shows pitch color whenever there's a note
    var midColor = vec3<f32>(0.15);
    var midIntensity = 0.12; // Base dim glow
    if (hasNote) {
      let pitchHue = pitchClassFromIndex(note);
      let baseColor = selectPalette(uniforms.colorPalette, pitchHue);
      let instBand = inst & 15u;
      let instBright = 0.85 + (select(0.0, f32(instBand) / 15.0, instBand > 0u)) * 0.15;
      midColor = baseColor * instBright;

      // Steady indication - doesn't blink, just shows note presence
      midIntensity = 0.6 + bloom * 2.0;
      if (isMuted) { midIntensity *= 0.3; }
    }

    // EMITTER 3 (BOTTOM): Amber Control Message Indicator
    // Lights up when there's an effect or volume command
    let amberColor = vec3<f32>(1.0, 0.55, 0.1);
    var botIntensity = 0.0;
    if (!isMuted && hasExpression) {
      botIntensity = 0.8 + bloom;
    }

    // --- RENDER UNIFIED GLASS LENS ---
    let lensUV = btnUV - vec2<f32>(0.5, 0.5);
    let lensSize = vec2<f32>(0.55, 0.75);

    let lens = drawThreeEmitterLens(
      lensUV, lensSize,
      blueColor, topIntensity,
      midColor, midIntensity,
      amberColor, botIntensity,
      aa
    );

    finalColor = mix(finalColor, lens.rgb, lens.a);

    // Add external glow when active
    if (topIntensity > 0.0 || botIntensity > 0.0 || midIntensity > 0.5) {
      let totalActivity = topIntensity + botIntensity + (midIntensity - 0.12);
      let glowColor = mix(midColor, blueColor, topIntensity * 0.5);
      let glowColor2 = mix(glowColor, amberColor, botIntensity * 0.5);
      let externalGlow = glowColor2 * totalActivity * bloom * 2.0 * exp(-length(p) * 4.0);
      finalColor += externalGlow;
    }
  }

  // Kick reactive glow
  let kickPulse = uniforms.kickTrigger * exp(-length(p) * 3.0) * 0.3;
  finalColor += vec3<f32>(0.9, 0.2, 0.4) * kickPulse * uniforms.bloomIntensity;

  // Dithering
  let noise = fract(sin(dot(in.uv * uniforms.timeSec, vec2<f32>(12.9898, 78.233))) * 43758.5453);
  finalColor += (noise - 0.5) * 0.01;

  if (housingMask < 0.5) { return vec4<f32>(fs.borderColor, 0.0); }
  return vec4<f32>(finalColor, 1.0);
}
