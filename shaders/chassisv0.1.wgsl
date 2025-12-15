// chassisv0.1.wgsl
// White Hardware Chassis Pass (fullscreen)
// Drawn via the existing background pass slot (uniform @binding(0)).

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
  _pad0: f32,
  _pad1: f32,
};

@group(0) @binding(0) var<uniform> bez: BezelUniforms;

fn hash(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

fn sdRoundedBox(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
  let q = abs(p) - b + r;
  return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

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

@fragment
fn fs(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  // Centered normalized coordinates
  let p = (uv - 0.5) * 2.0;
  let aspect = bez.canvasW / max(1.0, bez.canvasH);
  let p_aspect = vec2<f32>(p.x * aspect, p.y);

  // Hardware palette (white case)
  let colPlastic = vec3<f32>(0.92, 0.92, 0.93);
  let colRecess = vec3<f32>(0.85, 0.86, 0.88);

  var color = colPlastic;

  // Outer chassis body
  let bodyHalf = vec2<f32>(aspect * 0.98, 0.98);
  let dBody = sdRoundedBox(p_aspect, bodyHalf, 0.10);
  let edgeShadow = smoothstep(0.0, 0.25, dBody);
  color *= (1.0 - edgeShadow * 0.45);

  // Circular recess aligned to the circular ring shaders
  let minDim = min(bez.canvasW, bez.canvasH);
  let dist = length(vec2<f32>(p.x * (bez.canvasW / minDim), p.y * (bez.canvasH / minDim))) * 0.5;

  let maxRadius = 0.45;
  let minRadius = 0.15;

  if (dist < maxRadius + 0.02 && dist > minRadius - 0.02) {
    color = colRecess;

    // Machined concentric tracks
    let track = sin(dist * 220.0);
    color -= vec3<f32>(0.02) * track;

    // Depth shading (soft bowl)
    let outerShade = smoothstep(maxRadius, maxRadius + 0.06, dist);
    let innerShade = smoothstep(minRadius - 0.06, minRadius, dist);
    color *= (0.82 + 0.18 * outerShade);
    color *= (0.82 + 0.18 * (1.0 - innerShade));
  }

  // Center cap
  if (dist < minRadius - 0.02) {
    let dCap = sdRoundedBox(p_aspect, vec2<f32>(0.06), 0.015);
    let capMask = 1.0 - smoothstep(0.0, 0.008, dCap);
    color = mix(color, vec3<f32>(0.18, 0.18, 0.20), capMask);
  }

  // Subtle grain
  let noise = hash(uv * vec2<f32>(bez.canvasW, bez.canvasH));
  color -= noise * 0.02;

  return vec4<f32>(color, 1.0);
}
