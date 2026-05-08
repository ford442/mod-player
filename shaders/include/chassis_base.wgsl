// ============================================================
// chassis_base.wgsl — Shared core for all chassis variants.
//
// Include this FIRST in any chassis shader. It defines uniforms,
// bindings, the fullscreen quad vertex shader, SDF primitives,
// noise, and 7-segment digit rendering.
//
// Buffer layout (96 bytes):
//   floats [0-18]  → canvasW..bpm
//   u32    [19]    → isLooping
//   u32    [20]    → currentOrder
//   f32    [21]    → currentRow / playheadRow
//   u32    [22]    → clickedButton
//   u32    [23]    → layoutPreset (replaces _pad2)
// ============================================================

struct BezelUniforms {
  canvasW: f32,
  canvasH: f32,
  bezelWidth: f32,
  surfaceR: f32,
  surfaceG: f32,
  surfaceB: f32,
  bezelR: f32,
  bezelG: f32,
  bezelB: f32,
  screwRadius: f32,
  recessKind: f32,
  recessOuterScale: f32,
  recessInnerScale: f32,
  recessCorner: f32,
  dimFactor: f32,
  isPlaying: f32,
  volume: f32,
  pan: f32,
  bpm: f32,
  isLooping: u32,
  currentOrder: u32,
  currentRow: f32,
  clickedButton: u32,
  layoutPreset: u32,
};

@group(0) @binding(0) var<uniform> bez: BezelUniforms;
@group(0) @binding(1) var bezelSampler: sampler;
@group(0) @binding(2) var bezelTexture: texture_2d<f32>;

// --- Noise Utilities ---

fn hash(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

fn hash2(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

fn noise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i + vec2<f32>(0.0, 0.0)), hash2(i + vec2<f32>(1.0, 0.0)), u.x),
             mix(hash2(i + vec2<f32>(0.0, 1.0)), hash2(i + vec2<f32>(1.0, 1.0)), u.x), u.y);
}

// --- SDF Primitives ---

fn sdRoundedBox(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
  let q = abs(p) - b + r;
  return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

fn sdCircle(p: vec2<f32>, r: f32) -> f32 {
  return length(p) - r;
}

fn sdTriangle(p: vec2<f32>, r: f32) -> f32 {
  let k = sqrt(3.0);
  var p2 = p;
  p2.x = abs(p2.x) - r;
  p2.y = p2.y + r / k;
  if (p2.x + k * p2.y > 0.0) { p2 = vec2<f32>(p2.x - k * p2.y, -k * p2.x - p2.y) / 2.0; }
  p2.x = p2.x - clamp(p2.x, -2.0 * r, 0.0);
  return -length(p2) * sign(p2.y);
}

fn sdBox(p: vec2<f32>, b: vec2<f32>) -> f32 {
  let d = abs(p) - b;
  return length(max(d, vec2<f32>(0.0))) + min(max(d.x, d.y), 0.0);
}

// --- 7-Segment Digit Rendering ---

fn drawDigit(p: vec2<f32>, digit: u32, size: f32) -> f32 {
  let segW = size * 0.15;
  let segL = size * 0.45;
  let gap = size * 0.05;
  var segments = array<u32, 10>(0x77u, 0x24u, 0x5du, 0x6du, 0x2eu, 0x6bu, 0x7bu, 0x25u, 0x7fu, 0x6fu);
  let code = select(0u, segments[digit], digit < 10u);
  var minDist = 100.0;
  if ((code & 0x01u) != 0u) { minDist = min(minDist, sdBox(p - vec2<f32>(0.0, -segL), vec2<f32>(segL, segW))); }
  if ((code & 0x02u) != 0u) { minDist = min(minDist, sdBox(p - vec2<f32>(segL, -segL * 0.5 - gap * 0.5), vec2<f32>(segW, segL * 0.5))); }
  if ((code & 0x04u) != 0u) { minDist = min(minDist, sdBox(p - vec2<f32>(segL,  segL * 0.5 + gap * 0.5), vec2<f32>(segW, segL * 0.5))); }
  if ((code & 0x08u) != 0u) { minDist = min(minDist, sdBox(p - vec2<f32>(0.0,  segL), vec2<f32>(segL, segW))); }
  if ((code & 0x10u) != 0u) { minDist = min(minDist, sdBox(p - vec2<f32>(-segL, segL * 0.5 + gap * 0.5), vec2<f32>(segW, segL * 0.5))); }
  if ((code & 0x20u) != 0u) { minDist = min(minDist, sdBox(p - vec2<f32>(-segL, -segL * 0.5 - gap * 0.5), vec2<f32>(segW, segL * 0.5))); }
  if ((code & 0x40u) != 0u) { minDist = min(minDist, sdBox(p, vec2<f32>(segL, segW))); }
  return minDist;
}

fn drawNumber(p: vec2<f32>, value: u32, numDigits: u32, digitSize: f32, spacing: f32) -> f32 {
  var minDist = 100.0;
  var v = value;
  for (var i = 0u; i < numDigits; i = i + 1u) {
    let digit = v % 10u;
    v = v / 10u;
    let xPos = f32(i) * spacing - f32(numDigits - 1u) * spacing * 0.5;
    minDist = min(minDist, drawDigit(p - vec2<f32>(-xPos, 0.0), digit, digitSize));
  }
  return minDist;
}

fn drawText(p: vec2<f32>, size: vec2<f32>) -> f32 {
  return sdBox(p, size);
}

// --- Vertex Stage ---

struct VertOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32) -> VertOut {
  var verts = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0)
  );
  let pos = verts[vertexIndex];
  var out: VertOut;
  out.position = vec4<f32>(pos, 0.0, 1.0);
  out.uv = pos * 0.5 + vec2<f32>(0.5);
  return out;
}
