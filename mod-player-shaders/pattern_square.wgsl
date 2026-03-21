// pattern_square.wgsl
// Finalized Square/Grid Shader - Clean horizontal grid layout with rounded square cells
// Layout: Time = X, Channels = Y (traditional tracker layout)

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
  invertChannels: u32,
  dimFactor: f32,
  gridRect: vec4<f32>, // x, y, width, height in normalized coords
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
// VERTEX SHADER
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

  let stepsPerPage = 32.0;
  let pageStart = floor(uniforms.playheadRow / stepsPerPage) * stepsPerPage;
  let localRow = f32(row) - pageStart;
  
  var isVisible = 1.0;
  if (localRow < 0.0 || localRow >= stepsPerPage) {
      isVisible = 0.0;
  }
  
  let effectiveChannel = f32(channel);
  let hasHeader = uniforms.numChannels > 1u && uniforms.gridRect.y > 0.15;
  let dataChannels = f32(uniforms.numChannels) - select(0.0, 1.0, hasHeader);
  let channelIndex = select(effectiveChannel, effectiveChannel - 1.0, hasHeader && effectiveChannel > 0.0);
  
  let gridX = uniforms.gridRect.x + (localRow / stepsPerPage) * uniforms.gridRect.z;
  let gridY = uniforms.gridRect.y + (channelIndex / max(1.0, dataChannels)) * uniforms.gridRect.w;
  
  let cellWidth = uniforms.gridRect.z / stepsPerPage;
  let cellHeight = uniforms.gridRect.w / max(1.0, dataChannels);
  
  let clipX = gridX * 2.0 - 1.0 + quad[vertexIndex].x * cellWidth * 2.0;
  let clipY = 1.0 - (gridY * 2.0) - quad[vertexIndex].y * cellHeight * 2.0;
  
  let finalPos = select(vec4<f32>(0.0, 0.0, 0.0, 0.0), vec4<f32>(clipX, clipY, 0.0, 1.0), isVisible > 0.5);

  let idx = instanceIndex * 2u;
  var a = 0u;
  var b = 0u;
  if (idx + 1u < arrayLength(&cells)) {
      a = cells[idx];
      b = cells[idx + 1u];
  }

  var out: VertexOut;
  out.position = finalPos;
  out.row = row;
  out.channel = channel;
  out.uv = quad[vertexIndex];
  out.packedA = a;
  out.packedB = b;
  return out;
}

// ============================================================================
// SDF FUNCTIONS
// ============================================================================

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
  cellSize: vec2<f32>,
  cornerRadius: f32,
};

fn getFragmentConstants() -> FragmentConstants {
  var c: FragmentConstants;
  c.bgColor = vec3<f32>(0.08, 0.09, 0.11);
  c.ledOnColor = vec3<f32>(0.0, 0.9, 1.0);
  c.ledOffColor = vec3<f32>(0.06, 0.07, 0.09);
  c.borderColor = vec3<f32>(0.02, 0.02, 0.03);
  c.cellSize = vec2<f32>(0.42, 0.38);
  c.cornerRadius = 0.06;
  return c;
}

fn pitchClassFromIndex(note: u32) -> f32 {
  if (note == 0u) { return 0.0; }
  let semi = (note - 1u) % 12u;
  return f32(semi) / 12.0;
}

// ============================================================================
// CELL RENDERING
// ============================================================================

fn drawSquareCell(
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
) -> vec3<f32> {
  
  let dCell = sdRoundedBox(p, fc.cellSize, fc.cornerRadius);
  let cellMask = 1.0 - smoothstep(0.0, aa * 2.0, dCell);
  
  var col = fc.bgColor;
  
  // Border glow
  if (dCell < 0.0 && dCell > -0.05) {
    col += vec3<f32>(0.04) * smoothstep(0.0, -0.15, p.y);
  }
  
  let hasNote = note > 0u;
  let hasEffect = effCmd > 0u || volCmd > 0u;
  let isMuted = ch.isMuted == 1u;
  
  // Note visualization
  if (hasNote) {
    let pitchHue = pitchClassFromIndex(note);
    let noteColor = neonPalette(pitchHue);
    let instBand = inst & 15u;
    let instBright = 0.85 + (select(0.0, f32(instBand) / 15.0, instBand > 0u)) * 0.15;
    
    let linger = exp(-ch.noteAge * 1.5);
    let strike = select(0.0, 2.0, onPlayhead);
    let flash = f32(ch.trigger) * 0.8;
    
    let beatBoost = 1.0 + uniforms.kickTrigger * 0.4;
    let lightAmount = (flash + strike + linger * 2.0) * clamp(ch.volume, 0.0, 1.2) * beatBoost;
    if (isMuted) { lightAmount *= 0.25; }
    
    let displayColor = noteColor * instBright * max(lightAmount, 0.15);
    col = mix(col, displayColor, cellMask * smoothstep(0.0, 1.0, lightAmount));
    
    // Glow effect
    let glow = exp(-max(dCell, 0.0) * 8.0) * lightAmount * uniforms.bloomIntensity;
    col += noteColor * glow * 0.5;
  } else if (onPlayhead) {
    // Playhead indicator for empty cells
    col += vec3<f32>(0.1, 0.12, 0.15) * cellMask;
  }
  
  // Effect indicator (small corner)
  if (hasEffect && !isMuted) {
    let effUV = (uv - 0.5) * 2.0;
    let effDist = length(effUV - vec2<f32>(0.7, 0.7));
    let effGlow = exp(-effDist * 6.0);
    
    var effColor = vec3<f32>(1.0, 0.6, 0.1);
    if (effCmd > 0u) {
      effColor = neonPalette(f32(effCmd) / 32.0);
    }
    let strength = clamp(f32(effVal) / 255.0, 0.3, 1.0);
    col += effColor * effGlow * strength * 0.6;
  }
  
  // Border
  col = mix(col, fc.borderColor, smoothstep(0.0, aa, dCell));
  
  return col;
}

// ============================================================================
// FRAGMENT SHADER
// ============================================================================

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let p = uv - vec2<f32>(0.5);
  let aa = fwidth(p.y) * 0.75;
  
  if (in.channel >= uniforms.numChannels) { 
    return vec4<f32>(0.0, 0.0, 0.0, 0.0); 
  }
  
  let fc = getFragmentConstants();
  
  // Decode packed data
  let note = (in.packedA >> 24) & 255u;
  let inst = (in.packedA >> 16) & 255u;
  let volCmd = (in.packedA >> 8) & 255u;
  let volVal = in.packedA & 255u;
  let effCmd = (in.packedB >> 8) & 255u;
  let effVal = in.packedB & 255u;
  
  let onPlayhead = (in.row == u32(uniforms.playheadRow));
  let ch = channels[in.channel];
  
  var col = drawSquareCell(uv, p, aa, note, inst, volCmd, volVal, effCmd, effVal, ch, onPlayhead, fc);
  
  // Global dimming
  col *= uniforms.dimFactor;
  
  // Kick reactive pulse
  let kickPulse = uniforms.kickTrigger * exp(-length(p) * 3.0) * 0.2;
  col += vec3<f32>(0.9, 0.2, 0.4) * kickPulse * uniforms.bloomIntensity;
  
  // Dithering for smoother gradients
  let noise = fract(sin(dot(uv * uniforms.timeSec, vec2<f32>(12.9898, 78.233))) * 43758.5453);
  col += (noise - 0.5) * 0.008;
  
  return vec4<f32>(col, 1.0);
}
