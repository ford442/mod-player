// pattern_circle.wgsl
// Finalized Circle/Ring Shader - Concentric ring layout with circular cells
// Layout: Radial arrangement with 64 steps per ring

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
  padTopChannel: u32, // If true, channel 0 is indicator, music on 1-32
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

// ============================================================================
// VERTEX SHADER - Radial Layout
// ============================================================================

@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOut {
  var quad = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0),
    vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0)
  );

  let numChannels = uniforms.numChannels;
  let row = instanceIndex / numChannels;
  let channel = instanceIndex % numChannels;

  // Channel inversion option
  let invertedChannel = numChannels - 1u - channel;
  let ringIndex = select(invertedChannel, channel, uniforms.invertChannels == 1u);

  // Center of canvas
  let center = vec2<f32>(uniforms.canvasW * 0.5, uniforms.canvasH * 0.5);
  let minDim = min(uniforms.canvasW, uniforms.canvasH);

  // Ring dimensions
  let maxRadius = minDim * 0.45;
  let minRadius = minDim * 0.15;
  let ringDepth = (maxRadius - minRadius) / f32(numChannels);
  let radius = minRadius + f32(ringIndex) * ringDepth;

  // Angular positioning (64 steps)
  let totalSteps = 64.0;
  let anglePerStep = 6.2831853 / totalSteps;
  let theta = -1.570796 + f32(row % 64u) * anglePerStep;

  // Cell sizing
  let circumference = 2.0 * 3.14159265 * radius;
  let arcLength = circumference / totalSteps;
  let btnW = arcLength * 0.92;
  let btnH = ringDepth * 0.92;

  // Transform to world space
  let lp = quad[vertexIndex];
  let localPos = (lp - 0.5) * vec2<f32>(btnW, btnH);

  let rotAng = theta + 1.570796;
  let cA = cos(rotAng);
  let sA = sin(rotAng);

  let rotX = localPos.x * cA - localPos.y * sA;
  let rotY = localPos.x * sA + localPos.y * cA;

  let worldX = center.x + cos(theta) * radius + rotX;
  let worldY = center.y + sin(theta) * radius + rotY;

  // Clip space
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

// ============================================================================
// SDF FUNCTIONS
// ============================================================================

fn sdCircle(p: vec2<f32>, r: f32) -> f32 {
  return length(p) - r;
}

