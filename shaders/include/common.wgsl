// ============================================================
// common.wgsl — Shared uniforms, structs, vertex shader,
//               SDF primitives, and color helpers.
//
// Include this FIRST in any pattern shader. It defines all
// bindings, the vertex stage, and pure math utilities that
// have no dependencies on higher-level pattern logic.
// ============================================================

// ── Math Constants ──
const PI: f32 = 3.14159265;
const TAU: f32 = 6.2831853;
const PI_HALF: f32 = 1.570796;

// ── Note Range Constants ──
const NOTE_MIN: u32 = 1u;
const NOTE_MAX: u32 = 119u;
const NOTE_OFF_MIN: u32 = 120u;

// ── Shared Color Constants ──
/// Near-black used for dead / empty / expression-only cells.
const DEAD_COLOR: vec3<f32> = vec3<f32>(0.051, 0.051, 0.051);

/// Dark glass background used inside lens caps and housing.
const GLASS_BG: vec3<f32> = vec3<f32>(0.04, 0.04, 0.05);

/// Unlit diode housing color.
const DIODE_HOUSING: vec3<f32> = vec3<f32>(0.06, 0.06, 0.08);

// ── Uniforms ──
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

// ── Storage & Uniform Bindings ──
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

// ── Vertex I/O ──
struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) @interpolate(flat) row: u32,
  @location(1) @interpolate(flat) channel: u32,
  @location(2) @interpolate(linear) uv: vec2<f32>,
  @location(3) @interpolate(flat) packedA: u32,
  @location(4) @interpolate(flat) packedB: u32,
};

// ── Vertex Shader ──
/// Circular ring layout: each cell becomes a rotated quad positioned
/// radially according to its channel (ring index) and row (angle).
/// Channel 0 is reserved for the indicator ring when padTopChannel=true.
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

  // High-precision packing: two u32s per cell (PackedA + PackedB)
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

// ── SDF Primitives ──

/// Signed distance to a rounded rectangle.
fn sdRoundedBox(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
  let q = abs(p) - b + r;
  return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

/// Signed distance to a circle.
fn sdCircle(p: vec2<f32>, r: f32) -> f32 {
  return length(p) - r;
}

/// Signed distance to an ellipse.
fn sdEllipse(p: vec2<f32>, ab: vec2<f32>) -> f32 {
  let k = length(p / ab);
  return (k - 1.0) * min(ab.x, ab.y);
}

// ── Palette Helpers ──

/// Select a color palette by ID (0–4). All palettes use the same
/// cosine gradient basis with different phase offsets.
fn selectPalette(id: u32, t: f32) -> vec3<f32> {
  let a = vec3<f32>(0.5, 0.5, 0.5);
  let b = vec3<f32>(0.5, 0.5, 0.5);
  let c = vec3<f32>(1.0, 1.0, 1.0);
  if (id == 1u) {
    // Warm: reds, oranges, yellows
    return a + b * cos(TAU * (c * t + vec3<f32>(0.0, 0.1, 0.2)));
  } else if (id == 2u) {
    // Cool: blues, cyans, purples
    return a + b * cos(TAU * (c * t + vec3<f32>(0.5, 0.7, 0.9)));
  } else if (id == 3u) {
    // Neon: pink, cyan, green
    return a + b * cos(TAU * (c * t + vec3<f32>(0.0, 0.5, 1.0)));
  } else if (id == 4u) {
    // Acid: green, yellow, chartreuse
    return a + b * cos(TAU * (c * t + vec3<f32>(0.3, 0.0, 0.7)));
  }
  // Default palette 0: Rainbow
  return a + b * cos(TAU * (c * t + vec3<f32>(0.0, 0.33, 0.67)));
}

/// Classic rainbow cosine gradient. Equivalent to selectPalette(0u, t).
fn neonPalette(t: f32) -> vec3<f32> {
  return selectPalette(0u, t);
}

/// Map a tracker note index (1–96) to a pitch-class hue [0,1).
fn pitchClassFromIndex(note: u32) -> f32 {
  if (note == 0u || note > 96u) { return 0.0; }
  let semi = (note - 1u) % 12u;
  return f32(semi) / 12.0;
}
