// patternv0.40.wgsl
// Mode: "Neon Circular Rings"
// Advanced circular layout with neon palette, playhead highlighting, and bloom

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

// ── Helpers (from includes) ──
fn neonPalette(t: f32) -> vec3<f32> {
  let a = vec3<f32>(0.5, 0.5, 0.5);
  let b = vec3<f32>(0.5, 0.5, 0.5);
  let c = vec3<f32>(1.0, 1.0, 1.0);
  let d = vec3<f32>(0.263, 0.416, 0.557);
  return a + b * cos(6.28318 * (c * t + d));
}

fn sdRoundedBox(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
  let q = abs(p) - b + r;
  return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

// ── Fragment Shader ──
@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let p = uv - 0.5;
  let aa = fwidth(p.y) * 0.75;

  if (in.channel >= uniforms.numChannels) {
    return vec4<f32>(1.0, 0.0, 0.0, 1.0);
  }

  let bgCol = vec3<f32>(0.051, 0.051, 0.051);
  var col = bgCol;

  let hasNote = ((in.packedA >> 24) & 255u) > 0u;
  let ch = channels[in.channel];
  let isPlayhead = (in.row == u32(uniforms.playheadRow));

  // Main cell highlight
  let dBox = sdRoundedBox(p, vec2<f32>(0.45, 0.40), 0.05);
  if (hasNote) {
    let note = (in.packedA >> 24) & 255u;
    let noteCol = neonPalette(f32(note % 12u) / 12.0);
    let dist = length(p);
    let glow = exp(-dist * 4.0);
    col += noteCol * glow * 1.5;

    if (ch.trigger > 0u && isPlayhead) {
      col += noteCol * 1.5;
    }
  }

  // Playhead highlight
  if (isPlayhead) {
    col += vec3<f32>(0.8, 0.9, 1.0) * 0.6;
  }

  // Border
  let border = 1.0 - smoothstep(0.0, aa, dBox);
  col = mix(col, vec3<f32>(0.3, 0.3, 0.35), border * 0.7);

  col *= uniforms.dimFactor;
  col += vec3<f32>(0.9, 0.2, 0.4) * uniforms.kickTrigger * 0.6; // kick flash

  return vec4<f32>(col, 1.0);
}