fn sdRoundedBox(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
  let q = abs(p) - b + r;
  return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

// ============================================================================
// COLOR PALETTES
// ============================================================================

fn neonPalette(t: f32) -> vec3<f32> {
  let a = vec3<f32>(0.5, 0.5, 0.5);
  let b = vec3<f32>(0.5, 0.5, 0.5);
  let c = vec3<f32>(1.0, 1.0, 1.0);
  let d = vec3<f32>(0.0, 0.33, 0.67);
  let beatDrift = uniforms.beatPhase * 0.1;
  return a + b * cos(6.28318 * (c * (t + beatDrift) + d));
}

struct FragmentConstants {
  bgColor: vec3<f32>,
  ledOnColor: vec3<f32>,
  ledOffColor: vec3<f32>,
  borderColor: vec3<f32>,
};

fn getFragmentConstants() -> FragmentConstants {
  var c: FragmentConstants;
  c.bgColor = vec3<f32>(0.04, 0.04, 0.05);
  c.ledOnColor = vec3<f32>(1.0, 0.55, 0.1); // Warm orange
  c.ledOffColor = vec3<f32>(0.06, 0.06, 0.08);
  c.borderColor = vec3<f32>(0.0, 0.0, 0.0);
  return c;
}

fn pitchClassFromIndex(note: u32) -> f32 {
  if (note == 0u) { return 0.0; }
  let semi = (note - 1u) % 12u;
  return f32(semi) / 12.0;
}

// ============================================================================
// CIRCLE CELL RENDERING
// ============================================================================

fn drawCircleCell(
  uv: vec2<f32>,
  p: vec2<f32>,
  aa: f32,
  note: u32,
  inst: u32,
  volCmd: u32,
  volVal: u32,
  effCmd: u32,
  effVal: u32,
  ch: ChannelState,
  onPlayhead: bool,
  fc: FragmentConstants
) -> vec4<f32> {
  
  // Main circle
  let dCircle = sdCircle(p, 0.38);
  let circleMask = 1.0 - smoothstep(0.0, aa * 2.0, dCircle);
  
  // Inner circle for ring effect
  let dInner = sdCircle(p, 0.28);
  
  var col = fc.bgColor;
  var alpha = 1.0;
  
  let hasNote = note > 0u;
  let hasEffect = effCmd > 0u || volCmd > 0u;
  let isMuted = ch.isMuted == 1u;
  
  // Base circle glow
  let baseGlow = exp(-max(dCircle, 0.0) * 4.0);
  
  if (hasNote) {
    let pitchHue = pitchClassFromIndex(note);
    let noteColor = neonPalette(pitchHue);
    let instBand = inst & 15u;
    let instBright = 0.85 + (select(0.0, f32(instBand) / 15.0, instBand > 0u)) * 0.15;
    
    let linger = exp(-ch.noteAge * 1.2);
    let strike = select(0.0, 3.0, onPlayhead);
    let flash = f32(ch.trigger) * 1.0;
    
    let beatBoost = 1.0 + uniforms.kickTrigger * 0.5;
    let lightAmount = (flash + strike + linger * 2.5) * clamp(ch.volume, 0.0, 1.2) * beatBoost;
    if (isMuted) { lightAmount *= 0.2; }
    
    let displayColor = noteColor * instBright;
    
    // Inner fill
    let fillMask = 1.0 - smoothstep(0.0, aa * 2.0, dInner);
    col = mix(col, displayColor * max(lightAmount, 0.15), fillMask);
    
    // Outer glow ring
    let ringMask = smoothstep(0.0, 0.08, dInner) * (1.0 - smoothstep(0.08, 0.15, dInner));
    col += displayColor * ringMask * lightAmount * 0.8;
    
    // Bloom glow
    let bloom = baseGlow * lightAmount * uniforms.bloomIntensity * 2.0;
    col += noteColor * bloom;
    
    // Specular highlight
    let specPos = vec2<f32>(-0.15, -0.15);
    let specDist = length(p - specPos);
    let specular = exp(-specDist * 12.0) * smoothstep(0.0, 0.3, lightAmount);
    col += vec3<f32>(1.0) * specular * 0.5;
    
  } else if (onPlayhead) {
    // Playhead indicator
    let fillMask = 1.0 - smoothstep(0.0, aa * 2.0, dInner);
    col = mix(col, vec3<f32>(0.15, 0.18, 0.22), fillMask);
  } else {
    // Empty cell subtle ring
    let ringMask = smoothstep(0.0, 0.06, dInner) * (1.0 - smoothstep(0.06, 0.12, dInner));
    col += vec3<f32>(0.08) * ringMask;
  }
  
  // Effect indicator (small dot)
  if (hasEffect && !isMuted) {
    let dotPos = vec2<f32>(0.22, 0.22);
    let dDot = sdCircle(p - dotPos, 0.08);
    let dotMask = 1.0 - smoothstep(0.0, aa * 2.0, dDot);
    
    var effColor = vec3<f32>(1.0, 0.6, 0.1);
    if (effCmd > 0u) {
      effColor = neonPalette(f32(effCmd) / 32.0);
    }
    let strength = clamp(f32(effVal) / 255.0, 0.3, 1.0);
    col = mix(col, effColor * strength * (1.0 + uniforms.bloomIntensity), dotMask);
  }
  
  // Outer border
  col = mix(col, fc.borderColor, smoothstep(0.0, aa, dCircle));
  
  return vec4<f32>(col, circleMask);
}

// ============================================================================
// INDICATOR RENDERING
// ============================================================================

fn drawIndicator(
  uv: vec2<f32>,
  p: vec2<f32>,
  aa: f32,
  playheadActivation: f32,
  fc: FragmentConstants
) -> vec4<f32> {
  
  let dCircle = sdCircle(p, 0.25);
  let circleMask = 1.0 - smoothstep(0.0, aa * 2.0, dCircle);
  
  let onPlayhead = playheadActivation > 0.5;
  let indColor = mix(vec3<f32>(0.15), fc.ledOnColor * 1.3, playheadActivation);
  
  var col = fc.bgColor;
  
  // Fill
  let fillMask = 1.0 - smoothstep(0.0, aa * 2.0, dCircle);
  col = mix(col, indColor, fillMask);
  
  // Glow when active
  if (playheadActivation > 0.0) {
    let beatPulse = 1.0 + uniforms.kickTrigger * 0.6 + sin(uniforms.beatPhase * 6.2832) * 0.15;
    let glow = fc.ledOnColor * uniforms.bloomIntensity * 3.0 * exp(-length(p) * 4.0) * playheadActivation * beatPulse;
    col += glow;
  }
  
  return vec4<f32>(col, circleMask);
}

// ============================================================================
// FRAGMENT SHADER
// ============================================================================

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let p = uv - vec2<f32>(0.5);
  let aa = fwidth(p.y) * 0.5;
  
  if (in.channel >= uniforms.numChannels) { 
    return vec4<f32>(0.0, 0.0, 0.0, 0.0); 
  }
  
  let fc = getFragmentConstants();
  
  // Playhead calculation
  let playheadStep = uniforms.playheadRow - floor(uniforms.playheadRow / 64.0) * 64.0;
  let rowDistRaw = abs(f32(in.row % 64u) - playheadStep);
  let rowDist = min(rowDistRaw, 64.0 - rowDistRaw);
  let playheadActivation = 1.0 - smoothstep(0.0, 1.5, rowDist);
  
  // Decode packed data
  let note = (in.packedA >> 24) & 255u;
  let inst = (in.packedA >> 16) & 255u;
  let volCmd = (in.packedA >> 8) & 255u;
  let volVal = in.packedA & 255u;
  let effCmd = (in.packedB >> 8) & 255u;
  let effVal = in.packedB & 255u;
  
  let ch = channels[in.channel];
  
  // Check if this is the indicator channel
  let isIndicatorChannel = (uniforms.padTopChannel == 1u && in.channel == 0u);
  
  var result: vec4<f32>;
  
  if (isIndicatorChannel) {
    result = drawIndicator(uv, p, aa, playheadActivation, fc);
  } else {
    let onPlayhead = playheadActivation > 0.5;
    result = drawCircleCell(uv, p, aa, note, inst, volCmd, volVal, effCmd, effVal, ch, onPlayhead, fc);
  }
  
  var col = result.rgb;
  let alpha = result.a;
  
  // Kick reactive glow
  let kickPulse = uniforms.kickTrigger * exp(-length(p) * 3.0) * 0.25;
  col += vec3<f32>(0.9, 0.2, 0.4) * kickPulse * uniforms.bloomIntensity;
  
  // Dithering
  let noise = fract(sin(dot(uv * uniforms.timeSec, vec2<f32>(12.9898, 78.233))) * 43758.5453);
  col += (noise - 0.5) * 0.01;
  
  return vec4<f32>(col, alpha);
}
